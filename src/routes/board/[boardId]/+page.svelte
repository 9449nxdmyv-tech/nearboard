<!--
  @file board/[boardId]/+page.svelte
  @description Board view with masonry grid, floating action speed-dial, and bottom nav.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy, setContext } from 'svelte';
	import Icon from '@iconify/svelte';
	import {
		subscribeToBoard,
		subscribeToBoardContentPaginated,
		subscribeToBoardMembers,
		markBoardRead,
		syncMemberProfile,
		heartbeatPresence,
		deleteContent,
		deleteBoard,
		toggleListItem,
		generateShareLink,
		enableBoardSummaries,
		isContentVisible
	} from '$lib/firebase';
	import { goto } from '$app/navigation';
	import { setActiveBoard, userStore, showToast, boardContentPagination, resetContentPagination, loadMoreBoardContent } from '$lib/stores';
	import { isPlus } from '$lib/utils/tier';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import type { BoardDoc, ContentDoc, MemberDoc, FeedOrder } from '$lib/types';
	import { Popover } from 'konsta/svelte';
	import { getEffectiveExperience } from '$lib/stores';
	import { shareContent, shareBoardInvite } from '$lib/utils/share';
	import { Page, Actions, ActionsGroup, ActionsButton } from 'konsta/svelte';
	import ContentRenderer from '$lib/components/ui/ContentRenderer.svelte';
	import CardDetailModal from '$lib/components/ui/CardDetailModal.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Header from '$lib/components/ui/Header.svelte';
	import MasonryGrid from '$lib/components/ui/MasonryGrid.svelte';
	import AvatarStack from '$lib/components/ui/AvatarStack.svelte';
	import NudgeCard from '$lib/components/ui/NudgeCard.svelte';
	import LivingSummaryCard from '$lib/components/ui/LivingSummaryCard.svelte';
	import SkeletonCard from '$lib/components/ui/SkeletonCard.svelte';
	import SwipeAction from '$lib/components/ui/SwipeAction.svelte';
	import BoardChatView from '$lib/components/ui/BoardChatView.svelte';
	import { getNudgeToShow } from '$lib/utils/onboardingUtils';
	import { getEmptyBoardPrompt } from '$lib/utils/emptyStatePrompts';

	type BoardFilterType = 'all' | 'note' | 'list' | 'link' | 'photo' | 'video' | 'voice' | 'poll' | 'location' | 'product';

	const FILTER_OPTIONS: { value: BoardFilterType; label: string; icon: string }[] = [
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

	const SORT_OPTIONS: { value: FeedOrder; label: string; icon: string; description: string }[] = [
		{ value: 'newest', label: 'Newest first', icon: 'ph:clock-counter-clockwise', description: 'Latest additions on top' },
		{ value: 'oldest', label: 'Oldest first', icon: 'ph:clock', description: 'Earliest first, story order' },
		{ value: 'most-active', label: 'Most active', icon: 'ph:fire', description: 'Comments and reactions first' },
		{ value: 'curated', label: 'Curated', icon: 'ph:sparkle', description: 'A thoughtful mix' }
	];

	let filterType = $state<BoardFilterType>('all');
	let showFabMenu = $state(false);
	// `null` means "follow the board/user setting"; a concrete value is a session override.
	let sortOverride = $state<FeedOrder | null>(null);
	let sortMenuOpen = $state(false);
	let sortMenuTarget = $state<HTMLButtonElement | undefined>();

	let board = $state<BoardDoc | null>(null);
	let firstPageContent = $state<ContentDoc[]>([]);
	let members = $state<MemberDoc[]>([]);
	let loading = $state(true);

	const allContent = $derived.by(() => {
		const seen = new Set(firstPageContent.map((c) => c.id));
		const deduped = $boardContentPagination.extraContent.filter((c) => !seen.has(c.id));
		return [...firstPageContent, ...deduped];
	});

	/** Resolve current author photo from member list, fallback to snapshot URL */
	const memberPhotoMap = $derived.by(() => {
		const map = new Map<string, string | null>();
		for (const m of members) map.set(m.userId, m.photoURL);
		return map;
	});
	const resolveAuthorPhoto = $derived(
		(authorId: string, snapshotUrl: string | null): string | null => {
			// Current user: always use their latest profile photo
			if (authorId === $userStore.user?.uid) return $userStore.user?.photoURL ?? null;
			// Board member: use current member photo
			if (memberPhotoMap.has(authorId)) return memberPhotoMap.get(authorId) ?? null;
			// Fallback to stored snapshot
			return snapshotUrl;
		}
	);

	let confirmDelete = $state<{ id: string; type: string } | null>(null);
	let confirmDeleteBoard = $state(false);
	let detailItemId = $state<string | null>(null);
	let detailBoardId = $state('');
	let detailExpandComments = $state(false);
	const detailItem = $derived(detailItemId ? allContent.find(c => c.id === detailItemId) ?? null : null);

	const boardId = $derived($page.params.boardId ?? '');
	const inviteLink = $derived(board ? generateShareLink(boardId) : '');
	const isOwner = $derived(board?.ownerId === $userStore.user?.uid);
	const isUserPlus = $derived(isPlus($userStore.user));
	const boardExperience = $derived(getEffectiveExperience($userStore.user?.experiencePreferences, board?.experienceOverrides));
	const scrollBehavior = $derived(boardExperience.scrollBehavior);
	setContext('videoPlayback', () => boardExperience.videoPlayback);
	setContext('commentLayout', () => boardExperience.commentLayout);

	// Infinite scroll observer
	let infiniteScrollEl = $state<HTMLDivElement | undefined>();
	let infiniteObserver: IntersectionObserver | undefined;

	$effect(() => {
		infiniteObserver?.disconnect();
		if (scrollBehavior !== 'infinite' || !infiniteScrollEl) return;
		infiniteObserver = new IntersectionObserver((entries) => {
			if (entries[0]?.isIntersecting && $boardContentPagination.hasMore && !$boardContentPagination.loadingMore) {
				loadMoreBoardContent(boardId);
			}
		}, { rootMargin: '200px' });
		infiniteObserver.observe(infiniteScrollEl);
	});

	onDestroy(() => infiniteObserver?.disconnect());

	const visibleContent = $derived(
		allContent.filter((item) => isContentVisible(item, isOwner))
	);

	const effectiveSort: FeedOrder = $derived(sortOverride ?? boardExperience.feedOrder);

	function engagementScore(item: ContentDoc): number {
		const comments = item.commentCount ?? 0;
		const acks = item.acknowledgments ? Object.keys(item.acknowledgments).length : 0;
		return comments * 2 + acks;
	}

	function sortBoardItems(items: ContentDoc[], order: FeedOrder): ContentDoc[] {
		const sorted = [...items];
		const ms = (i: ContentDoc) => i.createdAt?.toMillis?.() ?? 0;
		switch (order) {
			case 'oldest':
				return sorted.sort((a, b) => ms(a) - ms(b));
			case 'most-active':
				return sorted.sort((a, b) => {
					const diff = engagementScore(b) - engagementScore(a);
					return diff !== 0 ? diff : ms(b) - ms(a);
				});
			case 'curated':
				// No backend ranking yet — fall back to newest so the option is
				// still honored without producing a random shuffle.
				return sorted.sort((a, b) => ms(b) - ms(a));
			case 'newest':
			default:
				return sorted.sort((a, b) => ms(b) - ms(a));
		}
	}

	const filteredContent = $derived.by(() => {
		const filtered = filterType === 'all'
			? visibleContent
			: visibleContent.filter((item) => item.type === filterType);
		return sortBoardItems(filtered, effectiveSort);
	});

	const currentSortOption = $derived(SORT_OPTIONS.find((o) => o.value === effectiveSort) ?? SORT_OPTIONS[0]);

	/** Filter options that have at least one item in the board, with counts. */
	const pillOptions = $derived.by(() => {
		const counts = new Map<BoardFilterType, number>();
		for (const item of visibleContent) counts.set(item.type as BoardFilterType, (counts.get(item.type as BoardFilterType) ?? 0) + 1);
		const out: { value: BoardFilterType; label: string; icon: string; count: number }[] = [
			{ value: 'all', label: 'All', icon: FILTER_OPTIONS[0].icon, count: visibleContent.length }
		];
		for (const opt of FILTER_OPTIONS) {
			if (opt.value === 'all') continue;
			const c = counts.get(opt.value) ?? 0;
			if (c > 0) out.push({ ...opt, count: c });
		}
		return out;
	});

	const nudge = $derived.by(() => {
		const user = $userStore.user;
		if (!user || !board) return null;
		return getNudgeToShow({
			realCardCount: visibleContent.length,
			memberCount: board.memberIds.length,
			hasSkippedInvite: user.hasSkippedInvite ?? false,
			seenNudges: user.seenNudges ?? [],
			hasAiSummary: !!board.livingSummary?.content
		});
	});

	function handleNudgeAction() {
		if (!nudge?.action) return;
		if (nudge.action.type === 'invite') copyShareLink();
	}

	function handleShareCard(item: ContentDoc) {
		shareContent(item, boardId);
	}

	async function handleDeleteCard(contentId: string) {
		try {
			await deleteContent(boardId, contentId);
		} catch {
			showToast('Failed to delete', 'error');
		}
		confirmDelete = null;
	}

	async function handleDeleteBoard() {
		try {
			await deleteBoard(boardId);
			goto('/');
		} catch {
			showToast('Failed to delete board', 'error');
		}
	}

	async function copyShareLink() {
		showFabMenu = false;
		await copyToClipboard(inviteLink, 'Invite link copied!');
	}

	async function inviteFromAvatarStack() {
		if (!inviteLink) return;
		await shareBoardInvite(board?.name ?? '', inviteLink);
	}

	function openSettings() {
		showFabMenu = false;
		goto(`/board/${boardId}/settings`);
	}

	onMount(() => {
		if (!boardId) return;
		setActiveBoard(boardId);

		const user = $userStore.user;
		if (user) {
			const readKey = `nb_read_${boardId}`;
			const now = Date.now();
			const lastRead = parseInt(localStorage.getItem(readKey) ?? '0');
			if (now - lastRead > 3_600_000) {
				markBoardRead(boardId, user.uid).catch(() => {});
				localStorage.setItem(readKey, String(now));
			}
		}

		const unsubBoard = subscribeToBoard(boardId, (b) => {
			board = b;
			loading = false;
			if (user) {
				syncMemberProfile(boardId, user.uid, user.displayName || '', user.photoURL || null);
			}
			// Backfill enableLivingSummary on old boards where the field is undefined.
			// processDirtyBoards queries `where == true`, which excludes missing fields,
			// so these boards would never get summaries without this one-time migration.
			if (b && user && b.ownerId === user.uid && b.enableLivingSummary === undefined) {
				enableBoardSummaries(boardId).catch(() => {});
			}
		});
		const unsubContent = subscribeToBoardContentPaginated(boardId, (items, lastDoc) => {
			firstPageContent = items;
			resetContentPagination(lastDoc);
		}, (err) => {
			console.error('Board content subscription error:', err);
		});
		const unsubMembers = subscribeToBoardMembers(boardId, (m) => {
			members = m;
		});

		// Presence heartbeat — drives the soft pulse on AvatarStack for users
		// actively viewing the board. Pinged on mount and every 30s; the pulse
		// fades client-side once the timestamp ages past ~90s.
		let presenceTimer: ReturnType<typeof setInterval> | undefined;
		if (user) {
			heartbeatPresence(boardId, user.uid).catch(() => {});
			presenceTimer = setInterval(() => {
				if (document.visibilityState === 'visible') {
					heartbeatPresence(boardId, user.uid).catch(() => {});
				}
			}, 30_000);
		}

		return () => {
			unsubBoard();
			unsubContent();
			unsubMembers();
			if (presenceTimer) clearInterval(presenceTimer);
			setActiveBoard(null);
		};
	});

</script>

<Page>
	<Header
		title={board?.name || 'Board'}
		backHref="/"
		actions={[
			{ icon: showFabMenu ? 'ph:x-bold' : 'ph:dots-three-outline-vertical', onClick: () => { showFabMenu = !showFabMenu; }, label: 'Board actions' }
		]}
	/>

	{#if boardExperience.commentLayout === 'chat' && !loading}
		<!-- Chat layout: full-height message thread -->
		<main class="flex-1 flex flex-col overflow-hidden relative">
			<BoardChatView
				{board}
				content={visibleContent}
				{boardId}
				{isOwner}
				onDetailOpen={(itemId) => { detailItemId = itemId; detailBoardId = boardId; detailExpandComments = false; }}
			onReplyOpen={(itemId) => { detailItemId = itemId; detailBoardId = boardId; detailExpandComments = true; }}
			/>
		</main>
	{:else}
		<!-- Inline layout: card grid -->
		<main class="px-4">
			<!-- Living Summary header — the "welcome home" message.
			     Sits above member faces and filters so it's the first thing readers see. -->
			{#if board && !loading && board.enableLivingSummary !== false}
				<div class="mt-8">
					<LivingSummaryCard {board} isAdmin={isOwner} isPlus={isUserPlus} contentCount={visibleContent.length} />
				</div>
			{/if}

			<!-- Members -->
			{#if board && !loading}
				<div class="flex justify-start mt-6 mb-6">
					<AvatarStack uids={board.memberIds} {boardId} size="lg" limit={4} onInvite={inviteFromAvatarStack} />
				</div>

				<!-- Sort + filter pills: sort sits at the leading edge as a fixed
				     affordance; filter pills scroll beside it. -->
				{#if pillOptions.length > 1 || visibleContent.length > 1}
					<div class="-mx-4 mb-4">
						<div class="overflow-x-auto overflow-y-hidden scrollbar-hide">
							<div class="inline-flex items-center gap-3 px-4 py-1.5 min-w-full">
								<!-- Sort pill (icon + caret) -->
								<button
									bind:this={sortMenuTarget}
									onclick={() => { sortMenuOpen = !sortMenuOpen; }}
									class="inline-flex items-center gap-1 w-9 h-9 justify-center rounded-full
										press-scale transition-colors shrink-0
										bg-surface-1 text-on-surface active:bg-surface-2"
									aria-haspopup="menu"
									aria-expanded={sortMenuOpen}
									aria-label="Sort: {currentSortOption.label}"
									title="Sort: {currentSortOption.label}"
								>
									<Icon icon={currentSortOption.icon} class="text-[15px] text-on-surface" />
								</button>

								{#if pillOptions.length > 1}
									<div class="w-px h-5 bg-border shrink-0" aria-hidden="true"></div>
								{/if}

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
								{@const active = effectiveSort === opt.value}
								<button
									role="menuitemradio"
									aria-checked={active}
									onclick={() => { sortOverride = opt.value; sortMenuOpen = false; }}
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
							{#if sortOverride !== null && sortOverride !== boardExperience.feedOrder}
								<div class="border-t border-border-light mt-1 pt-1">
									<button
										onclick={() => { sortOverride = null; sortMenuOpen = false; }}
										class="w-full flex items-center gap-2 px-4 py-2 text-left text-[11px] text-muted active:bg-surface-1 transition-colors"
									>
										<Icon icon="ph:arrow-counter-clockwise" class="text-xs" />
										Reset to board default ({SORT_OPTIONS.find(o => o.value === boardExperience.feedOrder)?.label})
									</button>
								</div>
							{/if}
						</div>
					</Popover>
				{/if}
			{/if}

			{#if loading}
				<div class="grid grid-cols-2 gap-3 mt-4">
					{#each Array(6) as _, i (i)}
						<div class="stagger-fade-in" style="--stagger-index: {i}">
							<SkeletonCard variant={i % 3 === 0 ? 'photo' : 'small'} />
						</div>
					{/each}
				</div>
			{:else if visibleContent.length === 0}
				{@const prompt = getEmptyBoardPrompt(board?.template)}
				<EmptyState
					icon={prompt.icon}
					title={prompt.title}
					description={prompt.description}
				/>
			{:else if filteredContent.length === 0}
				<EmptyState
					icon="ph:funnel"
					title="No items found"
					description="No items match your current filter"
					actionLabel="Clear filter"
					onAction={() => { filterType = 'all'; }}
				/>
			{:else}
				{#if nudge}
					<NudgeCard {nudge} onaction={handleNudgeAction} />
				{/if}
				<div class="mt-3">
					<MasonryGrid columns={2} layout={boardExperience.layoutStyle}>
						{#each filteredContent as item (item.id)}
							{@const canDelete = isOwner || item.authorId === $userStore.user?.uid}
							{#if canDelete}
								<SwipeAction onAction={() => { confirmDelete = { id: item.id, type: item.type }; }}>
									<div onclick={() => { detailItemId = item.id; detailBoardId = boardId; detailExpandComments = false; }} class="cursor-pointer">
										<ContentRenderer
											{item}
											{boardId}
											isBoardOwner={isOwner}
											allowComments={board?.allowComments}
											{resolveAuthorPhoto}
											layout={boardExperience.layoutStyle}
											onDelete={(it) => { confirmDelete = { id: it.id, type: it.type }; }}
											onToggleListItem={(contentItem, itemId) => toggleListItem(boardId, contentItem.id, contentItem.items, itemId)}
											onShare={handleShareCard}
											onCommentClick={() => { detailItemId = item.id; detailBoardId = boardId; detailExpandComments = true; }}
										/>
									</div>
								</SwipeAction>
							{:else}
								<div onclick={() => { detailItemId = item.id; detailBoardId = boardId; detailExpandComments = false; }} class="cursor-pointer">
									<ContentRenderer
										{item}
										{boardId}
										isBoardOwner={isOwner}
										allowComments={board?.allowComments}
										{resolveAuthorPhoto}
										layout={boardExperience.layoutStyle}
										onDelete={(it) => { confirmDelete = { id: it.id, type: it.type }; }}
										onToggleListItem={(contentItem, itemId) => toggleListItem(boardId, contentItem.id, contentItem.items, itemId)}
										onShare={handleShareCard}
										onCommentClick={() => { detailItemId = item.id; detailBoardId = boardId; detailExpandComments = true; }}
									/>
								</div>
							{/if}
						{/each}
					</MasonryGrid>

					<!-- Scroll behavior controls -->
					{#if $boardContentPagination.hasMore}
						{#if scrollBehavior === 'load-more'}
							<div class="flex justify-center py-6">
								<button
									onclick={() => loadMoreBoardContent(boardId)}
									disabled={$boardContentPagination.loadingMore}
									class="px-6 py-2.5 text-sm font-medium rounded-full bg-surface-1 text-on-surface active:opacity-80 transition-opacity disabled:opacity-50"
								>
									{$boardContentPagination.loadingMore ? 'Loading...' : 'Load more'}
								</button>
							</div>
						{:else if scrollBehavior === 'infinite'}
							<div bind:this={infiniteScrollEl} class="h-1"></div>
							{#if $boardContentPagination.loadingMore}
								<div class="flex justify-center py-4">
									<div class="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin"></div>
								</div>
							{/if}
						{:else if scrollBehavior === 'paged'}
							<div class="flex justify-center py-6">
								<button
									onclick={() => loadMoreBoardContent(boardId)}
									disabled={$boardContentPagination.loadingMore}
									class="px-6 py-2.5 text-sm font-medium rounded-full bg-surface-1 text-on-surface active:opacity-80 transition-opacity disabled:opacity-50"
								>
									{$boardContentPagination.loadingMore ? 'Loading...' : 'Next page →'}
								</button>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</main>
	{/if}
</Page>

<!-- Board actions sheet (z-50 ensures it's above bottom tabbar z-40) -->
<div class="relative z-50">
<Actions opened={showFabMenu} onBackdropClick={() => { showFabMenu = false; }}>
	<ActionsGroup>
		<ActionsButton onClick={copyShareLink}>
			Invite to Board
		</ActionsButton>
		<ActionsButton onClick={openSettings}>
			Board Settings
		</ActionsButton>
	</ActionsGroup>
	<ActionsGroup>
		<ActionsButton onClick={() => { showFabMenu = false; }} bold>
			Cancel
		</ActionsButton>
	</ActionsGroup>
</Actions>
</div>

{#if confirmDelete}
	<ConfirmDialog
		title="Delete {confirmDelete.type}?"
		message="This action cannot be undone."
		onConfirm={() => { if (confirmDelete) handleDeleteCard(confirmDelete.id); }}
		onCancel={() => { confirmDelete = null; }}
	/>
{/if}

{#if confirmDeleteBoard}
	<ConfirmDialog
		title="Delete this board?"
		message="All content will be permanently deleted."
		confirmLabel="Delete Board"
		onConfirm={handleDeleteBoard}
		onCancel={() => { confirmDeleteBoard = false; }}
	/>
{/if}

{#if detailItem}
	<CardDetailModal
		item={detailItem}
		boardId={detailBoardId}
		isBoardOwner={isOwner}
		allowComments={board?.allowComments}
		expandComments={detailExpandComments}
		{resolveAuthorPhoto}
		onClose={() => { detailItemId = null; detailExpandComments = false; }}
		onDelete={(it) => { confirmDelete = { id: it.id, type: it.type }; detailItemId = null; detailExpandComments = false; }}
		onShare={handleShareCard}
		onToggleListItem={(contentItem, itemId) => toggleListItem(boardId, contentItem.id, contentItem.items, itemId)}
	/>
{/if}
