<!--
  @file ListCard.svelte
  @description Checklist card with progress bar and toggle items.
-->
<script lang="ts">
	import type { ListCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';
	import { Checkbox, Badge } from 'konsta/svelte';

	let {
		id, boardId, title, items, authorId, authorName, authorPhotoURL, createdAt, onToggleItem,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onEdit, onDelete, onShare, onCommentClick
	}: ListCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onEdit?: () => void;
		onDelete?: () => void;
		onShare?: () => void;
		onCommentClick?: () => void;
	} = $props();

	const completedCount = $derived(items.filter((i) => i.completed).length);
	const totalCount = $derived(items.length);
	const progress = $derived(totalCount > 0 ? (completedCount / totalCount) * 100 : 0);
	const allDone = $derived(totalCount > 0 && completedCount === totalCount);
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
	<!-- Title -->
	<div class="flex items-center justify-between mb-3">
		<h3 class="font-semibold text-lg">{title}</h3>
		{#if allDone}
			<Badge colors={{ bg: 'bg-success' }}>Done</Badge>
		{:else}
			<Badge colors={{ bg: 'bg-primary' }}>{completedCount}/{totalCount}</Badge>
		{/if}
	</div>

	<!-- Progress bar -->
	<div class="w-full h-2 bg-surface-2 rounded-full mb-3 overflow-hidden">
		<div
			class="h-full bg-primary transition-all duration-300"
			style="width: {progress}%"
		></div>
	</div>

	<!-- List items -->
	<div class="space-y-1">
		{#each items as item (item.id)}
			<div class="flex items-center gap-3 p-2 rounded-xl {item.completed ? 'opacity-50' : ''}">
				<Checkbox
					checked={item.completed}
					onchange={() => onToggleItem?.(item.id)}
				/>
				<span class="flex-1 text-[15px] {item.completed ? 'line-through text-muted' : ''}">
					{item.text}
				</span>
			</div>
		{/each}
	</div>
</Card>
