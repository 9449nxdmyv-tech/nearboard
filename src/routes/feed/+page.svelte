<!--
  @file feed/+page.svelte
  @description Simple global feed - catch up across all boards.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Icon from '@iconify/svelte';
	import { hapticLight } from '$lib/utils/haptics';
	import {
		userStore,
		boardStore,
		feedStore,
		showToast,
		setFeedItems,
		setFeedLoading,
		sortFeedItems,
		setSortMode,
		type FeedSortMode
	} from '$lib/stores';
	import {
		subscribeToBoardContentPaginated,
		fetchLatestBoardContent,
		isContentVisible,
		getBoard
	} from '$lib/firebase';
	import type { ContentDoc } from '$lib/types';
	import { shareContent } from '$lib/utils/share';
	import ContentRenderer from '$lib/components/ui/ContentRenderer.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import MasonryGrid from '$lib/components/ui/MasonryGrid.svelte';
	import { globalExperience } from '$lib/stores';

	import { Page, Popover } from 'konsta/svelte';
	import CardDetailModal from '$lib/components/ui/CardDetailModal.svelte';

	type FeedFilterType = 'all' | 'note' | 'list' | 'link' | 'photo' | 'video' | 'voice' | 'poll' | 'location' | 'product';

	const FILTER_OPTIONS: { value: FeedFilterType; label: string; icon: string }[] = [
		{ value: 'all', label: 'All', icon: 'ph:squares-four' },
		{ value: 'note', label: 'Notes', icon: 'ph:note-pencil' },
		{ value: 'list', label: 'Lists', icon: 'ph:list-checks' },
		{ value: 'link', label: 'Links', icon: 'ph:link' },
		{ value: 'product', label: 'Products', icon: 'ph:shopping-bag' },
		{ value: 'photo', label: 'Photos', icon: 'ph:camera' },
		{ value: 'video', label: 'Videos', icon: 'ph:video-camera' },
		{ value: 'voice', label: 'Voice', icon: 'ph:microphone' },
		{ value: 'poll', label: 'Polls', icon: 'ph:chart-bar' },
		{ value: 'location', label: 'Places', icon: 'ph:map-pin' }
	];

	const SORT_OPTIONS: { value: FeedSortMode; label: string; icon: string; description: string }[] = [
		{ value: 'latest', label: 'Newest first', icon: 'ph:clock-counter-clockwise', description: 'Latest across your boards' },
		{ value: 'oldest', label: 'Oldest first', icon: 'ph:clock', description: 'Catch up from the start' },
		{ value: 'unread', label: 'Unread first', icon: 'ph:circle-dashed', description: 'Things you haven\u2019t seen yet' },
		{ value: 'by-board', label: 'By board', icon: 'ph:kanban', description: 'Grouped by board name' },
		{ value: 'most-active', label: 'Most active', icon: 'ph:fire', description: 'Busy boards first' }
	];

	let filterType = $state<FeedFilterType>('all');
	let sortMenuOpen = $state(false);
	let sortMenuTarget = $state<HTMLButtonElement | undefined>();

	const filteredItems = $derived(
		filterType === 'all'
			? $feedStore.items
			: $feedStore.items.filter((f) => f.content.type === filterType)
	);
	const sortedItems = $derived(sortFeedItems(filteredItems, $feedStore.sortMode));
	const feedLayout = $derived($globalExperience.layoutStyle);
	const currentSortOption = $derived(SORT_OPTIONS.find((o) => o.value === $feedStore.sortMode) ?? SORT_OPTIONS[0]);

	/** Only show filter pills for content types that have at least one item. */
	const pillOptions = $derived.by(() => {
		const present = new Set($feedStore.items.map((f) => f.content.type));
		return FILTER_OPTIONS.filter((opt) => opt.value === 'all' || present.has(opt.value));
	});

	let detailItemId = $state<string | null>(null);
	let detailBoardId = $state('');
	let detailExpandComments = $state(false);
	const detailFeedItem = $derived(
		detailItemId ? sortedItems.find((f) => f.content.id === detailItemId) ?? null : null
	);
	const detailItem = $derived(detailFeedItem?.content ?? null);

	function handleShareCard(item: ContentDoc, feedBoardId: string) {
		shareContent(item, feedBoardId);
	}

	// ─── Windowed subscriptions ──────────────────────────────────────────
	// Boards currently receiving real-time updates. Reactive so the UI can
	// show a "Go live" affordance on boards that are one-shot fetches only.
	let liveBoardIds = $state(new SvelteSet<string>());
	const unsubsByBoard = new Map<string, () => void>();
	const followedBoardMeta = new Map<string, { name: string; ownerId: string; allowComments: boolean }>();
	const boardContentMap = new Map<string, ContentDoc[]>();
	let rebuildTimer: ReturnType<typeof setTimeout>;

	function rebuildFeed() {
		clearTimeout(rebuildTimer);
		rebuildTimer = setTimeout(rebuildFeedNow, 100);
	}

	function rebuildFeedNow() {
		const user = $userStore.user;
		const allItems: any[] = [];
		const memberBoards = new Map<string, { name: string; ownerId: string; allowComments: boolean }>();
		for (const b of $boardStore.boards) {
			memberBoards.set(b.id, { name: b.name, ownerId: b.ownerId, allowComments: b.allowComments ?? true });
		}

		for (const [boardId, boardItems] of boardContentMap) {
			const meta = memberBoards.get(boardId) ?? followedBoardMeta.get(boardId);
			if (!meta) continue;
			const isOwner = meta.ownerId === user?.uid;

			for (const item of boardItems) {
				if (isContentVisible(item, isOwner)) {
					allItems.push({
						content: item,
						boardName: meta.name,
						boardId,
						isOwner,
						allowComments: meta.allowComments
					});
				}
			}
		}

		setFeedItems(allItems);
	}

	/** Promote a one-shot board to real-time updates. Idempotent. */
	function goLive(boardId: string) {
		if (unsubsByBoard.has(boardId)) return;
		hapticLight();
		liveBoardIds.add(boardId);
		const unsub = subscribeToBoardContentPaginated(boardId, (items) => {
			boardContentMap.set(boardId, items);
			rebuildFeed();
		});
		unsubsByBoard.set(boardId, unsub);
		showToast('Live updates on', 'success');
	}

	onMount(() => {
		// Set initial sort mode from experience preferences
		const feedOrder = $globalExperience.feedOrder;
		const sortMap: Record<string, import('$lib/stores').FeedSortMode> = {
			'newest': 'latest',
			'oldest': 'oldest',
			'most-active': 'most-active',
			'curated': 'latest'
		};
		setSortMode(sortMap[feedOrder] ?? 'latest');

		const boards = $boardStore.boards;
		const followingIds = $userStore.user?.followingBoardIds ?? [];
		const memberBoardIds = new Set(boards.map(b => b.id));

		// Only follow boards the user isn't already a member of
		const followOnlyIds = followingIds.filter(id => !memberBoardIds.has(id));

		if (boards.length === 0 && followOnlyIds.length === 0) return;

		setFeedLoading(true);

		// Per-mount flag so deferred idle callbacks bail out if we unmount
		// before they fire (otherwise they'd open subscriptions we never close).
		let destroyed = false;

		// Windowed subscriptions: only the N most-recently-active boards get
		// real-time listeners; the rest get a one-shot fetch. Keeps the open
		// Firestore socket count bounded regardless of how many boards a user
		// joins, while still showing their content in the feed. The user can
		// promote any paused board via the "Go live" button in the card label.
		const MAX_LIVE_SUBSCRIPTIONS = 6;
		const sortedBoards = [...boards].sort((a, b) => {
			const aT = a.lastActivityAt?.toMillis?.() ?? 0;
			const bT = b.lastActivityAt?.toMillis?.() ?? 0;
			return bT - aT;
		});
		const initialLiveIds = new Set(sortedBoards.slice(0, MAX_LIVE_SUBSCRIPTIONS).map((b) => b.id));

		const idle: (cb: () => void) => void =
			typeof (globalThis as any).requestIdleCallback === 'function'
				? (cb) => (globalThis as any).requestIdleCallback(cb, { timeout: 500 })
				: (cb) => setTimeout(cb, 0);

		// Stagger subscription creation across idle ticks to avoid opening
		// every Firestore socket in the same microtask on mount.
		function scheduleSubscribe(boardId: string) {
			idle(() => {
				if (destroyed) return;
				if (unsubsByBoard.has(boardId)) return;
				liveBoardIds.add(boardId);
				const unsub = subscribeToBoardContentPaginated(boardId, (items) => {
					boardContentMap.set(boardId, items);
					rebuildFeed();
				});
				unsubsByBoard.set(boardId, unsub);
			});
		}

		for (const board of sortedBoards) {
			if (initialLiveIds.has(board.id)) {
				scheduleSubscribe(board.id);
			} else {
				// Low-activity boards: one-shot fetch, no listener
				fetchLatestBoardContent(board.id)
					.then((items) => {
						if (destroyed) return;
						boardContentMap.set(board.id, items);
						rebuildFeed();
					})
					.catch(() => { /* permission denied or deleted — skip */ });
			}
		}

		// Followed boards (non-member, typically few): always one-shot
		for (const fId of followOnlyIds) {
			getBoard(fId).then((b) => {
				if (destroyed || !b || !b.isPublic) return;
				followedBoardMeta.set(fId, { name: b.name, ownerId: b.ownerId, allowComments: false });
				return fetchLatestBoardContent(fId).then((items) => {
					if (destroyed) return;
					boardContentMap.set(fId, items);
					rebuildFeed();
				});
			}).catch(() => { /* board may have been deleted */ });
		}

		// Rebuild when member board metadata (names, ownership) changes
		const unsubBoardStore = boardStore.subscribe(() => rebuildFeed());

		return () => {
			destroyed = true;
			clearTimeout(rebuildTimer);
			for (const u of unsubsByBoard.values()) u();
			unsubsByBoard.clear();
			liveBoardIds.clear();
			unsubBoardStore();
		};
	});

