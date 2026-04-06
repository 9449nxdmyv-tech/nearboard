<!--
  @file TodayDashboard.svelte
  @description Cross-board daily digest: smart greeting, reminders, unread board
               digest cards, inline voice playback, briefings, and streaks.
               All data sourced from todayStore + boardStore.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { fly, slide } from 'svelte/transition';
	import { todayStore, userStore } from '$lib/stores';
	import { boardStore, invalidateUnreadState } from '$lib/stores/boardStore';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import { summaryPreview, renderSummaryHtml } from '$lib/utils/textFormatter';
	import { markBoardRead } from '$lib/firebase/boardService';
	import FinishLine from './FinishLine.svelte';
	import { updateLastSeen } from '$lib/firebase';
	import { throttle } from '$lib/utils/timing';
	import { hapticSuccess } from '$lib/utils/haptics';
	import type { BoardDoc } from '$lib/types';

	const throttledUpdateLastSeen = throttle((uid: string) => {
		updateLastSeen(uid).catch(console.error);
	}, 10000);

	function formatDuration(ms: number): string {
		const s = Math.round(ms / 1000);
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${String(sec).padStart(2, '0')}`;
	}

	let finishLineTriggered = $state(false);

	function handleFinishLineVisible() {
		const user = $userStore.user;
		if (!user) return;
		throttledUpdateLastSeen(user.uid);
		if (!finishLineTriggered) {
			finishLineTriggered = true;
			hapticSuccess();
		}
	}

	function setupObserver(node: HTMLElement) {
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting) {
				handleFinishLineVisible();
			}
		}, { threshold: 0.5 });
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			}
		};
	}

	// ─── Greeting ──────────────────────────────────────────────────────────
	const greeting = $derived(() => {
		const hour = new Date().getHours();
		const name = $userStore.user?.displayName?.split(' ')[0] || '';
		const suffix = name ? `, ${name}` : '';
		if (hour < 12) return `Good morning${suffix}`;
		if (hour < 17) return `Good afternoon${suffix}`;
		return `Good evening${suffix}`;
	});

	// ─── Smart subtitle ────────────────────────────────────────────────────
	const subtitle = $derived(() => {
		const parts: string[] = [];
		if (unreadBoards.length > 0) {
			parts.push(`${unreadBoards.length} board${unreadBoards.length === 1 ? '' : 's'} need${unreadBoards.length === 1 ? 's' : ''} attention`);
		}
		if ($todayStore.unplayedVoiceNotes.length > 0) {
			parts.push(`${$todayStore.unplayedVoiceNotes.length} voice note${$todayStore.unplayedVoiceNotes.length === 1 ? '' : 's'}`);
		}
		if ($todayStore.reminders.length > 0) {
			parts.push(`${$todayStore.reminders.length} reminder${$todayStore.reminders.length === 1 ? '' : 's'}`);
		}
		return parts.join(' · ');
	});

	// ─── Derived data ──────────────────────────────────────────────────────
	const unreadBoards = $derived(
		$boardStore.boards.filter(b => $boardStore.unreadBoardIds.has(b.id))
	);

	// Build item count lookup
	const itemCountMap = $derived(
		new Map($todayStore.newItemCounts.map(c => [c.boardId, c]))
	);

	// Build briefing lookup
	const briefingMap = $derived(
		new Map($todayStore.briefings.map(b => [b.boardId, b]))
	);

	// Briefings for boards that are NOT unread (unread boards show briefings inline)
	const standaloneBriefings = $derived(
		$todayStore.briefings.filter(b => !$boardStore.unreadBoardIds.has(b.boardId))
	);

	const contentTypeLabel: Record<string, string> = {
		note: 'note',
		voice: 'voice note',
		photo: 'photo',
		video: 'video',
		link: 'link',
		list: 'list',
		poll: 'poll',
		location: 'location',
		product: 'product'
	};

	function formatItemBreakdown(boardId: string): string {
		const counts = itemCountMap.get(boardId);
		if (!counts || counts.total === 0) return '';
		const parts: string[] = [];
		for (const [type, count] of Object.entries(counts.byType)) {
			if (count > 0) {
				const label = contentTypeLabel[type] || type;
				parts.push(`${count} ${label}${count > 1 ? 's' : ''}`);
			}
		}
		return `${counts.total} new item${counts.total === 1 ? '' : 's'}` +
			(parts.length > 0 ? ` (${parts.join(', ')})` : '');
	}

	// ─── Mark board read ───────────────────────────────────────────────────
	let dismissedBoardIds = $state(new Set<string>());

	async function handleMarkRead(e: MouseEvent, board: BoardDoc) {
		e.preventDefault();
		e.stopPropagation();
		const uid = $userStore.user?.uid;
		if (!uid) return;
		// Optimistic dismiss
		dismissedBoardIds = new Set([...dismissedBoardIds, board.id]);
		try {
			await markBoardRead(board.id, uid);
			invalidateUnreadState();
		} catch {
			// Revert on failure
			const next = new Set(dismissedBoardIds);
			next.delete(board.id);
			dismissedBoardIds = next;
		}
	}

	const visibleUnreadBoards = $derived(
		unreadBoards.filter(b => !dismissedBoardIds.has(b.id))
	);

	// ─── Inline audio playback ─────────────────────────────────────────────
	let playingVoiceId = $state<string | null>(null);

	function toggleVoicePlay(contentId: string) {
		if (playingVoiceId === contentId) {
			playingVoiceId = null;
		} else {
			playingVoiceId = contentId;
		}
	}

	// ─── Expandable briefing summaries ─────────────────────────────────────
	let expandedBriefings = $state(new Set<string>());

	function toggleBriefingExpand(boardId: string) {
		const next = new Set(expandedBriefings);
		if (next.has(boardId)) {
			next.delete(boardId);
		} else {
			next.add(boardId);
		}
		expandedBriefings = next;
	}

	// ─── Empty / all caught up ─────────────────────────────────────────────
	const isEmpty = $derived(
		$todayStore.briefings.length === 0 &&
		$todayStore.streaks.length === 0 &&
		$todayStore.unplayedVoiceNotes.length === 0 &&
		$todayStore.reminders.length === 0 &&
		$todayStore.memories.length === 0 &&
		visibleUnreadBoards.length === 0
	);

	const nextDigestHour = $derived(() => {
		return $userStore.user?.digestTime || '8:00 AM';
	});
</script>

<div class="flex flex-col gap-5">
	{#if $todayStore.loading}
		<!-- Skeleton greeting -->
		<div class="animate-pulse">
			<div class="bg-border/60 rounded h-6 w-48 mb-1.5"></div>
			<div class="bg-border/60 rounded h-3 w-32"></div>
		</div>
		<!-- Skeleton streaks strip -->
		<div class="flex gap-2 animate-pulse">
			{#each Array(3) as _}
				<div class="bg-border/60 rounded-full h-8 w-24"></div>
			{/each}
		</div>
		<!-- Skeleton digest cards -->
		<div class="flex flex-col gap-3 animate-pulse">
			<div class="bg-border/60 rounded h-3 w-28 mb-1"></div>
			{#each Array(2) as _}
				<div class="bg-card rounded-card shadow-sm border border-border p-3">
					<div class="flex items-start gap-3">
						<div class="w-2 h-2 rounded-full bg-border/60 mt-1.5"></div>
						<div class="flex-1">
							<div class="bg-border/60 rounded h-4 w-3/4 mb-2"></div>
							<div class="bg-border/60 rounded h-3 w-1/2 mb-2"></div>
							<div class="bg-border/60 rounded h-3 w-full"></div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- Greeting with smart subtitle -->
		<div in:fly={{ y: 8, duration: 300 }} class="text-center">
			<h2 class="text-lg font-display font-semibold text-primary">{greeting()}</h2>
			{#if subtitle()}
				<p class="text-xs text-muted mt-0.5">{subtitle()}</p>
			{:else if !isEmpty}
				<p class="text-xs text-muted mt-0.5">
					{$boardStore.boards.length} {$boardStore.boards.length === 1 ? 'board' : 'boards'}
				</p>
			{/if}
		</div>

		<!-- On This Day memories -->
		{#if $todayStore.memories.length > 0}
			{#each $todayStore.memories as memory (memory.daysAgo)}
				<section in:fly={{ y: 8, duration: 300, delay: 50 }}>
					<div class="flex items-center gap-2 mb-2">
						<div class="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center">
							<Icon icon="ph:clock-countdown-fill" class="text-violet-500 text-xs" />
						</div>
						<h3 class="text-[10px] font-bold text-muted uppercase tracking-widest">On This Day · {memory.label}</h3>
					</div>
					<div class="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory scrollbar-hide">
						{#each memory.items as item (item.contentId)}
							<a
								href="/board/{item.boardId}"
								class="shrink-0 w-[140px] snap-start bg-card rounded-card shadow-sm border border-border overflow-hidden
									hover:border-violet-300 transition-colors group"
							>
								{#if item.imageUrl}
									<img
										src={item.imageUrl}
										alt=""
										width="140" height="96"
										loading="lazy"
										class="w-full h-24 object-cover"
									/>
								{:else}
									<div class="w-full h-24 bg-gradient-to-br from-violet-50 to-violet-100 flex items-center justify-center">
										<Icon
											icon={item.type === 'note' ? 'ph:note' :
												item.type === 'link' ? 'ph:link' :
												item.type === 'photo' ? 'ph:image' :
												item.type === 'video' ? 'ph:video-camera' :
												item.type === 'voice' ? 'ph:microphone' :
												item.type === 'location' ? 'ph:map-pin' :
												item.type === 'poll' ? 'ph:chart-bar' :
												item.type === 'list' ? 'ph:list-checks' :
												'ph:package'}
											class="text-2xl text-violet-300"
										/>
									</div>
								{/if}
								<div class="p-2">
									{#if item.title}
										<p class="text-[11px] font-medium text-primary line-clamp-2 leading-snug">{item.title}</p>
									{/if}
									<p class="text-[10px] text-muted mt-0.5">{item.boardName}</p>
								</div>
							</a>
						{/each}
					</div>
				</section>
			{/each}
		{/if}

		<!-- Streaks strip (gated to ≥3 days) -->
		{#if $todayStore.streaks.length > 0}
			<section in:fly={{ y: 8, duration: 300, delay: 50 }}>
				<div class="flex flex-wrap gap-2">
					{#each $todayStore.streaks as s (s.boardId)}
						<a
							href="/board/{s.boardId}"
							class="flex items-center gap-1.5 bg-card rounded-full px-3 py-1.5 shadow-sm border border-border
								hover:border-accent/30 transition-colors"
						>
							<Icon icon="ph:flame-fill" class="text-warning text-sm" />
							<span class="text-sm font-bold text-primary">{s.streak}d</span>
							<span class="text-xs text-muted">{s.boardName}</span>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Reminders (highest priority) -->
		{#if $todayStore.reminders.length > 0}
			<section in:fly={{ y: 8, duration: 300, delay: 100 }}>
				<h3 class="text-[10px] font-bold text-muted uppercase tracking-widest mb-2">Reminders</h3>
				<div class="flex flex-col gap-2">
					{#each $todayStore.reminders as r}
						<a
							href="/board/{r.boardId}"
							class="flex items-start gap-3 bg-amber-50 border border-amber-200/50 rounded-card p-3
								hover:border-amber-300 transition-colors"
						>
							<div class="w-7 h-7 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 mt-0.5">
								<Icon icon="ph:bell-ringing" class="text-sm" />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-sm text-primary leading-snug">{r.text}</p>
								<p class="text-[10px] text-muted mt-1">{r.boardName}</p>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Unread Board Digest Cards -->
		{#if visibleUnreadBoards.length > 0}
			<section in:fly={{ y: 8, duration: 300, delay: 150 }}>
				<h3 class="text-[10px] font-bold text-muted uppercase tracking-widest mb-2">Needs Attention</h3>
				<div class="flex flex-col gap-3">
					{#each visibleUnreadBoards as board (board.id)}
						{@const briefing = briefingMap.get(board.id)}
						{@const breakdown = formatItemBreakdown(board.id)}
						{@const hasFullSummary = !!board.livingSummary?.content}
						{@const isExpanded = expandedBriefings.has(board.id)}
						<div
							class="bg-card rounded-card shadow-sm border border-border overflow-hidden"
							in:fly={{ y: 6, duration: 200 }}
						>
							<a
								href="/board/{board.id}"
								class="block p-3 hover:bg-surface/50 transition-colors"
							>
								<div class="flex items-start gap-3">
									<div class="w-2 h-2 rounded-full bg-accent shrink-0 mt-1.5"></div>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2">
											<p class="text-sm font-semibold text-primary truncate">{board.name}</p>
											{#if board.lastActivityAt}
												<span class="text-[10px] text-muted shrink-0 ml-auto">{relativeTime(board.lastActivityAt.toDate())}</span>
											{/if}
										</div>
										{#if board.livingSummary?.headline}
											<p class="text-[12px] text-primary/80 mt-1 line-clamp-2">{board.livingSummary.headline}</p>
										{/if}
										{#if breakdown}
											<p class="text-[11px] text-muted mt-1">{breakdown}</p>
										{/if}
										{#if briefing}
											<p class="summary-prose text-[12px] text-primary/70 leading-relaxed mt-2 line-clamp-2">{@html renderSummaryHtml(briefing.briefing.text)}</p>
										{/if}
									</div>
								</div>
							</a>

							<!-- Expandable full summary -->
							{#if hasFullSummary}
								{#if isExpanded}
									<div class="px-3 pb-3 border-t border-border/50" transition:slide={{ duration: 200 }}>
										<div class="summary-prose text-[12px] text-primary/75 leading-[1.7] mt-2 max-h-40 overflow-y-auto">
											{@html renderSummaryHtml(board.livingSummary?.content ?? '')}
										</div>
									</div>
								{/if}
							{/if}

							<!-- Actions -->
							<div class="flex items-center border-t border-border/50 divide-x divide-border/50">
								{#if hasFullSummary}
									<button
										class="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted hover:text-primary transition-colors"
										onclick={() => toggleBriefingExpand(board.id)}
									>
										<Icon icon={isExpanded ? 'ph:caret-up' : 'ph:sparkle'} class="text-xs" />
										{isExpanded ? 'Less' : 'Full summary'}
									</button>
								{/if}
								<button
									class="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted hover:text-primary transition-colors"
									onclick={(e) => handleMarkRead(e, board)}
								>
									<Icon icon="ph:check" class="text-xs" />
									Mark read
								</button>
								<a
									href="/board/{board.id}"
									class="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-accent hover:text-accent/80 transition-colors"
								>
									Open
									<Icon icon="ph:arrow-right" class="text-xs" />
								</a>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Voice Notes with inline playback -->
		{#if $todayStore.unplayedVoiceNotes.length > 0}
			<section in:fly={{ y: 8, duration: 300, delay: 200 }}>
				<h3 class="text-[10px] font-bold text-muted uppercase tracking-widest mb-2">Voice Notes</h3>
				<div class="flex flex-col gap-2">
					{#each $todayStore.unplayedVoiceNotes as v (v.contentId)}
						{@const isPlaying = playingVoiceId === v.contentId}
						<div class="bg-card rounded-card shadow-sm border border-border overflow-hidden">
							<div class="flex items-center gap-3 p-3">
								<button
									class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors
										{isPlaying ? 'bg-accent text-white' : 'bg-accent/10 text-accent hover:bg-accent/20'}"
									onclick={() => toggleVoicePlay(v.contentId)}
								>
									<Icon icon={isPlaying ? 'ph:pause-fill' : 'ph:play-fill'} class="text-base" />
								</button>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium text-primary">{v.authorName}</p>
									<p class="text-[11px] text-muted">{v.boardName} · {formatDuration(v.durationMs)}</p>
								</div>
								<a href="/board/{v.boardId}" class="text-[10px] text-muted hover:text-accent transition-colors shrink-0">
									Open
								</a>
							</div>
							{#if isPlaying}
								<div class="px-3 pb-2">
									<audio
										src={v.audioUrl}
										autoplay
										onended={() => { playingVoiceId = null; }}
										class="w-full h-8"
										controls
									></audio>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Standalone briefings (boards that are already read) -->
		{#if standaloneBriefings.length > 0}
			<section in:fly={{ y: 8, duration: 300, delay: 250 }}>
				<h3 class="text-[10px] font-bold text-muted uppercase tracking-widest mb-2">Briefings</h3>
				<div class="flex flex-col gap-2">
					{#each standaloneBriefings as b (b.boardId)}
						{@const board = $boardStore.boards.find(bd => bd.id === b.boardId)}
						{@const hasFullSummary = !!board?.livingSummary?.content}
						{@const isExpanded = expandedBriefings.has(b.boardId)}
						<div class="bg-accent/5 border border-accent/15 rounded-card overflow-hidden">
							<a
								href="/board/{b.boardId}"
								class="block p-3 hover:bg-accent/10 transition-colors"
							>
								<div class="flex items-center gap-2 mb-1.5">
									<div class="w-4 h-4 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
										<Icon icon="ph:sparkle-fill" class="text-accent text-[8px]" />
									</div>
									<span class="text-xs font-semibold text-primary">{b.boardName}</span>
									<span class="text-[10px] text-muted ml-auto">
										{relativeTime(b.briefing.generatedAt.toDate())}
									</span>
								</div>
								<p class="summary-prose text-[13px] text-primary/85 leading-[1.7] line-clamp-3">{@html renderSummaryHtml(b.briefing.text)}</p>
							</a>
							{#if hasFullSummary}
								{#if isExpanded}
									<div class="px-3 pb-3 border-t border-accent/10">
										<div class="summary-prose text-[12px] text-primary/75 leading-[1.7] mt-2 max-h-40 overflow-y-auto">
											{@html renderSummaryHtml(board?.livingSummary?.content ?? '')}
										</div>
									</div>
								{/if}
								<button
									class="w-full flex items-center justify-center gap-1.5 py-2 border-t border-accent/10 text-[11px] text-muted hover:text-primary transition-colors"
									onclick={() => toggleBriefingExpand(b.boardId)}
								>
									<Icon icon={isExpanded ? 'ph:caret-up' : 'ph:sparkle'} class="text-xs" />
									{isExpanded ? 'Less' : 'Full summary'}
								</button>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- All caught up / empty state -->
		{#if isEmpty}
			<div class="flex flex-col items-center justify-center py-16 px-6 text-center" in:fly={{ y: 8, duration: 300, delay: 100 }}>
				<div class="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mb-4">
					<Icon icon="ph:check-circle" class="text-success text-2xl" />
				</div>
				<p class="text-primary font-medium text-sm mb-1">You're all caught up</p>
				<p class="text-muted text-xs max-w-[220px] leading-relaxed">
					Next digest around {nextDigestHour()}
				</p>
			</div>
		{:else}
			<div use:setupObserver>
				<FinishLine />
			</div>
		{/if}
	{/if}
</div>

<style>
	:global(.summary-prose strong) {
		font-weight: 600;
		color: var(--color-primary);
	}
	:global(.summary-prose em) {
		font-style: italic;
		opacity: 0.8;
	}
	:global(.summary-prose code) {
		padding: 1px 4px;
		border-radius: 4px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
	:global(.summary-prose a) {
		color: var(--color-accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
