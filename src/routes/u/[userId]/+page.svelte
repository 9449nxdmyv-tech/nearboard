<!--
  @file u/[userId]/+page.svelte
  @description User profile page. Shows avatar, display name, board stats,
               and all boards (private ones blurred with lock icon).
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import { avatarInitial } from '$lib/utils/textFormatter';
	import BoardPreviewMosaic from '$lib/components/ui/BoardPreviewMosaic.svelte';
	import StreakBadge from '$lib/components/ui/StreakBadge.svelte';
	import AvatarStack from '$lib/components/ui/AvatarStack.svelte';
	import { userStore, showToast } from '$lib/stores';
	import { shareContent } from '$lib/native';
	import {
		getPublicUserProfile,
		getAllBoardsForUser,
		requestToJoin,
		getUserJoinRequestStatus
	} from '$lib/firebase';
	import { Page } from 'konsta/svelte';
	import type { BoardDoc, JoinRequestDoc } from '$lib/types';

	const userId = $derived($page.params.userId ?? '');
	const currentUser = $derived($userStore.user);
	const authLoading = $derived($userStore.loading);

	let profile = $state<{ uid: string; displayName: string; photoURL: string | null; createdAt: import('firebase/firestore').Timestamp } | null>(null);
	let boards = $state<BoardDoc[]>([]);
	let loading = $state(true);
	let notFound = $state(false);

	// Track join request status per board
	let requestStatuses = $state<Record<string, JoinRequestDoc | null>>({});
	let requestingBoard = $state<string | null>(null);
	let profileLinkCopied = $state(false);

	const publicCount = $derived(boards.filter((b) => b.isPublic).length);
	const privateCount = $derived(boards.filter((b) => !b.isPublic).length);
	const ownedCount = $derived(boards.filter((b) => b.ownerId === userId).length);

	// Wait for auth to settle, then load profile
	$effect(() => {
		if (authLoading) return;
		if (!currentUser) {
			loading = false;
			return;
		}
		const targetUserId = userId;
		loading = true;
		notFound = false;
		profile = null;
		boards = [];
		loadProfile(targetUserId);
	});

	async function loadProfile(targetUserId: string) {
		try {
			profile = await getPublicUserProfile(targetUserId);
			if (!profile) {
				notFound = true;
				return;
			}
			boards = await getAllBoardsForUser(targetUserId);

			if (currentUser) {
				const statuses: Record<string, JoinRequestDoc | null> = {};
				await Promise.all(
					boards.map(async (board) => {
						if (!board.memberIds.includes(currentUser.uid)) {
							try {
								statuses[board.id] = await getUserJoinRequestStatus(board.id, currentUser.uid);
							} catch {
								// index may not be deployed yet
							}
						}
					})
				);
				requestStatuses = statuses;
			}
		} catch (err) {
			console.error('Failed to load profile:', err);
			notFound = true;
		} finally {
			loading = false;
		}
	}

	function formatMemberSince(ts: import('firebase/firestore').Timestamp | undefined): string {
		if (!ts) return 'a while ago';
		const d = ts.toDate();
		return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
	}

	function isMember(board: BoardDoc): boolean {
		return !!currentUser && board.memberIds.includes(currentUser.uid);
	}

	function hasPendingRequest(boardId: string): boolean {
		return requestStatuses[boardId]?.status === 'pending';
	}

	async function handleRequestToJoin(boardId: string) {
		if (!currentUser) return;
		requestingBoard = boardId;
		try {
			await requestToJoin(boardId, {
				uid: currentUser.uid,
				displayName: currentUser.displayName ?? '',
				photoURL: currentUser.photoURL ?? null
			});
			requestStatuses = {
				...requestStatuses,
				[boardId]: { status: 'pending' } as JoinRequestDoc
			};
			showToast('Join request sent', 'success');
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to send request';
			showToast(msg);
		} finally {
			requestingBoard = null;
		}
	}

	async function handleShareProfile() {
		const url = window.location.href;
		const name = profile?.displayName ?? 'this user';
		try {
			await shareContent(`${name} on Nearboard`, `Check out ${name}'s profile on Nearboard`, url);
		} catch {
			await navigator.clipboard.writeText(url);
			profileLinkCopied = true;
			setTimeout(() => { profileLinkCopied = false; }, 2000);
		}
	}
