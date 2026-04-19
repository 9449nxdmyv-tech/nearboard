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
		markAllFeedRead,
		setSortMode
	} from '$lib/stores';
	import {
		subscribeToBoardContentPaginated,
		fetchLatestBoardContent,
		isContentVisible,
		updateLastSeen,
		getBoard
	} from '$lib/firebase';
	import type { ContentDoc } from '$lib/types';
	import { shareContent } from '$lib/utils/share';
	import ContentRenderer from '$lib/components/ui/ContentRenderer.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import MasonryGrid from '$lib/components/ui/MasonryGrid.svelte';
	import { globalExperience } from '$lib/stores';

	import { Page } from 'konsta/svelte';
	import CardDetailModal from '$lib/components/ui/CardDetailModal.svelte';

	const sortedItems = $derived(sortFeedItems($feedStore.items, $feedStore.sortMode));
	const feedLayout = $derived($globalExperience.layoutStyle);

	let detailItemId = $state<string | null>(null);
	let detailBoardId = $state('');
	const detailItem = $derived(
		detailItemId ? sortedItems.find((f) => f.content.id === detailItemId)?.content ?? null : null
	);

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
						boardContentMap.set(board.id, items);
						rebuildFeed();
					})
					.catch(() => { /* permission denied or deleted — skip */ });
			}
		}

		// Followed boards (non-member, typically few): always one-shot
		for (const fId of followOnlyIds) {
			getBoard(fId).then((b) => {
				if (!b || !b.isPublic) return;
				followedBoardMeta.set(fId, { name: b.name, ownerId: b.ownerId, allowComments: false });
				return fetchLatestBoardContent(fId).then((items) => {
					boardContentMap.set(fId, items);
					rebuildFeed();
				});
			}).catch(() => { /* board may have been deleted */ });
		}

		// Rebuild when member board metadata (names, ownership) changes
		const unsubBoardStore = boardStore.subscribe(() => rebuildFeed());

		return () => {
			clearTimeout(rebuildTimer);
			for (const u of unsubsByBoard.values()) u();
			unsubsByBoard.clear();
			liveBoardIds.clear();
			unsubBoardStore();
		};
	});

	async function markAllRead() {
		const user = $userStore.user;
		if (!user) return;
		try {
			const boards = $boardStore.boards;
			await Promise.all([
				updateLastSeen(user.uid),
				...boards.map((b) => import('$lib/firebase').then(({ markBoardRead }) => markBoardRead(b.id, user.uid)))
			]);
			markAllFeedRead();
			showToast('Marked all as read', 'success');
		} catch {
			showToast('Failed to mark as read', 'error');
		}
	}
</script>

<Page>
	<Header title="Feed">
		{#if !$feedStore.loading && $feedStore.unseenCount > 0}
			<button
				onclick={markAllRead}
				class="text-xs text-primary font-medium"
			>
				Mark all read
			</button>
		{/if}
	</Header>

	<main class="flex-1 px-4">
		{#if $feedStore.loading}
			<div class="flex flex-col gap-4 mt-4">
				{#each Array(4) as _, i}
					<div class="rounded-[var(--radius-card)] bg-card shadow-card overflow-hidden stagger-fade-in" style="--stagger-index: {i}">
						<div class="h-36 skeleton-shimmer"></div>
						<div class="p-4">
							<div class="h-4 w-3/4 skeleton-shimmer rounded mb-2.5"></div>
							<div class="h-3 w-1/2 skeleton-shimmer rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if sortedItems.length === 0}
			<EmptyState
				icon="ph:rss"
				title="Feed is empty"
				description="Content from all your boards will appear here"
			/>
		{:else}
			<div class="mt-4">
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
							<div onclick={() => { detailItemId = feedItem.content.id; detailBoardId = feedItem.boardId; }} class="cursor-pointer">
								<ContentRenderer
									item={feedItem.content}
									boardId={feedItem.boardId}
									isBoardOwner={feedItem.isOwner}
									allowComments={feedItem.allowComments}
									onShare={(item) => handleShareCard(item, feedItem.boardId)}
									onCommentClick={() => { detailItemId = feedItem.content.id; detailBoardId = feedItem.boardId; }}
								/>
							</div>
						</div>
					{/each}
				</MasonryGrid>
			</div>
		{/if}
	</main>
</Page>

{#if detailItem}
	<CardDetailModal
		item={detailItem}
		boardId={detailBoardId}
		onClose={() => { detailItemId = null; }}
		onShare={(it) => {
			detailItemId = null;
			handleShareCard(it, detailBoardId);
		}}
	/>
{/if}
