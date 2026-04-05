<!--
  @file board/[boardId]/+page.svelte
  @description Board view with masonry grid, floating action speed-dial, and bottom nav.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
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
		isContentVisible
	} from '$lib/firebase';
	import { goto } from '$app/navigation';
	import { setActiveBoard, userStore, showToast, boardContentPagination, resetContentPagination } from '$lib/stores';
	import type { BoardDoc, ContentDoc, MemberDoc } from '$lib/types';
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

	let confirmDelete = $state<{ id: string; type: string } | null>(null);
	let confirmDeleteBoard = $state(false);
	let detailItemId = $state<string | null>(null);
	let detailBoardId = $state('');
	const detailItem = $derived(detailItemId ? allContent.find(c => c.id === detailItemId) ?? null : null);

	const boardId = $derived($page.params.boardId ?? '');
	const inviteLink = $derived(board ? generateShareLink(boardId) : '');
	const isOwner = $derived(board?.ownerId === $userStore.user?.uid);

	const visibleContent = $derived(
		allContent.filter((item) => isContentVisible(item, isOwner))
	);
	const filteredContent = $derived(
		filterType === 'all'
			? visibleContent
			: visibleContent.filter((item) => item.type === filterType)
	);

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
		await navigator.clipboard.writeText(inviteLink);
		showToast('Invite link copied!');
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
		});
		const unsubContent = subscribeToBoardContentPaginated(boardId, (items) => {
			firstPageContent = items;
			resetContentPagination(null);
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
			{ icon: showFabMenu ? 'ph:x-bold' : 'ph:dots-three-outline-vertical-fill', onClick: () => { showFabMenu = !showFabMenu; }, label: 'Board actions' }
		]}
	/>

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
			{#if board?.livingSummary?.content}
				<LivingSummaryCard {board} isAdmin={isOwner} />
			{/if}
			{#if nudge}
				<NudgeCard {nudge} onaction={handleNudgeAction} />
			{/if}
			<div class="mt-3">
				<MasonryGrid columns={2}>
					{#each filteredContent as item (item.id)}
						{@const canDelete = isOwner || item.authorId === $userStore.user?.uid}
						{#if canDelete}
							<SwipeAction onAction={() => { confirmDelete = { id: item.id, type: item.type }; }}>
								<div onclick={() => { detailItemId = item.id; detailBoardId = boardId; }} class="cursor-pointer">
									<ContentRenderer
										{item}
										{boardId}
										isBoardOwner={isOwner}
										allowComments={board?.allowComments}
										onDelete={(it) => { confirmDelete = { id: it.id, type: it.type }; }}
										onToggleListItem={(contentItem, itemId) => toggleListItem(boardId, contentItem.id, contentItem.items, itemId)}
										onShare={handleShareCard}
									/>
								</div>
							</SwipeAction>
						{:else}
							<div onclick={() => { detailItemId = item.id; detailBoardId = boardId; }} class="cursor-pointer">
								<ContentRenderer
									{item}
									{boardId}
									isBoardOwner={isOwner}
									allowComments={board?.allowComments}
									onDelete={(it) => { confirmDelete = { id: it.id, type: it.type }; }}
									onToggleListItem={(contentItem, itemId) => toggleListItem(boardId, contentItem.id, contentItem.items, itemId)}
									onShare={handleShareCard}
								/>
							</div>
						{/if}
					{/each}
				</MasonryGrid>
			</div>
		{/if}
	</main>
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
		onClose={() => { detailItemId = null; }}
		onDelete={(it) => { confirmDelete = { id: it.id, type: it.type }; detailItemId = null; }}
		onShare={handleShareCard}
		onToggleListItem={(contentItem, itemId) => toggleListItem(boardId, contentItem.id, contentItem.items, itemId)}
	/>
{/if}
