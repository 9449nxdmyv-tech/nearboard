<!--
  @file +page.svelte (Home / Board List)
  @description Board list screen with live Firestore sync and previews.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { userStore, boardStore } from '$lib/stores';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import { summaryPreview } from '$lib/utils/textFormatter';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import BoardPreviewMosaic from '$lib/components/ui/BoardPreviewMosaic.svelte';
	import AvatarStack from '$lib/components/ui/AvatarStack.svelte';
	import { Page, Button } from 'konsta/svelte';
	import Header from '$lib/components/ui/Header.svelte';

	import StreakBadge from '$lib/components/ui/StreakBadge.svelte';
	import SkeletonCard from '$lib/components/ui/SkeletonCard.svelte';
	import BoardStories from '$lib/components/ui/BoardStories.svelte';

	let failedCovers = $state<Set<string>>(new Set());

	onMount(() => {
		const today = new Date().toISOString().slice(0, 10);
		const lastVisit = localStorage.getItem('nearboard_last_home_visit');
		localStorage.setItem('nearboard_last_home_visit', today);
		if (lastVisit !== today) {
			goto('/today');
		}
	});
</script>

<Page>
	<Header
		leftActions={[
			{ icon: 'ph:sun-horizon-bold', onClick: () => goto('/today'), label: 'Today' }
		]}
		actions={[
			{ icon: 'ph:plus-bold', onClick: () => goto('/create-board'), label: 'New board' }
		]}
	>
		{#snippet titleSnippet()}
			<div class="flex items-center gap-2">
				<img src="/logo.svg" alt="" class="w-7 h-7" />
				<span class="text-[17px] font-semibold text-on-surface">Nearboard</span>
			</div>
		{/snippet}
	</Header>

	<main class="flex-1 px-4">
		<!-- Stories row: recent videos from each board -->
		{#if !$boardStore.loading && $boardStore.boards.length > 0}
			<div class="mt-3">
				<BoardStories boards={$boardStore.boards} />
			</div>
		{/if}

		{#if $boardStore.loading}
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
				{#each Array(6) as _, i}
					<div class="stagger-fade-in" style="--stagger-index: {i}">
						<SkeletonCard variant={i % 2 === 0 ? 'default' : 'wide'} />
					</div>
				{/each}
			</div>
		{:else if $boardStore.error}
			<div class="flex flex-col items-center justify-center py-12">
				<div class="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
					<Icon icon="ph:warning-circle" class="text-3xl text-error" />
				</div>
				<p class="text-error font-medium">{$boardStore.error}</p>
				<div class="mt-4">
					<Button large rounded onClick={() => window.location.reload()}>
						Retry
					</Button>
				</div>
			</div>
		{:else if $boardStore.boards.length === 0}
			<EmptyState
				icon="ph:kanban"
				title="No boards yet"
				description="Create your first board to start organizing your thoughts and collaborating with others"
				actionLabel="Create Board"
				onAction={() => goto('/create-board')}
			/>
		{:else}
			<div class="board-grid grid grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
				{#each $boardStore.boards as board, i (board.id)}
					<a
						href="/board/{board.id}"
						class="board-card group relative rounded-2xl overflow-hidden stagger-fade-in aspect-[3/4]"
						style="--stagger-index: {i}"
					>
						<!-- Background: cover image or mosaic preview -->
						<div class="absolute inset-0 bg-surface-1">
							{#if board.coverImageUrl && !failedCovers.has(board.id)}
								<img
									src={board.coverImageUrl}
									alt=""
									class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
									loading="lazy"
									onerror={() => failedCovers.add(board.id)}
								/>
							{:else}
								<BoardPreviewMosaic boardId={board.id} height="100%" />
							{/if}
						</div>

						<!-- Gradient scrim -->
						<div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>

						<!-- Inner highlight border for glass depth -->
						<div class="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/15 pointer-events-none"></div>

						<!-- Sheen sweep -->
						<div class="board-card-sheen absolute inset-0 pointer-events-none"></div>

						<!-- Unread dot -->
						{#if $boardStore.unreadBoardIds.has(board.id)}
							<div class="absolute top-2.5 right-2.5 z-10 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-black/20"></div>
						{/if}

						<!-- Top-left: content count pill -->
						{#if board.contentCount}
							<div class="absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm">
								<Icon icon="ph:note" class="text-[10px] text-white/80" />
								<span class="text-[10px] text-white/90 font-medium tabular-nums">{board.contentCount}</span>
							</div>
						{/if}

						<!-- Overlaid info at bottom -->
						<div class="absolute bottom-0 left-0 right-0 p-3 flex flex-col gap-1.5">
							<div class="flex items-center gap-2">
								<h2 class="font-semibold text-[14px] text-white leading-snug truncate flex-1 drop-shadow-sm">{board.name}</h2>
								{#if board.streak > 0}
									<StreakBadge streak={board.streak} size="sm" />
								{/if}
							</div>

							{#if board.livingSummary?.headline || board.livingSummary?.content}
								<p class="text-[11px] text-white/70 line-clamp-2 italic leading-relaxed drop-shadow-sm">
									"{board.livingSummary.headline || summaryPreview(board.livingSummary.content, 50)}"
								</p>
							{/if}

							<div class="flex items-center justify-between gap-2 mt-0.5">
								<AvatarStack uids={board.memberIds} boardId={board.id} size="sm" />
								{#if board.lastActivityAt}
									<span class="text-[10px] text-white/60 font-medium">{relativeTime(board.lastActivityAt.toDate())}</span>
								{/if}
							</div>
						</div>
					</a>
				{/each}

				<!-- Ghost "create board" card when odd count -->
				{#if $boardStore.boards.length % 2 !== 0}
					<a
						href="/create-board"
						class="group relative rounded-2xl overflow-hidden aspect-[3/4]
							border-2 border-dashed border-on-surface/15 bg-surface-1/50
							flex flex-col items-center justify-center gap-2
							active:bg-surface-1 transition-colors stagger-fade-in"
						style="--stagger-index: {$boardStore.boards.length}"
					>
						<div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center
							group-active:bg-primary/20 transition-colors">
							<Icon icon="ph:plus-bold" class="text-xl text-primary" />
						</div>
						<span class="text-[13px] font-medium text-muted">New board</span>
					</a>
				{/if}
			</div>
		{/if}
	</main>
</Page>

<style>
	/* 3D perspective container */
	.board-grid {
		perspective: 800px;
	}

	/* Card: 3D lift + shadow on hover/active */
	.board-card {
		transform-style: preserve-3d;
		transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1),
					box-shadow 0.35s cubic-bezier(0.22, 1, 0.36, 1);
		box-shadow:
			0 2px 8px rgb(0 0 0 / 0.12),
			0 1px 3px rgb(0 0 0 / 0.08);
		will-change: transform;
	}

	.board-card:hover {
		transform: rotateX(2deg) rotateY(-1.5deg) translateY(-4px) scale(1.02);
		box-shadow:
			0 12px 32px rgb(0 0 0 / 0.18),
			0 4px 12px rgb(0 0 0 / 0.1);
	}

	.board-card:active {
		transform: rotateX(0deg) rotateY(0deg) translateY(0) scale(0.98);
		box-shadow:
			0 2px 6px rgb(0 0 0 / 0.15),
			0 1px 2px rgb(0 0 0 / 0.08);
		transition-duration: 0.1s;
	}

	/* Diagonal sheen sweep on hover */
	.board-card-sheen {
		background: linear-gradient(
			120deg,
			transparent 30%,
			rgb(255 255 255 / 0.15) 45%,
			rgb(255 255 255 / 0.25) 50%,
			rgb(255 255 255 / 0.15) 55%,
			transparent 70%
		);
		background-size: 250% 100%;
		background-position: 200% 0;
		transition: background-position 0.6s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.board-card:hover .board-card-sheen {
		background-position: -50% 0;
	}
</style>
