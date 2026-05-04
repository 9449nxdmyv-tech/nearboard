<!--
  @file join/[boardId]/+page.svelte
  @description Invite landing page. The actual board content is shown as a blurred
               background preview, with the invite card overlayed on top — giving
               the invited user an instant visual of what to expect.
               Uses $effect to react to auth state (no race condition).
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import { userStore, showToast, requestNotificationPermission } from '$lib/stores';
	import { getBoard, joinBoard, getPendingInvites, getUserDoc } from '$lib/firebase';
	import type { BoardDoc, UserDoc } from '$lib/types';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import BoardPreviewMosaic from '$lib/components/ui/BoardPreviewMosaic.svelte';

	const boardId = $derived($page.params.boardId ?? '');
	const inviteIdFromUrl = $derived($page.url.searchParams.get('invite') ?? null);

	let board = $state<BoardDoc | null>(null);
	let owner = $state<UserDoc | null>(null);
	let memberProfiles = $state<UserDoc[]>([]);
	let loading = $state(true);
	let joining = $state(false);
	let alreadyMember = $state(false);
	let activeInviteId = $state<string | null>(null);
	let error = $state<string | null>(null);

	const user = $derived($userStore.user);
	const authLoading = $derived($userStore.loading);

	// Other members excluding the owner (for display)
	const otherMembers = $derived(
		memberProfiles.filter(m => m.uid !== board?.ownerId)
	);
	const memberCount = $derived(board?.memberIds.length ?? 0);

	let loadedBoardId = $state<string | null>(null);

	$effect(() => {
		if (authLoading || !boardId) return;
		if (loadedBoardId === boardId) return;
		loadBoard();
	});

	async function loadBoard() {
		loading = true;
		error = null;
		activeInviteId = inviteIdFromUrl;

		try {
			const b = await getBoard(boardId);
			board = b;
			loadedBoardId = boardId;

			if (b && user) {
				alreadyMember = b.memberIds.includes(user.uid);
			}

			// Fetch owner + member profiles (requires sign-in for /users reads)
			if (b && user) {
				const uidsToFetch = [b.ownerId, ...b.memberIds.filter(id => id !== b.ownerId).slice(0, 4)];
				const profiles = await Promise.all(
					uidsToFetch.map(uid => getUserDoc(uid).catch(() => null))
				);
				owner = profiles[0] ?? null;
				memberProfiles = profiles.filter((p): p is UserDoc => p !== null);
			}

			// Check for matching pending invite (non-members only)
			if (b && user && !alreadyMember && !activeInviteId && user.email) {
				try {
					const pending = await getPendingInvites(boardId);
					const match = pending.find(i => i.contactIdentifier === user.email!.toLowerCase());
					if (match) activeInviteId = match.id;
				} catch { /* non-critical */ }
			}
		} catch {
			if (!user) {
				board = null;
			} else {
				error = 'Could not load this board. The link may be invalid.';
			}
		} finally {
			loading = false;
		}
	}

	async function handleJoin() {
		if (!user || !board) return;
		joining = true;
		try {
			await joinBoard(boardId, user.uid, activeInviteId, user.displayName || '', user.photoURL || null);
			showToast(`Joined "${board.name}"!`, 'success');
			requestNotificationPermission(user.uid).catch(() => {});
			goto(`/board/${boardId}`);
		} catch {
			showToast('Failed to join board');
		} finally {
			joining = false;
		}
	}

	function goToSignup() {
		goto('/onboarding');
	}
</script>

