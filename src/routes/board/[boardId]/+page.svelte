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
		deleteContent,
		deleteBoard,
		toggleListItem,
		generateShareLink,
		enableBoardSummaries,
		isContentVisible
	} from '$lib/firebase';
	import { goto } from '$app/navigation';
	import { setActiveBoard, userStore, showToast, boardContentPagination, resetContentPagination, loadMoreBoardContent } from '$lib/stores';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import type { BoardDoc, ContentDoc, MemberDoc } from '$lib/types';
	import { getEffectiveExperience } from '$lib/stores';
	import { shareContent } from '$lib/utils/share';
	import { Page, Sheet, Actions, ActionsGroup, ActionsButton, ActionsLabel } from 'konsta/svelte';
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

	let filterType = $state<BoardFilterType>('all');
	let showFabMenu = $state(false);
	let showFilterSheet = $state(false);

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
	const boardExperience = $derived(getEffectiveExperience($userStore.user?.experiencePreferences, board?.experienceOverrides));
	const scrollBehavior = $derived(boardExperience.scrollBehavior);
	setContext('videoPlayback', () => boardExperience.videoPlayback);
	setContext('conversationMode', () => boardExperience.conversationMode);

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
	const filteredContent = $derived.by(() => {
		const items = filterType === 'all'
			? visibleContent
			: visibleContent.filter((item) => item.type === filterType);
		if (boardExperience.feedOrder === 'oldest') {
			return [...items].reverse();
		}
		return items;
	});

	const activeFilterCount = $derived(
		FILTER_OPTIONS.filter(opt => opt.value !== 'all' && visibleContent.some(c => c.type === opt.value)).length
	);

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

	function openSettings() {
		showFabMenu = false;
		goto(`/board/${boardId}/settings`);
	}

	function toggleFilterSheet() {
		showFabMenu = false;
		showFilterSheet = !showFilterSheet;
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

		return () => {
			unsubBoard();
			unsubContent();
			unsubMembers();
			setActiveBoard(null);
		};
	});

	$effect(() => {
		filterType;
		resetContentPagination(null);
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

	{#if boardExperience.conversationMode === 'chat' && !loading}
		<!-- Chat mode: full-height message thread -->
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
		<!-- Board / Hybrid mode: card grid -->
		<main class="px-4">
			<!-- Members + filter -->
			{#if board && !loading}
				<div class="flex flex-col items-center gap-1.5 mt-4 mb-2">
					<AvatarStack uids={board.memberIds} {boardId} size="md" />
					<span class="text-[11px] text-muted font-medium">{board.memberIds.length} {board.memberIds.length === 1 ? 'member' : 'members'}</span>

					{#if filterType !== 'all'}
						<button
							onclick={() => { filterType = 'all'; }}
							class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium
								bg-primary text-white shadow-sm press-scale mt-1"
						>
							<Icon icon={FILTER_OPTIONS.find(o => o.value === filterType)?.icon ?? 'ph:funnel'} class="text-xs" />
							{FILTER_OPTIONS.find(o => o.value === filterType)?.label}
							<Icon icon="ph:x" class="text-[10px]" />
						</button>
					{/if}
				</div>

				<hr class="border-surface-1 mb-4" />
			{/if}

			{#if loading}
				<div class="grid grid-cols-2 gap-3 mt-4">
					{#each Array(6) as _, i}
						<div class="stagger-fade-in" style="--stagger-index: {i}">
							<SkeletonCard variant={i % 3 === 0 ? 'photo' : 'small'} />
						</div>
					{/each}
				</div>
			{:else if visibleContent.length === 0}
				<EmptyState
					icon="ph:kanban"
					title="This board is empty"
					description="Tap + to add notes, links, photos, and more"
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
				{#if board && board.enableLivingSummary !== false}
					<LivingSummaryCard {board} isAdmin={isOwner} contentCount={visibleContent.length} />
				{/if}
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
		<ActionsButton onClick={toggleFilterSheet} bold={filterType !== 'all'}>
			Filter {filterType !== 'all' ? `(${FILTER_OPTIONS.find(o => o.value === filterType)?.label})` : ''}
		</ActionsButton>
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

<!-- Filter bottom sheet -->
<Sheet opened={showFilterSheet} onBackdropClick={() => { showFilterSheet = false; }}>
	<div class="px-5 pt-4 pb-2 flex items-center justify-between">
		<h3 class="text-[15px] font-semibold text-on-surface">Filter by type</h3>
		{#if filterType !== 'all'}
			<button
				onclick={() => { filterType = 'all'; showFilterSheet = false; }}
				class="text-[13px] text-primary font-medium press-scale"
			>
				Clear
			</button>
		{/if}
	</div>

	<div class="px-4 pb-5">
		<div class="grid grid-cols-3 gap-2">
			{#each FILTER_OPTIONS as opt (opt.value)}
				{@const count = opt.value === 'all' ? visibleContent.length : visibleContent.filter(c => c.type === opt.value).length}
				{@const active = filterType === opt.value}
				{#if opt.value === 'all' || count > 0}
					<button
						onclick={() => { filterType = opt.value; showFilterSheet = false; }}
						class="flex flex-col items-center gap-1.5 py-3 rounded-2xl transition-all duration-200 press-scale
							{active
								? 'bg-primary text-white shadow-sm'
								: 'bg-surface-1 text-on-surface active:bg-surface-2'}"
					>
						<Icon icon={opt.icon} class="text-xl {active ? '' : 'text-muted'}" />
						<span class="text-[11px] font-medium">{opt.label}</span>
						<span class="text-[10px] {active ? 'text-white/70' : 'text-muted'} tabular-nums">{count}</span>
					</button>
				{/if}
			{/each}
		</div>
	</div>
</Sheet>

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