</script>

<svelte:head>
	<title>{profile?.displayName ?? 'Profile'} — Nearboard</title>
</svelte:head>

<Page>
	{#if loading || authLoading}
		<!-- Loading skeleton -->
		<div class="flex-1 px-6 py-8">
			<div class="flex flex-col items-center animate-pulse">
				<div class="w-20 h-20 rounded-full bg-border/60 mb-4"></div>
				<div class="h-5 bg-border/60 rounded-full w-32 mb-2"></div>
				<div class="h-3 bg-border/40 rounded-full w-24 mb-6"></div>
				<div class="flex gap-6">
					<div class="h-10 w-16 bg-border/40 rounded-xl"></div>
					<div class="h-10 w-16 bg-border/40 rounded-xl"></div>
					<div class="h-10 w-16 bg-border/40 rounded-xl"></div>
				</div>
			</div>
		</div>
	{:else if !currentUser}
		<div class="flex-1 flex flex-col items-center justify-center px-6">
			<div class="w-16 h-16 rounded-full bg-accent/8 flex items-center justify-center mb-4">
				<Icon icon="ph:user-circle" class="text-3xl text-on-surface/40" />
			</div>
			<p class="text-primary font-semibold text-[15px]">Sign in to view profiles</p>
			<p class="text-sm text-muted mt-1.5 mb-5 text-center max-w-[260px]">Create an account to discover boards and connect with others.</p>
			<a
				href="/onboarding"
				class="px-6 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold
					active:scale-[0.98] transition-transform shadow-md"
			>
				Sign up
			</a>
		</div>
	{:else if notFound}
		<div class="flex-1 flex flex-col items-center justify-center px-6">
			<div class="w-16 h-16 rounded-full bg-border/30 flex items-center justify-center mb-4">
				<Icon icon="ph:user-circle" class="text-3xl text-on-surface/30" />
			</div>
			<p class="text-primary font-semibold text-[15px]">Profile not found</p>
			<p class="text-sm text-muted mt-1.5">This user doesn't exist or their profile is private.</p>
		</div>
	{:else if profile}
		<div>
			<!-- Profile hero -->
			<div
				class="relative px-6 pt-8 pb-6"
				in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}
			>
				<!-- Subtle background gradient -->
				<div class="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent pointer-events-none"></div>

				<div class="relative flex flex-col items-center text-center">
					{#if profile.photoURL}
						<img
							src={profile.photoURL}
							alt={profile.displayName}
							class="w-22 h-22 rounded-full object-cover ring-4 ring-card shadow-lg mb-4"
						/>
					{:else}
						<div class="w-22 h-22 rounded-full bg-accent/10 flex items-center justify-center text-3xl text-accent font-bold ring-4 ring-card shadow-lg mb-4">
							{avatarInitial(profile.displayName)}
						</div>
					{/if}

					<h1 class="font-display text-xl font-bold text-primary">{profile.displayName}</h1>
					<p class="text-[13px] text-muted mt-1">Member since {formatMemberSince(profile.createdAt)}</p>

					<!-- Stats bar -->
					{#if boards.length > 0}
						<div class="flex items-center gap-5 mt-4">
							<div class="flex flex-col items-center">
								<span class="text-lg font-bold text-primary">{boards.length}</span>
								<span class="text-[11px] text-muted font-medium">Boards</span>
							</div>
							<div class="w-px h-7 bg-border/60"></div>
							<div class="flex flex-col items-center">
								<span class="text-lg font-bold text-primary">{ownedCount}</span>
								<span class="text-[11px] text-muted font-medium">Owned</span>
							</div>
							<div class="w-px h-7 bg-border/60"></div>
							<div class="flex flex-col items-center">
								<span class="text-lg font-bold text-primary">{publicCount}</span>
								<span class="text-[11px] text-muted font-medium">Public</span>
							</div>
						</div>
					{/if}

					<button
						onclick={handleShareProfile}
						class="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-card border border-border/60 rounded-full text-[13px] text-primary font-medium
							shadow-sm hover:shadow-md hover:border-accent/30 active:scale-[0.97] transition-all"
					>
						<Icon icon="ph:share-network" class="text-sm text-on-surface/60" />
						{profileLinkCopied ? 'Link copied!' : 'Share Profile'}
					</button>
				</div>
			</div>

			<!-- Boards section -->
			<div class="px-4 sm:px-6 pb-8">
				{#if boards.length === 0}
					<div class="flex flex-col items-center py-12">
						<div class="w-12 h-12 rounded-full bg-border/20 flex items-center justify-center mb-3">
							<Icon icon="ph:squares-four" class="text-xl text-on-surface/30" />
						</div>
						<p class="text-sm text-muted">No boards yet.</p>
					</div>
				{:else}
					<div class={boards.length === 1 ? 'max-w-sm mx-auto' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'}>
						{#each boards as board, i (board.id)}
							{@const isPrivate = !board.isPublic}
							<div
								in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration, delay: Math.min(i * 50, 400) }}
							>
								{#if isPrivate}
									<!-- Private board — blurred, no title -->
									<div class="group relative bg-card rounded-card shadow-card border border-border/50 overflow-hidden">
										<div class="relative h-32 sm:h-36 overflow-hidden">
											<div class="blur-lg scale-110 h-full">
												<BoardPreviewMosaic boardId={board.id} />
											</div>
											<!-- Lock overlay -->
											<div class="absolute inset-0 bg-card/40 backdrop-blur-sm flex items-center justify-center">
												<div class="flex flex-col items-center gap-1.5">
													<div class="w-10 h-10 rounded-full bg-primary/8 flex items-center justify-center">
														<Icon icon="ph:lock-simple-fill" class="text-lg text-on-surface/60" />
													</div>
													<span class="text-[11px] font-semibold text-muted">Private</span>
												</div>
											</div>
										</div>
										<div class="px-4 py-3 flex items-center justify-between">
											<span class="text-[13px] text-muted font-medium">Private Board</span>
											<span class="text-[11px] text-muted/60">
												{board.memberIds.length} {board.memberIds.length === 1 ? 'member' : 'members'}
											</span>
										</div>
									</div>
								{:else}
									<!-- Public board — full card like home page style -->
									<a
										href={isMember(board) ? `/board/${board.id}` : undefined}
										class="group relative block bg-card rounded-card shadow-card border border-border/50 overflow-hidden
											hover:shadow-lg hover:border-accent/20 transition-all duration-200"
									>
										<!-- Mosaic preview -->
										<div class="relative h-36 sm:h-40 overflow-hidden">
											<div class="h-full group-hover:scale-[1.03] transition-transform duration-500">
												<BoardPreviewMosaic boardId={board.id} />
											</div>
											<!-- Gradient overlay -->
											<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>

											<!-- Board name over image -->
											<div class="absolute bottom-0 inset-x-0 p-3.5">
												<div class="flex items-center gap-2">
													<h3 class="text-[15px] font-bold text-white flex-1 truncate drop-shadow-md">
														{board.name}
													</h3>
													<StreakBadge streak={board.streak} />
												</div>
											</div>
										</div>

										<!-- Footer -->
										<div class="px-3.5 py-3 flex items-center justify-between">
											<AvatarStack uids={board.memberIds} boardId={board.id} size="xs" />

											{#if isMember(board)}
												<span class="text-[11px] font-semibold text-accent">Open</span>
											{:else if hasPendingRequest(board.id)}
												<span class="text-[11px] font-semibold text-muted/60 bg-border/40 px-2.5 py-1 rounded-full">Pending</span>
											{:else}
												<button
													onclick={(e) => { e.stopPropagation(); e.preventDefault(); handleRequestToJoin(board.id); }}
													disabled={requestingBoard === board.id}
													class="text-[11px] font-semibold text-white bg-accent px-3 py-1.5 rounded-full
														hover:bg-accent/90 active:scale-[0.97] transition-all disabled:opacity-50"
												>
													{requestingBoard === board.id ? 'Sending...' : 'Join'}
												</button>
											{/if}
										</div>
									</a>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</Page>

<style>
	.w-22 { width: 5.5rem; }
	.h-22 { height: 5.5rem; }
</style>
