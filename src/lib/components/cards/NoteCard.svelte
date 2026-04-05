<!--
  @file NoteCard.svelte
  @description Note card — plain text content.
-->
<script lang="ts">
	import type { NoteCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';

	let {
		id, boardId, text, authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments,
		onEdit, onDelete, onShare
	}: NoteCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onEdit?: () => void;
		onDelete?: () => void;
		onShare?: () => void;
	} = $props();
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
>
	<p class="text-[14px] leading-relaxed text-on-surface whitespace-pre-wrap line-clamp-[12]">{text.trim()}</p>
</Card>
