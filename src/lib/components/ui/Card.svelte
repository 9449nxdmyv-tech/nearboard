<!--
  @file Card.svelte
  @description Base card component: content slot + interaction footer.
               Uses shadow-based elevation instead of borders for premium depth.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Timestamp } from 'firebase/firestore';
	import CardFooterSection from './CardFooterSection.svelte';

	let {
		boardId,
		contentId,
		authorId,
		authorName,
		authorPhotoURL,
		createdAt,
		isBoardOwner,
		allowComments = true,
		expandComments,
		commentCount = 0,
		acknowledgments,
		onEdit,
		onDelete,
		onShare,
		children,
		headerContent
	}: {
		boardId: string;
		contentId: string;
		authorId: string;
		authorName: string;
		authorPhotoURL?: string | null;
		createdAt?: Date | Timestamp;
		isBoardOwner?: boolean;
		allowComments?: boolean;
		commentCount?: number;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		expandComments?: boolean;
		onEdit?: () => void;
		onDelete?: () => void;
		onShare?: () => void;
		children: Snippet;
		headerContent?: Snippet;
	} = $props();
</script>

<article class="bg-card rounded-[var(--radius-card)] shadow-card overflow-hidden
	transition-[transform,box-shadow] duration-200 ease-out
	hover:shadow-md hover:-translate-y-0.5
	active:shadow-sm active:translate-y-0
	break-inside-avoid">
	<!-- Optional header content (for link previews, images, etc.) -->
	{#if headerContent}
		{@render headerContent()}
	{/if}

	<!-- Main content -->
	<div class="px-3 pt-3 pb-2 sm:px-4 sm:pt-4 sm:pb-3">
		{@render children()}
	</div>

	<!-- Interaction footer (Firebase-connected) -->
	<CardFooterSection
		{boardId}
		{contentId}
		{authorId}
		{authorName}
		authorPhotoURL={authorPhotoURL ?? null}
		createdAt={createdAt ?? new Date()}
		{isBoardOwner}
		{allowComments}
		{commentCount}
		{acknowledgments}
		{expandComments}
		{onEdit}
		{onDelete}
		{onShare}
	/>
</article>
