<!--
  @file NoteCard.svelte
  @description Note card — plain text content.
               Short text (< 1 sentence) renders as a centered quote with decorative marks.
               Longer text auto-adjusts text size for readability.
-->
<script lang="ts">
	import type { NoteCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';

	let {
		id, boardId, text, authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments,
		onEdit, onDelete, onShare, onCommentClick
	}: NoteCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onEdit?: () => void;
		onDelete?: () => void;
		onShare?: () => void;
		onCommentClick?: () => void;
	} = $props();

	const trimmedText = $derived(text.trim());
	const isShort = $derived(trimmedText.length <= 80 && !trimmedText.includes('\n'));
	const textSize = $derived.by(() => {
		const len = trimmedText.length;
		if (len <= 40) return 'text-2xl';
		if (len <= 80) return 'text-xl';
		if (len <= 150) return 'text-lg';
		if (len <= 300) return 'text-[15px]';
		return 'text-[14px]';
	});
</script>

<Card
	{boardId}
	contentId={id}
	{authorId}
	{authorName}
	{authorPhotoURL}
	{createdAt}
	{isBoardOwner}
	{allowComments}
	{expandComments}
	{commentCount}
	{acknowledgments}
	{onEdit}
	{onDelete}
	{onShare}
	{onCommentClick}
>
	{#if isShort}
		<div class="text-center py-3 px-2 relative">
			<span class="absolute left-0 top-0 text-4xl text-primary/20 font-serif leading-none select-none">"</span>
			<p class="{textSize} font-medium text-on-surface leading-snug px-4">{trimmedText}</p>
			<span class="absolute right-0 bottom-0 text-4xl text-primary/20 font-serif leading-none select-none">"</span>
		</div>
	{:else}
		<p class="{textSize} leading-relaxed text-on-surface whitespace-pre-wrap line-clamp-[12]">{trimmedText}</p>
	{/if}
</Card>
