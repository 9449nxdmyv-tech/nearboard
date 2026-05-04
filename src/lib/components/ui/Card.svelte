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
		onCommentClick,
		children,
		headerContent,
		layout,
		bodyClass = '',
		bodyStyle = ''
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
		onCommentClick?: () => void;
		children: Snippet;
		headerContent?: Snippet;
		layout?: import('$lib/types').LayoutStyle;
		/** Optional class for the body (content) area only — keeps the footer/avatar on the standard card surface. */
		bodyClass?: string;
		/** Inline style for the body area — used by note tints that need exact pastels not in the @theme palette. */
		bodyStyle?: string;
	} = $props();
</script>

<article class="bg-card rounded-[var(--radius-card)] shadow-card overflow-hidden
	transition-[transform,box-shadow] duration-200 will-change-transform
	hover:shadow-lg hover:-translate-y-1
	active:shadow-sm active:scale-[0.985] active:translate-y-0
	break-inside-avoid"
	style="transition-timing-function: cubic-bezier(0.2, 0, 0, 1);">
	<!-- Optional header content (for link previews, images, etc.) -->
	{#if headerContent}
		{@render headerContent()}
	{/if}

	<!-- Main content — only the body gets tinted; footer/avatar stay on bg-card. -->
	<div class="px-3 pt-3 pb-2 sm:px-4 sm:pt-4 sm:pb-3 {bodyClass}" style={bodyStyle}>
		{@render children()}
	</div>

	<!-- Interaction footer (Firebase-connected) -->
	{#if layout !== 'compact-grid'}
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
			{onCommentClick}
		/>
	{/if}
</article>
