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
		unfollowBoard,
		getPublicUserProfile
	} from '$lib/firebase';
	import type { PublicUserProfile } from '$lib/firebase';
	import { userStore, showToast, globalExperience } from '$lib/stores';
	import { shareContent } from '$lib/native';
	import type { BoardDoc, ContentDoc } from '$lib/types';
	import ContentRenderer from '$lib/components/ui/ContentRenderer.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import MasonryGrid from '$lib/components/ui/MasonryGrid.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';

	const boardId = $derived($page.params.boardId ?? '');

	let board = $state<BoardDoc | null>(null);
	let owner = $state<PublicUserProfile | null>(null);
	let content = $state<ContentDoc[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let followBusy = $state(false);
	let shareCopied = $state(false);

	const isFollowing = $derived(
		$userStore.user?.followingBoardIds?.includes(boardId) ?? false
	);
	const isMember = $derived(
		$userStore.user && board ? board.memberIds.includes($userStore.user.uid) : false
	);
	const memberCount = $derived(board?.memberIds.length ?? 0);

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

	async function handleShare() {
		const url = window.location.href;
		const title = board?.name ?? 'a Nearboard';
		try {
			await shareContent(title, board?.livingSummary?.headline ?? `Check out ${title} on Nearboard`, url);
		} catch {
			await navigator.clipboard.writeText(url);
			shareCopied = true;
			setTimeout(() => { shareCopied = false; }, 2000);
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

			// Owner profile is best-effort — silently ignore failures (rules / teen).
			getPublicUserProfile(b.ownerId).then((o) => { owner = o; }).catch(() => {});

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

{#snippet navRight()}
	{#if board}
		<button
			onclick={handleShare}
			aria-label="Share this board"
			class="inline-flex items-center justify-center w-9 h-9 mr-1 rounded-full text-on-surface/70
				hover:bg-surface-1 hover:text-on-surface active:scale-95 transition-all"
		>
			<Icon icon={shareCopied ? 'ph:check-bold' : 'ph:share-network'} class="text-base" />
		</button>
	{/if}
{/snippet}

<Page>
	<div>
		<Navbar title="" left={navLeft} right={navRight} />
	</div>

	<main class="px-4 {(!isMember) ? 'pb-28' : ''}">
		{#if loading}
			<!-- Hero skeleton -->
			<div class="flex flex-col items-center mt-6 mb-6 animate-pulse">
				<div class="w-16 h-16 rounded-full bg-border/40 mb-3"></div>
				<div class="h-5 w-40 bg-border/50 rounded-full mb-2"></div>
				<div class="h-3 w-24 bg-border/30 rounded-full"></div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				{#each Array(6) as _, i (i)}
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
			<!-- Hero -->
			<div class="relative mt-4 mb-5">
				<!-- Subtle gradient backdrop -->
				<div class="absolute inset-x-0 -top-4 h-32 bg-gradient-to-b from-accent/8 via-accent/3 to-transparent pointer-events-none"></div>

				<div class="relative flex flex-col items-center text-center">
					{#if owner}
						<a
							href="/u/{owner.uid}"
							class="mb-3 transition-transform active:scale-95 hover:scale-105"
							aria-label="View {owner.displayName}'s profile"
						>
							<Avatar name={owner.displayName} photoURL={owner.photoURL} size="lg" ring="card" />
						</a>
					{/if}

					<h1 class="font-display text-2xl font-bold text-on-surface leading-tight">{board.name}</h1>

					{#if owner}
						<p class="text-[13px] text-muted mt-1.5">
							by <a href="/u/{owner.uid}" class="text-on-surface/80 font-medium hover:text-accent transition-colors">{owner.displayName}</a>
						</p>
					{/if}

					{#if board.livingSummary?.headline}
						<p class="text-[14px] text-on-surface/80 italic max-w-md leading-relaxed mt-3 px-2">
							"{board.livingSummary.headline}"
						</p>
					{/if}

					<!-- Stat pills -->
					<div class="flex items-center gap-2 mt-4">
						<div class="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-1 rounded-full text-[12px] text-on-surface/70">
							<Icon icon="ph:users-three" class="text-sm" />
							<span class="font-medium">{memberCount}</span>
							<span>{memberCount === 1 ? 'member' : 'members'}</span>
						</div>
						{#if board.followerCount}
							<div class="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-1 rounded-full text-[12px] text-on-surface/70">
								<Icon icon="ph:heart" class="text-sm" />
								<span class="font-medium">{board.followerCount}</span>
								<span>{board.followerCount === 1 ? 'follower' : 'followers'}</span>
							</div>
						{/if}
						{#if content.length}
							<div class="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-1 rounded-full text-[12px] text-on-surface/70">
								<Icon icon="ph:note" class="text-sm" />
								<span class="font-medium">{content.length}</span>
							</div>
						{/if}
					</div>

					<!-- Follow button (for logged-in non-members) -->
					{#if $userStore.user && !isMember}
						<div class="mt-4">
							<Button small rounded onClick={handleFollow} disabled={followBusy}
								outline={isFollowing}
							>
								<Icon icon={isFollowing ? 'ph:check-bold' : 'ph:heart-bold'} class="text-xs mr-1.5" />
								{isFollowing ? 'Following' : 'Follow'}
							</Button>
						</div>
					{/if}
				</div>
			</div>

			<hr class="border-surface-1 mb-4" />

			{#if content.length === 0}
				<EmptyState
					icon="ph:kanban"
					title="Nothing here yet"
					description="This board is empty"
				/>
			{:else}
				<MasonryGrid columns={2} layout={$globalExperience.layoutStyle}>
					{#each content as item (item.id)}
						<ContentRenderer
							{item}
							{boardId}
							isBoardOwner={false}
							allowComments={false}
							layout={$globalExperience.layoutStyle}
						/>
					{/each}
				</MasonryGrid>
			{/if}

			<!-- Join CTA — sticky at bottom -->
			{#if !isMember}
				<div class="fixed bottom-0 left-0 right-0 z-40 px-4 pt-8 pb-safe bg-gradient-to-t from-surface via-surface/95 to-transparent">
					<div class="max-w-md mx-auto">
						<Button large rounded onClick={handleJoin} class="w-full shadow-lg">
							{$userStore.user ? 'Join this Board' : 'Join Nearboard to interact'}
						</Button>
						{#if !$userStore.user}
							<p class="text-center text-[11px] text-muted/70 mt-2">
								Sign up free — see what others are sharing in {memberCount === 1 ? 'this board' : `${memberCount} member groups`}.
							</p>
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</main>
</Page>
