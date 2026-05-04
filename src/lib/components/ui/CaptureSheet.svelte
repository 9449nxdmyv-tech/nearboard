<!--
  @file CaptureSheet.svelte
  @description Full-screen capture action sheet — triggered by center "+" tab button.
               Shows board selector + capture type grid + inline note/link input.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { isValidUrl } from '$lib/utils/contentDetection';
	import { hapticLight } from '$lib/utils/haptics';
	import { extractMetadata } from '$lib/api';
	import type { BoardDoc, PageMetadata } from '$lib/types';
	import SheetHeader from './SheetHeader.svelte';
	import ChatInput from './ChatInput.svelte';
	import { swipeToDismiss } from '$lib/utils/swipeToDismiss';
	import { onDestroy } from 'svelte';

	export type CaptureType = 'note' | 'link' | 'photo' | 'video' | 'voice' | 'list' | 'poll' | 'location';

	let {
		boards,
		selectedBoardId,
		onSelectBoard,
		onSubmit,
		onCapture,
		onClose
	}: {
		boards: BoardDoc[];
		selectedBoardId: string | null;
		onSelectBoard: (id: string) => void;
		onSubmit: (data: { type: 'note'; text: string } | { type: 'link'; url: string; meta?: PageMetadata }) => void;
		onCapture: (type: CaptureType) => void;
		onClose: () => void;
	} = $props();

	let text = $state('');
	let submitting = $state(false);
	let showBoardPicker = $state(false);
	let boardSelectorRef = $state<HTMLDivElement>();
	let sheetRef = $state<HTMLDivElement>();
	let boardSelectorBottom = $state(0);

	function recomputeBoardSelectorBottom() {
		if (!boardSelectorRef) return;
		const rect = boardSelectorRef.getBoundingClientRect();
		boardSelectorBottom = window.innerHeight - rect.top;
	}

	$effect(() => {
		if (!showBoardPicker || !boardSelectorRef) return;

		recomputeBoardSelectorBottom();

		// Keep the fixed-position dropdown anchored to the trigger button while
		// the sheet scrolls or the viewport resizes.
		const scrollTarget = sheetRef;
		scrollTarget?.addEventListener('scroll', recomputeBoardSelectorBottom, { passive: true });
		window.addEventListener('resize', recomputeBoardSelectorBottom);

		return () => {
			scrollTarget?.removeEventListener('scroll', recomputeBoardSelectorBottom);
			window.removeEventListener('resize', recomputeBoardSelectorBottom);
		};
	});

	let detectedUrl = $state<string | null>(null);
	let linkPreview = $state<PageMetadata | null>(null);
	let loadingPreview = $state(false);
	let previewAbort = $state<AbortController | null>(null);

	const hasText = $derived(text.trim().length > 0);
	const selectedBoard = $derived(boards.find(b => b.id === selectedBoardId));

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	onDestroy(() => {
		clearTimeout(debounceTimer);
		previewAbort?.abort();
	});

	function handleInput() {
		const trimmed = text.trim();
		const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
		const foundUrl = urlMatch ? urlMatch[0] : (isValidUrl(trimmed) ? trimmed : null);

		if (foundUrl && foundUrl !== detectedUrl) {
			detectedUrl = foundUrl;
			linkPreview = null;
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => fetchPreview(foundUrl), 500);
		} else if (!foundUrl) {
			detectedUrl = null;
			linkPreview = null;
			loadingPreview = false;
			previewAbort?.abort();
		}
	}

	async function fetchPreview(url: string) {
		previewAbort?.abort();
		const controller = new AbortController();
		previewAbort = controller;
		loadingPreview = true;
		try {
			const meta = await extractMetadata(url);
			if (controller.signal.aborted) return;
			if (meta) {
				linkPreview = meta;
			}
		} catch { /* silent */ }
		finally { if (!controller.signal.aborted) loadingPreview = false; }
	}

	function dismissPreview() {
		linkPreview = null;
		detectedUrl = null;
		loadingPreview = false;
	}

	async function handleSubmit() {
		if (!hasText || submitting) return;
		submitting = true;
		try {
			if (detectedUrl) {
				onSubmit({ type: 'link', url: detectedUrl, meta: linkPreview ?? undefined });
			} else {
				onSubmit({ type: 'note', text: text.trim() });
			}
			text = '';
			detectedUrl = null;
			linkPreview = null;
			onClose();
		} finally { submitting = false; }
	}

	const previewDomain = $derived.by(() => {
		try {
			const u = linkPreview?.url || detectedUrl;
			return u ? new URL(u).hostname.replace('www.', '') : null;
		} catch { return null; }
	});

	/** Derive a display label for the detected link type */
	const previewTypeLabel = $derived.by(() => {
		if (!linkPreview) return null;
		if (linkPreview.price) return 'Product';
		if (linkPreview.youtubeId) return 'Video';
		if (linkPreview.enrichment?.kind) {
			const k = linkPreview.enrichment.kind;
			return k.charAt(0).toUpperCase() + k.slice(1);
		}
		if (linkPreview.type === 'product') return 'Product';
		if (linkPreview.type === 'video') return 'Video';
		if (linkPreview.type === 'article') return 'Article';
		return null;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function selectCapture(type: CaptureType) {
		onCapture(type);
		onClose();
	}

	const captureTypes: { type: CaptureType; icon: string; label: string }[] = [
		{ type: 'photo', icon: 'ph:camera', label: 'Photo' },
		{ type: 'video', icon: 'ph:video-camera', label: 'Video' },
		{ type: 'voice', icon: 'ph:microphone', label: 'Voice' },
		{ type: 'list', icon: 'ph:list-checks', label: 'List' },
		{ type: 'poll', icon: 'ph:chart-bar', label: 'Poll' },
		{ type: 'location', icon: 'ph:map-pin', label: 'Place' },
	];
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
	onclick={onClose}
	transition:fade={{ duration: 150 }}
></div>

<!-- Sheet -->
<div
	bind:this={sheetRef}
	use:swipeToDismiss={{ onDismiss: onClose }}
	class="fixed bottom-0 left-0 right-0 z-[101] bg-surface rounded-t-[20px] shadow-xl pb-safe max-h-[90vh] overflow-y-auto"
	transition:fly={{ y: 300, duration: 250 }}
>
	<SheetHeader title="Add content" onClose={onClose} />


	<!-- Board selector -->
	<div class="px-4 pb-3" bind:this={boardSelectorRef}>
		<button
			onclick={() => { showBoardPicker = !showBoardPicker; hapticLight(); }}
			class="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-1 w-full press-scale"
		>
			<Icon icon="ph:kanban" class="text-sm text-on-surface" />
			<span class="text-[13px] font-medium text-on-surface truncate flex-1 text-left">
				{selectedBoard?.name || 'Select a board'}
			</span>
			<Icon icon="ph:caret-up-down" class="text-xs text-on-surface/50" />
		</button>

		{#if showBoardPicker}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="fixed inset-0 z-[102]" onclick={() => { showBoardPicker = false; }}></div>
			<div
				class="fixed left-4 right-4 z-[103] max-h-48 overflow-y-auto
					bg-card rounded-xl border border-border-light shadow-xl"
				style="bottom: {boardSelectorBottom}px;"
				transition:fly={{ y: 8, duration: 150 }}
			>
					{#each boards as board (board.id)}
						<button
							onclick={() => { onSelectBoard(board.id); showBoardPicker = false; hapticLight(); }}
							class="flex items-center gap-2.5 w-full px-4 py-2.5 text-left transition-colors
								{board.id === selectedBoardId
									? 'bg-primary/10 text-primary'
									: 'text-on-surface active:bg-surface-1'}"
						>
							<Icon
								icon={board.id === selectedBoardId ? 'ph:check-circle-fill' : 'ph:kanban'}
								class="text-base shrink-0"
							/>
							<span class="text-[13px] font-medium truncate">{board.name}</span>
						</button>
					{/each}
					<button
						onclick={() => { onClose(); goto('/create-board'); hapticLight(); }}
						class="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-primary active:bg-surface-1 border-t border-surface-1"
					>
						<Icon icon="ph:plus-circle" class="text-base" />
						<span class="text-[13px] font-medium">New board</span>
					</button>
				</div>
			{/if}
	</div>

	<!-- Note/Link input -->
	<div class="px-4 pb-3">
		{#if linkPreview || loadingPreview}
			<div class="mb-2">
				{#if loadingPreview}
					<div class="flex items-center gap-2 px-3 py-2 bg-surface-1 rounded-xl">
						<div class="w-8 h-8 rounded skeleton-shimmer shrink-0"></div>
						<div class="flex-1">
							<div class="h-2.5 w-3/4 skeleton-shimmer rounded mb-1"></div>
							<div class="h-2 w-1/2 skeleton-shimmer rounded"></div>
						</div>
					</div>
				{:else if linkPreview}
					<div class="flex items-center gap-2 px-3 py-2 bg-surface-1 rounded-xl">
						{#if linkPreview.image}
							<img src={linkPreview.image} alt="" class="w-10 h-10 rounded-lg object-cover shrink-0" />
						{:else}
							<div class="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
								<Icon icon="ph:link" class="text-sm text-on-surface/50" />
							</div>
						{/if}
						<div class="flex-1 min-w-0">
							<p class="text-[13px] font-medium text-on-surface truncate">{linkPreview.title || detectedUrl}</p>
							<div class="flex items-center gap-1.5">
								{#if previewTypeLabel}
									<span class="text-[10px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">{previewTypeLabel}</span>
								{/if}
								{#if linkPreview.price}
									<span class="text-[10px] font-semibold text-success">{linkPreview.price}</span>
								{/if}
								{#if previewDomain}
									<span class="text-[11px] text-muted truncate">{previewDomain}</span>
								{/if}
							</div>
						</div>
						<button onclick={() => { dismissPreview(); hapticLight(); }} aria-label="Dismiss link preview" class="p-1 text-muted press-scale">
							<Icon icon="ph:x" class="text-sm" />
						</button>
					</div>
				{/if}
			</div>
		{/if}

		<ChatInput
			bind:value={text}
			placeholder="Type a note or paste a link..."
			size="lg"
			disabled={submitting}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onsubmit={() => { handleSubmit(); hapticLight(); }}
		/>
	</div>

	<!-- Capture type grid -->
	<div class="px-4 pb-4">
		<p class="text-[11px] text-muted font-semibold uppercase tracking-wider mb-2.5 px-0.5">Add content</p>
		<div class="grid grid-cols-3 gap-2">
			{#each captureTypes as item, i (item.type)}
				<button
					onclick={() => { selectCapture(item.type); hapticLight(); }}
					class="flex flex-col items-center gap-1.5 py-3.5 rounded-2xl bg-surface-1 press-scale
						active:bg-surface-2 transition-colors stagger-fade-in"
					style="--stagger-index: {i}"
				>
					<div class="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
						<Icon icon={item.icon} class="text-xl text-primary" />
					</div>
					<span class="text-[11px] font-medium text-on-surface">{item.label}</span>
				</button>
			{/each}
		</div>
	</div>
</div>
