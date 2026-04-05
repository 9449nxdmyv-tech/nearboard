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
		isContentVisible
	} from '$lib/firebase';
	import { userStore } from '$lib/stores';
	import type { BoardDoc, ContentDoc } from '$lib/types';
	import ContentRenderer from '$lib/components/ui/ContentRenderer.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import MasonryGrid from '$lib/components/ui/MasonryGrid.svelte';

	let board = $state<BoardDoc | null>(null);
	let content = $state<ContentDoc[]>([]);
	let loading = $state(true);
	let notFound = $state(false);

	const boardId = $derived($page.params.boardId ?? '');

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
				<span class="text-[12px] text-muted">{board.memberIds.length} {board.memberIds.length === 1 ? 'member' : 'members'}</span>

				{#if board.livingSummary?.headline}
					<p class="text-[13px] text-muted italic text-center max-w-sm leading-relaxed mt-1">
						"{board.livingSummary.headline}"
					</p>
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
