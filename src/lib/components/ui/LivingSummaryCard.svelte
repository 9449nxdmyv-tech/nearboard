<!--
  @file LivingSummaryCard.svelte
  @description Collapsible AI summary bar. Slim pill when collapsed, expands to a polished
               card with rich text content (paragraph / bullets / action-items) and briefing audio.
               Converts inline markdown (bold, italic, code, links) to rendered HTML.
-->
<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import { stripMarkdown, renderInline } from '$lib/utils/textFormatter';
	import { updateLivingSummary, requestSummaryRegeneration } from '$lib/firebase';
	import { showToast } from '$lib/stores';
	import { Button, List, ListInput } from 'konsta/svelte';
	import type { BoardDoc } from '$lib/types';

	let {
		board,
		isAdmin = false,
		briefingAudioUrl = null,
		contentCount = undefined
	}: {
		board: BoardDoc;
		isAdmin: boolean;
		briefingAudioUrl?: string | null;
		/** Visible item count (drives the empty-state messaging). */
		contentCount?: number;
	} = $props();

	/** AI skips boards under this threshold — see Fix 5 in onBoardContentWrite.ts. */
	const MIN_ITEMS_FOR_AI = 3;
	const MIN_ITEMS_FOR_AI_ONBOARDING = 5;

	let expanded = $state(false);
	let isEditing = $state(false);
	let editedContent = $state('');
	let isRegenerating = $state(false);
	let playing = $state(false);
	let audioEl: HTMLAudioElement | undefined = $state();
	let contentEl: HTMLDivElement | undefined = $state();
	let canScroll = $state(false);
	/** Auto-recovery guard: only kick a regen once per mount to avoid loops. */
	let hasCheckedStuckState = $state(false);
	// Local-only toggle state for action-item checkboxes. Keyed by item text so
	// the same items stay ticked across re-renders; resets when the AI regenerates
	// the summary (content string changes).
	let completedItems = $state(new Set<string>());
	let lastSyncedContent = $state('');

	const content = $derived(board.livingSummary?.content || '');
	const headline = $derived(board.livingSummary?.headline || '');
	const highlights = $derived(board.livingSummary?.highlights || []);
	const style = $derived(board.summaryStyle ?? 'paragraph');

	$effect(() => {
		if (expanded && contentEl) {
			const timer = setTimeout(() => {
				if (contentEl) canScroll = contentEl.scrollHeight > contentEl.clientHeight;
			}, 250);
			return () => clearTimeout(timer);
		}
		canScroll = false;
	});

	// ─── Line parsing ─────────────────────────────────────────────────────

	type ParsedLine = {
		type: 'heading' | 'action' | 'bullet' | 'text';
		checked: boolean;
		text: string;
		html: string;
	};

	/** Detect heading patterns: ## header, **Bold**, - **Bold**, short line with colon */
	function isHeadingLine(text: string): string | null {
		// ## Header
		const hashMatch = text.match(/^#{1,6}\s+(.*)/);
		if (hashMatch) return stripMarkdown(hashMatch[1].trim());
		// Entirely bold: **Heading**, **Heading:**, **Heading:** (colon inside or outside)
		const boldMatch = text.match(/^\*{2,3}([^*]+?):?\*{2,3}:?\s*$/) || text.match(/^_{2,3}([^_]+?):?_{2,3}:?\s*$/);
		if (boldMatch) return stripMarkdown(boldMatch[1].trim());
		// Bullet + bold: - **Heading** or • **Heading:**
		const bulletBoldMatch = text.match(/^[-•*]\s+\*{2,3}([^*]+?):?\*{2,3}:?\s*$/);
		if (bulletBoldMatch) return stripMarkdown(bulletBoldMatch[1].trim());
		// Numbered heading: 1. **Heading**
		const numberedBoldMatch = text.match(/^\d+[.)]\s+\*{2,3}([^*]+?):?\*{2,3}:?\s*$/);
		if (numberedBoldMatch) return stripMarkdown(numberedBoldMatch[1].trim());
		// Short line ending with colon (e.g. "Current Status:")
		if (text.length < 45 && text.endsWith(':') && !text.includes('[') && !text.startsWith('-') && !text.startsWith('•')) {
			return stripMarkdown(text.slice(0, -1).trim());
		}
		return null;
	}

	const parsedLines = $derived((): ParsedLine[] => {
		return content.split('\n').filter(l => l.trim().length > 0).map(line => {
			const trimmed = line.trim();
			// Headings first
			const heading = isHeadingLine(trimmed);
			if (heading) {
				return { type: 'heading' as const, checked: false, text: stripMarkdown(heading), html: renderInline(stripMarkdown(heading)) };
			}
			// Checkbox: [ ] or [x] or [X] or [✓]
			const checkMatch = trimmed.match(/^[-•*]?\s*\[([xX✓]?)\]\s*(.+)/);
			if (checkMatch) {
				const txt = checkMatch[2].trim();
				return { type: 'action' as const, checked: checkMatch[1].length > 0, text: stripMarkdown(txt), html: renderInline(txt) };
			}
			// Numbered list: 1. or 2)
			const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
			if (numberedMatch) {
				const txt = numberedMatch[1].trim();
				return { type: 'bullet' as const, checked: false, text: stripMarkdown(txt), html: renderInline(txt) };
			}
			// Bullet: - or • or *
			const bulletMatch = trimmed.match(/^[-•*]\s+(.+)/);
			if (bulletMatch) {
				const txt = bulletMatch[1].trim();
				return { type: 'bullet' as const, checked: false, text: stripMarkdown(txt), html: renderInline(txt) };
			}
			return { type: 'text' as const, checked: false, text: stripMarkdown(trimmed), html: renderInline(trimmed) };
		});
	});

	// ─── Sync completedItems Set with AI-parsed checked state ──────────────
	// When the AI regenerates the summary, wipe any stale toggles and seed the
	// Set with whatever the AI marked as done. User toggles then layer on top.
	$effect(() => {
		if (content === lastSyncedContent) return;
		const next = new Set<string>();
		for (const line of parsedLines()) {
			if (line.type === 'action' && line.checked) next.add(line.text);
		}
		completedItems = next;
		lastSyncedContent = content;
	});

	function toggleActionItem(text: string) {
		const next = new Set(completedItems);
		if (next.has(text)) next.delete(text);
		else next.add(text);
		completedItems = next;
	}

	/** Split paragraph content into rendered HTML paragraphs */
	const paragraphs = $derived((): string[] => {
		if (!content.trim()) return [];
		return content.split(/\n{2,}/)
			.map(p => p.replace(/\n/g, ' ').trim())
			.filter(p => p.length > 0)
			.map(p => renderInline(p));
	});

	/** True when the board has fewer items than the AI threshold — summary is paused, not pending. */
	const tooSmallForSummary = $derived.by(() => {
		if (contentCount === undefined) return false;
		const threshold = board.isOnboarding ? MIN_ITEMS_FOR_AI_ONBOARDING : MIN_ITEMS_FOR_AI;
		return contentCount < threshold;
	});

	// ─── Auto-recovery for stuck Living Summaries ─────────────────────────
	// If the board has enough items, no summary content, AND nothing pending,
	// the board is stuck (usually from a previous deploy where the summary
	// generation failed silently). Kick a regen once per mount to self-heal.
	// Owner-only to prevent thundering-herd when multiple members view a stuck board.
	$effect(() => {
		if (hasCheckedStuckState) return;
		if (!isAdmin || contentCount === undefined) return;
		const isStuck =
			!content.trim() &&
			!tooSmallForSummary &&
			board.summaryDirty !== true &&
			board.enableLivingSummary !== false;
		if (isStuck) {
			hasCheckedStuckState = true;
			requestSummaryRegeneration(board.id).catch(() => {});
		} else if (content.trim() || tooSmallForSummary) {
			// Mark checked so we don't keep probing once state is healthy.
			hasCheckedStuckState = true;
		}
	});

	/** Preview line for collapsed state — prefer headline, fall back to first line of content. */
	const previewLine = $derived(() => {
		if (headline) return headline.length > 80 ? headline.slice(0, 80) + '…' : headline;
		const raw = content.trim();
		if (!raw) {
			if (tooSmallForSummary) {
				const threshold = board.isOnboarding ? MIN_ITEMS_FOR_AI_ONBOARDING : MIN_ITEMS_FOR_AI;
				const remaining = Math.max(1, threshold - (contentCount ?? 0));
				return `Add ${remaining} more item${remaining === 1 ? '' : 's'} to unlock a summary`;
			}
			return 'Generating summary…';
		}
		const first = raw.split('\n').find(l => l.trim().length > 0) ?? raw;
		const cleaned = stripMarkdown(first).replace(/^[-•\[\]x✓✗☐☑☒\s]+/i, '').trim();
		return cleaned.length > 60 ? cleaned.slice(0, 60) + '…' : cleaned;
	});

	// ─── Actions ──────────────────────────────────────────────────────────

	function toggleExpand() {
		if (isEditing) return;
		expanded = !expanded;
	}

	function startEdit() {
		editedContent = board.livingSummary?.content ?? '';
		isEditing = true;
		expanded = true;
	}

	async function saveEdit() {
		try {
			await updateLivingSummary(board.id, editedContent, (board.livingSummary?.version ?? 0) + 1);
			isEditing = false;
			showToast('Summary updated', 'success');
		} catch {
			showToast('Failed to update summary');
		}
	}

	async function regenerate() {
		if (isRegenerating) return;
		isRegenerating = true;
		try {
			await requestSummaryRegeneration(board.id);
			showToast('Regeneration started…', 'success');
			setTimeout(() => { isRegenerating = false; }, 5000);
		} catch {
			showToast('Failed to start regeneration');
			isRegenerating = false;
		}
	}

	function togglePlay() {
		if (!audioEl) return;
		if (playing) { audioEl.pause(); } else { audioEl.play(); }
		playing = !playing;
	}
