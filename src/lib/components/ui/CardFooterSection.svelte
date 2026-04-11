<!--
  @file CardFooterSection.svelte
  @description Shared footer for all card types.
               Layout: author/timestamp + overflow → interaction bar → comments (on tap).
-->
<script lang="ts">
	import type { Timestamp } from 'firebase/firestore';
	import { slide } from 'svelte/transition';
	import { Popover } from 'konsta/svelte';
	import Icon from '@iconify/svelte';
	import { hapticLight } from '$lib/utils/haptics';
	import CardInteractions from './CardInteractions.svelte';
	import CardFooter from './CardFooter.svelte';
	import CardComments from './CardComments.svelte';

	let {
		boardId,
		contentId,
		authorId,
		authorName,
		authorPhotoURL,
		createdAt,
		isBoardOwner = false,
		allowComments = true,
		commentCount,
		acknowledgments,
		expandComments = false,
		isDetail = false,
		onEdit,
		onDelete,
		onShare
	}: {
		boardId: string;
		contentId: string;
		authorId: string;
		authorName: string;
		authorPhotoURL: string | null;
		createdAt: Date | Timestamp;
		isBoardOwner?: boolean;
		allowComments?: boolean;
		commentCount?: number;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		expandComments?: boolean;
		isDetail?: boolean;
		onEdit?: () => void;
		onDelete?: () => void;
		onShare?: () => void;
	} = $props();

	let showComments = $state(expandComments);
	let menuOpen = $state(false);
	let menuTarget = $state<HTMLButtonElement | undefined>();

	const ackCount = $derived(acknowledgments ? Object.keys(acknowledgments).length : 0);
</script>

<!-- Author line + overflow menu -->
<div class="px-3 sm:px-4 pt-2.5 pb-2 flex items-center gap-2">
	<div class="flex-1 min-w-0">
		<CardFooter {authorName} {authorPhotoURL} {createdAt} />
	</div>
	{#if onDelete || onEdit}
		<div class="relative shrink-0">
			<button
				bind:this={menuTarget}
				onclick={(e) => { e.stopPropagation(); hapticLight(); menuOpen = !menuOpen; }}
				class="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-on-surface transition-colors"
				aria-label="More options"
			>
				<Icon icon="ph:dots-three" class="text-lg" />
			</button>

			<Popover opened={menuOpen} target={menuTarget} onBackdropClick={() => { menuOpen = false; }}>
				<div class="py-1 min-w-[140px]">
					{#if onEdit}
						<button
							onclick={(e) => { e.stopPropagation(); menuOpen = false; onEdit?.(); }}
							class="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-on-surface active:bg-surface-1 transition-colors"
						>
							<Icon icon="ph:pencil-simple" class="text-base" />
							Edit
						</button>
					{/if}
					{#if onDelete}
						<button
							onclick={(e) => { e.stopPropagation(); menuOpen = false; onDelete?.(); }}
							class="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-error active:bg-surface-1 transition-colors"
						>
							<Icon icon="ph:trash" class="text-base" />
							Delete
						</button>
					{/if}
				</div>
			</Popover>
		</div>
	{/if}
</div>

<!-- Interaction bar (always visible) -->
<CardInteractions {boardId} {contentId} {acknowledgments} {commentCount} bind:showComments {onShare} {isDetail} />

<!-- Comments section (toggleable) -->
{#if showComments && allowComments}
	<div class="px-3 sm:px-4 py-3" transition:slide={{ duration: 200 }}>
		<CardComments {boardId} {contentId} {isBoardOwner} {allowComments} />
	</div>
{/if}