<div class="relative min-h-screen bg-surface overflow-hidden">
	<!-- Background: board preview (signed-in users get real content, others get skeleton) -->
	<div class="absolute inset-0">
		{#if user && boardId}
			<BoardPreviewMosaic {boardId} height="100%" />
		{:else}
			<!-- Static skeleton mosaic for unauthenticated visitors -->
			<div class="flex w-full h-full bg-surface">
				<div class="flex-1 flex flex-col">
					<div class="flex-1 bg-primary/10 flex items-center justify-center">
						<Icon icon="ph:note" class="text-on-surface text-5xl opacity-60" />
					</div>
					<div class="flex-1 bg-primary/10 flex items-center justify-center">
						<Icon icon="ph:link" class="text-on-surface text-5xl opacity-60" />
					</div>
					<div class="flex-1 bg-primary/10 flex items-center justify-center">
						<Icon icon="ph:list-checks" class="text-on-surface text-5xl opacity-60" />
					</div>
				</div>
				<div class="flex-1 flex flex-col">
					<div class="flex-1 bg-primary/10 flex items-center justify-center">
						<Icon icon="ph:image" class="text-on-surface text-5xl opacity-60" />
					</div>
					<div class="flex-1 bg-primary/10 flex items-center justify-center">
						<Icon icon="ph:map-pin" class="text-on-surface text-5xl opacity-60" />
					</div>
					<div class="flex-1 bg-primary/10 flex items-center justify-center">
						<Icon icon="ph:waveform" class="text-on-surface text-5xl opacity-60" />
					</div>
				</div>
			</div>
		{/if}
		<!-- Blur + dim overlay -->
		<div class="absolute inset-0 backdrop-blur-md bg-surface/60"></div>
	</div>

	<!-- Foreground: invite card -->
	<div class="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 py-12">
		{#if loading || authLoading}
			<div class="flex flex-col items-center gap-3" transition:fade={{ duration: 150 }}>
				<Icon icon="ph:circle-notch-bold" class="text-2xl text-accent animate-spin" />
				<p class="text-muted text-sm">Loading...</p>
			</div>
		{:else if error}
			<div
				class="w-full max-w-sm"
				in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}
			>
				<div class="bg-card/95 backdrop-blur-sm rounded-card border border-border shadow-card p-8 text-center">
					<Icon icon="ph:warning-circle" class="text-4xl text-on-surface/60 mb-4" />
					<h1 class="font-display text-xl font-semibold text-primary mb-2">Something went wrong</h1>
					<p class="text-sm text-muted mb-6">{error}</p>
					<a href="/" class="text-accent text-sm hover:underline">Go home</a>
				</div>
				<p class="text-center text-[11px] text-muted/50 mt-4">
					Nearboard — a shared space for the people and things you care about
				</p>
			</div>
		{:else if alreadyMember && board}
			<div
				class="w-full max-w-sm"
				in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}
			>
				<div class="bg-card/95 backdrop-blur-sm rounded-card border border-border shadow-card p-8 text-center">
					<div class="flex justify-center mb-4">
						<Icon icon="ph:check-circle-fill" class="text-4xl text-success" />
					</div>
					<h1 class="font-display text-xl font-semibold text-primary mb-2">You're already in</h1>
					<p class="text-sm text-muted mb-2">You're a member of <strong>{board.name}</strong>.</p>

					{#if memberProfiles.length > 0}
						<div class="flex items-center justify-center gap-1 mb-6">
							<div class="flex -space-x-2">
								{#each memberProfiles.slice(0, 5) as member (member.uid)}
									<div class="ring-2 ring-card rounded-full">
										<Avatar name={member.displayName} photoURL={member.photoURL} size="md" />
									</div>
								{/each}
								{#if memberCount > 5}
									<div class="w-10 h-10 rounded-full bg-muted/20 flex items-center justify-center text-muted text-xs font-semibold border-2 border-card">
										+{memberCount - 5}
									</div>
								{/if}
							</div>
							<span class="text-xs text-muted ml-2">{memberCount} {memberCount === 1 ? 'member' : 'members'}</span>
						</div>
					{:else}
						<div class="mb-6"></div>
					{/if}

					<a
						href="/board/{boardId}"
						class="inline-block w-full py-3.5 bg-accent text-white rounded-lg font-medium
							press-scale transition-transform"
					>
						Open Board
					</a>
				</div>
				<p class="text-center text-[11px] text-muted/50 mt-4">
					Nearboard — a shared space for the people and things you care about
				</p>
			</div>
		{:else}
			<div
				class="w-full max-w-sm"
				in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}
			>
				<div class="bg-card/95 backdrop-blur-sm rounded-card border border-border shadow-card p-8">
					<!-- Inviter -->
					<div class="flex flex-col items-center">
						{#if owner}
							<Avatar name={owner.displayName} photoURL={owner.photoURL} size="lg" ring="accent" />
							<p class="text-sm text-primary mt-3">
								<span class="font-semibold">{owner.displayName || 'Someone'}</span>
								<span class="text-muted"> invited you to join</span>
							</p>
						{:else}
							<div class="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center ring-2 ring-accent/20">
								<Icon icon="ph:envelope-simple" class="text-xl text-on-surface" />
							</div>
							<p class="text-sm text-muted mt-3">You've been invited to join</p>
						{/if}
					</div>

					<!-- Board name -->
					<div class="text-center mt-4">
						<h1 class="font-display text-xl font-semibold text-primary">
							{board?.name ?? 'a Nearboard'}
						</h1>
						{#if board}
							<p class="text-xs text-muted mt-1 capitalize">{board.template} board</p>
						{/if}
					</div>

					<!-- Living summary headline -->
					{#if board?.livingSummary?.headline}
						<p class="text-sm text-muted text-center mt-3 leading-relaxed">
							{board.livingSummary.headline}
						</p>
					{/if}

					<!-- Member faces -->
					{#if otherMembers.length > 0 || (owner && memberCount > 1)}
						<div class="flex items-center justify-center mt-5 gap-1">
							<div class="flex -space-x-2">
								{#each otherMembers.slice(0, 4) as member (member.uid)}
									<div class="ring-2 ring-card rounded-full">
										<Avatar name={member.displayName} photoURL={member.photoURL} size="md" />
									</div>
								{/each}
								{#if memberCount > 5}
									<div class="w-10 h-10 rounded-full bg-muted/20 flex items-center justify-center text-muted text-xs font-semibold border-2 border-card">
										+{memberCount - 5}
									</div>
								{/if}
							</div>
							<span class="text-xs text-muted ml-2">
								{memberCount} {memberCount === 1 ? 'member' : 'members'}
							</span>
						</div>
					{:else if memberCount > 0}
						<p class="text-xs text-muted text-center mt-5">
							{memberCount} {memberCount === 1 ? 'member' : 'members'}
						</p>
					{/if}

					<!-- Action -->
					<div class="mt-6">
						{#if user}
							{#if board}
								<button
									onclick={handleJoin}
									disabled={joining}
									class="w-full py-3.5 bg-accent text-white rounded-lg font-medium
										disabled:opacity-50 press-scale transition-transform"
								>
									{#if joining}
										<span class="flex items-center justify-center gap-2">
											<Icon icon="ph:circle-notch-bold" class="animate-spin" />
											Joining...
										</span>
									{:else}
										Join Board
									{/if}
								</button>
							{/if}
						{:else}
							<button
								onclick={goToSignup}
								class="w-full py-3.5 bg-accent text-white rounded-lg font-medium
									press-scale transition-transform shadow-fab"
							>
								Sign up to join
							</button>
							<p class="text-xs text-muted text-center mt-2.5">Free to use, no credit card needed</p>
						{/if}
					</div>
				</div>

				<p class="text-center text-[11px] text-muted/50 mt-4">
					Nearboard — a shared space for the people and things you care about
				</p>
			</div>
		{/if}
	</div>
</div>