</script>

<Page>
	<Header title="Feed" />

	<main class="flex-1 px-4">
		{#if $feedStore.loading}
			<div class="flex flex-col gap-4 mt-4">
				{#each Array(4) as _, i (i)}
					<div class="rounded-[var(--radius-card)] bg-card shadow-card overflow-hidden stagger-fade-in" style="--stagger-index: {i}">
						<div class="h-36 skeleton-shimmer"></div>
						<div class="p-4">
							<div class="h-4 w-3/4 skeleton-shimmer rounded mb-2.5"></div>
							<div class="h-3 w-1/2 skeleton-shimmer rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if $feedStore.items.length === 0}
			<EmptyState
				icon="ph:rss"
				title="Feed is empty"
				description="Content from all your boards will appear here"
			/>
		{:else}
			<!-- Filter + sort pills — mirrors the board page chrome. -->
			{#if pillOptions.length > 1}
				<div class="-mx-4 mt-4 mb-3">
					<div class="overflow-x-auto overflow-y-hidden scrollbar-hide">
						<div class="inline-flex items-center gap-3 px-4 py-1.5 min-w-full">
							<button
								bind:this={sortMenuTarget}
								onclick={() => { sortMenuOpen = !sortMenuOpen; }}
								class="inline-flex items-center justify-center w-9 h-9 rounded-full
									press-scale transition-colors shrink-0
									bg-surface-1 text-on-surface active:bg-surface-2"
								aria-haspopup="menu"
								aria-expanded={sortMenuOpen}
								aria-label="Sort: {currentSortOption.label}"
								title="Sort: {currentSortOption.label}"
							>
								<Icon icon={currentSortOption.icon} class="text-[15px] text-on-surface" />
							</button>

							<div class="w-px h-5 bg-border shrink-0" aria-hidden="true"></div>

							{#each pillOptions as opt (opt.value)}
								{@const active = filterType === opt.value}
								<button
									onclick={() => { filterType = opt.value; }}
									class="inline-flex items-center justify-center w-9 h-9 rounded-full
										press-scale transition-colors shrink-0
										{active
											? 'bg-primary text-white shadow-sm'
											: 'bg-surface-1 text-on-surface active:bg-surface-2'}"
									aria-pressed={active}
									aria-label={opt.label}
									title={opt.label}
								>
									<Icon icon={opt.icon} class="text-[15px]" />
								</button>
							{/each}
						</div>
					</div>
				</div>

				<Popover opened={sortMenuOpen} target={sortMenuTarget} onBackdropClick={() => { sortMenuOpen = false; }}>
					<div class="py-1 min-w-[220px]" role="menu">
						{#each SORT_OPTIONS as opt (opt.value)}
							{@const active = $feedStore.sortMode === opt.value}
							<button
								role="menuitemradio"
								aria-checked={active}
								onclick={() => { setSortMode(opt.value); sortMenuOpen = false; }}
								class="w-full flex items-start gap-3 px-4 py-2.5 text-left active:bg-surface-1 transition-colors
									{active ? 'text-primary' : 'text-on-surface'}"
							>
								<Icon icon={opt.icon} class="text-base mt-0.5 shrink-0 {active ? 'text-primary' : 'text-muted'}" />
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium">{opt.label}</span>
										{#if active}<Icon icon="ph:check" class="text-sm text-primary" />{/if}
									</div>
									<div class="text-[11px] text-muted mt-0.5">{opt.description}</div>
								</div>
							</button>
						{/each}
					</div>
				</Popover>
			{/if}

			{#if sortedItems.length === 0}
				<EmptyState
					icon="ph:funnel"
					title="No items found"
					description="No items match your current filter"
					actionLabel="Clear filter"
					onAction={() => { filterType = 'all'; }}
				/>
			{:else}
			<div class={pillOptions.length > 1 ? '' : 'mt-4'}>
				<MasonryGrid columns={2} layout={feedLayout}>
					{#each sortedItems as feedItem, i (feedItem.content.id)}
						<div class="stagger-fade-in" style="--stagger-index: {i}">
							<div class="flex items-center gap-1.5 mb-1 px-0.5">
								<a href="/board/{feedItem.boardId}" class="inline-flex items-center gap-1.5 text-[11px] text-primary font-semibold">
									<Icon icon="ph:kanban" class="text-xs" />
									{feedItem.boardName}
								</a>
								{#if !liveBoardIds.has(feedItem.boardId)}
									<button
										type="button"
										onclick={(e) => { e.stopPropagation(); goLive(feedItem.boardId); }}
										class="inline-flex items-center gap-1 text-[10px] text-muted hover:text-accent transition-colors"
										title="Enable real-time updates for this board"
										aria-label="Enable live updates for {feedItem.boardName}"
									>
										<Icon icon="ph:lightning" class="text-[10px]" />
										Go live
									</button>
								{/if}
							</div>
							<div onclick={() => { detailItemId = feedItem.content.id; detailBoardId = feedItem.boardId; detailExpandComments = false; }} class="cursor-pointer">
								<ContentRenderer
									item={feedItem.content}
									boardId={feedItem.boardId}
									isBoardOwner={feedItem.isOwner}
									allowComments={feedItem.allowComments}
									layout={feedLayout}
									onShare={(item) => handleShareCard(item, feedItem.boardId)}
									onCommentClick={() => { detailItemId = feedItem.content.id; detailBoardId = feedItem.boardId; detailExpandComments = true; }}
								/>
							</div>
						</div>
					{/each}
				</MasonryGrid>
			</div>
			{/if}
		{/if}
	</main>
</Page>

{#if detailItem && detailFeedItem}
	<CardDetailModal
		item={detailItem}
		boardId={detailBoardId}
		isBoardOwner={detailFeedItem.isOwner}
		allowComments={detailFeedItem.allowComments}
		expandComments={detailExpandComments}
		onClose={() => { detailItemId = null; detailExpandComments = false; }}
		onShare={(it) => {
			detailItemId = null;
			detailExpandComments = false;
			handleShareCard(it, detailBoardId);
		}}
	/>
{/if}
