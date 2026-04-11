<!--
  @file b/[boardId]/+page.svelte
  @description Read-only public board view for unauthenticated users.
               Shows board name, content grid, and a CTA to join/sign up.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '@iconify/svelte';
	import { Page, Navbar, Button } from 'konsta/svelte';
	import {
		getBoard,
		subscribeToBoardContentPaginated,
		isContentVisible,
		followBoard,
		unfollowBoard
	} from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import type { BoardDoc, ContentDoc } from '$lib/types';
	import ContentRenderer from '$lib/components/ui/ContentRenderer.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import MasonryGrid from '$lib/components/ui/MasonryGrid.svelte';

	const boardId = $derived($page.params.boardId ?? '');

	let board = $state<BoardDoc | null>(null);
	let content = $state<ContentDoc[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let followBusy = $state(false);

	const isFollowing = $derived(
		$userStore.user?.followingBoardIds?.includes(boardId) ?? false
	);
	const isMember = $derived(
		$userStore.user && board ? board.memberIds.includes($userStore.user.uid) : false
	);

	async function handleFollow() {
		const user = $userStore.user;
		if (!user || followBusy) return;
		followBusy = true;
		try {
			if (isFollowing) {
				await unfollowBoard(boardId, user.uid);
				showToast('Unfollowed board');
			} else {
				await followBoard(boardId, user.uid);
				showToast('Following board — updates will appear in your feed', 'success');
			}
			// Update local user store
			userStore.update(s => {
				if (!s.user) return s;
				const ids = s.user.followingBoardIds ?? [];
				return {
					...s,
					user: {
						...s.user,
						followingBoardIds: isFollowing
							? ids.filter(id => id !== boardId)
							: [...ids, boardId]
					}
				};
			});
		} catch {
			showToast('Failed to update follow');
		} finally {
			followBusy = false;
		}
	}

	onMount(() => {
		if (!boardId) return;

		let unsubContent: (() => void) | undefined;

		getBoard(boardId).then((b) => {
			if (!b || !b.isPublic) {
				notFound = true;
				loading = false;
				return;
			}
			board = b;
			loading = false;

			unsubContent = subscribeToBoardContentPaginated(boardId, (items) => {
				content = items.filter((item) => isContentVisible(item, false));
			});
		}).catch(() => {
			notFound = true;
			loading = false;
		});

		return () => {
			unsubContent?.();
		};
	});

	function handleJoin() {
		goto(`/join/${boardId}`);
	}
</script>

<svelte:head>
	{#if board}
		<title>{board.name} — Nearboard</title>
		<meta property="og:title" content={board.name} />
		<meta property="og:description" content={board.livingSummary?.headline || `A shared board with ${board.memberIds.length} member${board.memberIds.length === 1 ? '' : 's'}`} />
		<meta property="og:image" content={`https://us-central1-nearboard-app.cloudfunctions.net/ogBoardPreview?boardId=${boardId}`} />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<meta property="og:type" content="website" />
		<meta name="twitter:card" content="summary_large_image" />
	{/if}
</svelte:head>

{#snippet navLeft()}
	<a href="/" class="flex items-center gap-2 px-2">
		<img src="/logo.svg" alt="" class="w-6 h-6" />
		<span class="text-[15px] font-semibold text-on-surface">Nearboard</span>
	</a>
{/snippet}

<Page>
	<div>
		<Navbar title="" left={navLeft} />
	</div>

	<main class="px-4">
		{#if loading}
			<div class="grid grid-cols-2 gap-3 mt-4">
				{#each Array(6) as _, i}
					<div class="rounded-[var(--radius-card)] bg-card shadow-card overflow-hidden stagger-fade-in" style="--stagger-index: {i}">
						<div class="{i % 3 === 0 ? 'h-36' : 'h-24'} skeleton-shimmer"></div>
						<div class="p-3">
							<div class="h-3 w-3/4 skeleton-shimmer rounded mb-2"></div>
							<div class="h-2.5 w-1/2 skeleton-shimmer rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if notFound}
			<EmptyState
				icon="ph:lock-simple"
				title="Board not found"
				description="This board doesn't exist or isn't public"
				actionLabel="Go home"
				onAction={() => goto('/')}
			/>
		{:else if board}
			<!-- Board header -->
			<div class="flex flex-col items-center gap-2 mt-4 mb-4">
				<h1 class="text-xl font-bold text-on-surface">{board.name}</h1>
				<div class="flex items-center gap-3 text-[12px] text-muted">
					<span>{board.memberIds.length} {board.memberIds.length === 1 ? 'member' : 'members'}</span>
					{#if board.followerCount}
						<span>·</span>
						<span>{board.followerCount} {board.followerCount === 1 ? 'follower' : 'followers'}</span>
					{/if}
				</div>

				{#if board.livingSummary?.headline}
					<p class="text-[13px] text-muted italic text-center max-w-sm leading-relaxed mt-1">
						"{board.livingSummary.headline}"
					</p>
				{/if}

				<!-- Follow button (for logged-in non-members) -->
				{#if $userStore.user && !isMember}
					<div class="mt-1">
						<Button small rounded onClick={handleFollow} disabled={followBusy}
							outline={isFollowing}
						>
							<Icon icon={isFollowing ? 'ph:check-bold' : 'ph:plus-bold'} class="text-xs mr-1.5" />
							{isFollowing ? 'Following' : 'Follow'}
						</Button>
					</div>
				{/if}
			</div>

			<hr class="border-surface-1 mb-4" />

			{#if content.length === 0}
				<EmptyState
					icon="ph:kanban"
					title="Nothing here yet"
					description="This board is empty"
				/>
			{:else}
				<MasonryGrid columns={2}>
					{#each content as item (item.id)}
						<ContentRenderer
							{item}
							{boardId}
							isBoardOwner={false}
							allowComments={false}
						/>
					{/each}
				</MasonryGrid>
			{/if}

			<!-- Join CTA -->
			{#if !$userStore.user || !board.memberIds.includes($userStore.user.uid)}
				<div class="fixed bottom-0 left-0 right-0 z-40 p-4 pb-safe bg-gradient-to-t from-surface via-surface to-transparent">
					<Button large rounded onClick={handleJoin} class="w-full">
						Join this Board
					</Button>
				</div>
			{/if}
		{/if}
	</main>
</Page>