</script>

<div
	class="mb-4"
	in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}
>
	<!-- Collapsed pill -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="group w-full flex items-center gap-2 px-3 py-2 cursor-pointer select-none
			bg-gradient-to-r from-accent/8 to-accent/4 border border-accent/15 text-left transition-all
			hover:from-accent/12 hover:to-accent/8 hover:border-accent/25 active:scale-[0.998]"
		class:rounded-full={!expanded}
		class:rounded-t-xl={expanded}
		class:border-b-transparent={expanded}
		onclick={toggleExpand}
		onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); } }}
		role="button"
		tabindex="0"
	>
		<div class="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
			<Icon icon="ph:sparkle-fill" class="text-accent text-[10px]" />
		</div>

		<span class="text-xs text-primary/80 truncate flex-1 font-medium">{previewLine()}</span>

		{#if briefingAudioUrl}
			<button
				type="button"
				class="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center shrink-0
					shadow-sm shadow-accent/25 hover:shadow-md hover:shadow-accent/30 transition-shadow active:scale-[0.98]"
				onclick={(e: MouseEvent) => { e.stopPropagation(); togglePlay(); }}
				aria-label={playing ? 'Pause briefing' : 'Play briefing'}
			>
				<Icon icon={playing ? 'ph:pause-fill' : 'ph:play-fill'} class="text-[10px]" />
			</button>
		{/if}

		<span class="shrink-0 transition-transform duration-200 text-accent/50" style:transform={expanded ? 'rotate(180deg)' : 'none'}>
			<Icon icon="ph:caret-down-bold" class="text-[10px]" />
		</span>
	</div>

	<!-- Expanded content -->
	{#if expanded}
		<div
			class="bg-card border border-t-0 border-accent/15 rounded-b-xl overflow-hidden shadow-sm"
			transition:slide={{ duration: 200 }}
		>
			<!-- Highlights: "what's new" bullets -->
			{#if highlights.length > 0 && !isEditing}
				<div class="px-4 pt-3 pb-1 border-b border-border/30">
					<div class="flex items-center gap-1.5 mb-1.5">
						<Icon icon="ph:lightning-fill" class="text-accent/60 text-[10px]" />
						<span class="text-[10px] font-semibold text-muted uppercase tracking-wider">What's new</span>
					</div>
					{#each highlights as hl, i}
						<div
							class="flex items-start gap-2 py-0.5 pl-1"
							in:fly={{ y: 4, duration: 200, delay: i * 50 }}
						>
							<div class="mt-[7px] w-1 h-1 rounded-full bg-accent/50 shrink-0"></div>
							<span class="text-[12px] text-primary/80 leading-relaxed">{hl}</span>
						</div>
					{/each}
				</div>
			{/if}

			{#if isEditing}
				<div class="px-4 pt-3 pb-4">
					<List inset strong outline class="!my-0">
						<ListInput
							outline
							type="textarea"
							placeholder="Edit summary..."
							value={editedContent}
							onInput={(e) => { editedContent = e.target.value; }}
							inputClass="!min-h-[100px] !max-h-[180px] !resize-none"
						/>
					</List>
					<div class="flex justify-end gap-2 mt-3">
						<Button small rounded clear onClick={() => (isEditing = false)}>
							Cancel
						</Button>
						<Button small rounded onClick={saveEdit}>
							Save
						</Button>
					</div>
				</div>
			{:else}
				<!-- Scrollable content area -->
				<div class="relative">
					<div
						bind:this={contentEl}
						class="px-4 pt-4 pb-1 max-h-56 overflow-y-auto overscroll-contain"
						style="scrollbar-width: thin; scrollbar-color: var(--color-accent) transparent;"
					>
						<!-- ── Paragraph style ── -->
						{#if style === 'paragraph' || !content}
							<div class="summary-prose space-y-3">
								{#each paragraphs() as para, i}
									<p
										class="text-[13px] text-primary leading-[1.8]"
										in:fly={{ y: 6, duration: 250, delay: i * 60 }}
									>{@html para}</p>
								{/each}
								{#if paragraphs().length === 0}
									<div class="flex items-start gap-2 py-4">
										{#if tooSmallForSummary}
											<Icon icon="ph:sparkle" class="text-accent/50 text-sm mt-0.5" />
											<p class="text-[13px] text-muted leading-relaxed">
												Summaries unlock once you add a few more items. Keep capturing — notes, links, photos — and this card will fill in automatically.
											</p>
										{:else}
											<Icon icon="ph:circle-notch" class="text-accent text-sm animate-spin mt-0.5" />
											<p class="text-[13px] text-muted italic">Generating a summary of this board…</p>
										{/if}
									</div>
								{/if}
							</div>

						<!-- ── Bullet style ── -->
						{:else if style === 'bullets'}
							<div class="space-y-1">
								{#each parsedLines() as line, i}
									{#if line.type === 'heading'}
										<div
											class="flex items-center gap-2 {i > 0 ? 'mt-3 pt-3 border-t border-border/50' : ''}"
											in:fly={{ y: 6, duration: 250, delay: i * 40 }}
										>
											<div class="w-1 h-3.5 rounded-full bg-accent shrink-0"></div>
											<h4 class="text-xs font-bold text-primary tracking-wide">{line.text}</h4>
										</div>
									{:else}
										<div
											class="flex items-start gap-2.5 pl-3 py-0.5"
											in:fly={{ y: 6, duration: 250, delay: i * 40 }}
										>
											<div class="mt-[7px] w-1 h-1 rounded-full bg-accent/50 shrink-0"></div>
											<span class="summary-prose text-[13px] text-primary/85 leading-relaxed">{@html line.html}</span>
										</div>
									{/if}
								{/each}
							</div>

						<!-- ── Action items style ── -->
						{:else if style === 'action-items'}
							<div class="space-y-0.5">
								{#each parsedLines() as line, i}
									{#if line.type === 'heading'}
										<div
											class="flex items-center gap-2 {i > 0 ? 'mt-3 pt-3 border-t border-border/50' : ''}"
											in:fly={{ y: 6, duration: 250, delay: i * 40 }}
										>
											<div class="w-1 h-3.5 rounded-full bg-accent shrink-0"></div>
											<h4 class="text-xs font-bold text-primary tracking-wide">{line.text}</h4>
										</div>
									{:else if line.type === 'action'}
										{@const isChecked = completedItems.has(line.text)}
										<button
											type="button"
											class="w-full text-left flex items-start gap-2.5 py-1.5 px-2 -mx-2 rounded-lg transition-colors cursor-pointer
												{isChecked ? 'bg-success/5 hover:bg-success/10' : 'hover:bg-accent/5'}"
											in:fly={{ y: 6, duration: 250, delay: i * 40 }}
											onclick={(e: MouseEvent) => { e.stopPropagation(); toggleActionItem(line.text); }}
											aria-pressed={isChecked}
											aria-label={isChecked ? `Mark "${line.text}" as not done` : `Mark "${line.text}" as done`}
										>
											{#if isChecked}
												<Icon icon="ph:check-circle-fill" class="text-success text-base shrink-0 mt-0.5" />
											{:else}
												<Icon icon="ph:circle" class="text-accent/40 text-base shrink-0 mt-0.5" />
											{/if}
											<span
												class="summary-prose text-[13px] leading-relaxed {isChecked ? 'text-muted line-through' : 'text-primary'}"
											>{@html line.html}</span>
										</button>
									{:else}
										<div
											class="py-1 pl-1"
											in:fly={{ y: 6, duration: 250, delay: i * 40 }}
										>
											<span class="summary-prose text-[13px] text-primary/85 leading-relaxed">{@html line.html}</span>
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					</div>

					<!-- Scroll fade -->
					{#if canScroll}
						<div class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent pointer-events-none"></div>
					{/if}
				</div>

				<!-- Footer -->
				<div class="flex items-center gap-2 mx-4 mt-1 mb-3 pt-2 border-t border-border/40">
					<div class="flex items-center gap-1.5 text-[10px] text-muted">
						<Icon icon="ph:sparkle" class="text-accent/40" />
						<span>AI Summary</span>
					</div>
					{#if board.livingSummary?.updatedAt}
						<span class="text-[10px] text-muted/60">·</span>
						<span class="text-[10px] text-muted/60">
							{relativeTime(board.livingSummary.updatedAt.toDate())}
						</span>
					{/if}
					{#if board.livingSummary?.editedByAdmin}
						<span class="text-[10px] text-accent/50 flex items-center gap-0.5">
							<Icon icon="ph:pencil-simple" class="text-[9px]" />
							edited
						</span>
					{/if}

					{#if isAdmin}
						<div class="ml-auto flex items-center gap-0.5">
							<button
								onclick={(e: MouseEvent) => { e.stopPropagation(); regenerate(); }}
								disabled={isRegenerating}
								class="p-1.5 rounded-full text-muted hover:text-accent hover:bg-accent/8
									disabled:opacity-40 transition-colors"
								aria-label="Regenerate summary"
							>
								<Icon icon="ph:arrows-clockwise" class="text-sm {isRegenerating ? 'animate-spin' : ''}" />
							</button>
							<button
								onclick={(e: MouseEvent) => { e.stopPropagation(); startEdit(); }}
								class="p-1.5 rounded-full text-muted hover:text-accent hover:bg-accent/8 transition-colors"
								aria-label="Edit summary"
							>
								<Icon icon="ph:pencil-simple" class="text-sm" />
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if briefingAudioUrl}
	<audio
		bind:this={audioEl}
		src={briefingAudioUrl}
		onended={() => { playing = false; }}
		preload="metadata"
	></audio>
{/if}

<style>
	/* Rich text styles for rendered markdown inside summary */
	:global(.summary-prose strong) {
		font-weight: 600;
		color: var(--color-primary);
	}
	:global(.summary-prose em) {
		font-style: italic;
		color: var(--color-primary);
		opacity: 0.8;
	}
	:global(.summary-prose a) {
		color: var(--color-accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	:global(.summary-prose code) {
		padding: 1px 5px;
		border-radius: 4px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
</style>
