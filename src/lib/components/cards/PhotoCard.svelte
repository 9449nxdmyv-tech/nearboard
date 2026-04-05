<!--
  @file PhotoCard.svelte
  @description Photo card with multi-image carousel, smooth navigation, image counter.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { PhotoCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';

	let {
		id, boardId, imageUrl, images = [], caption, width, height,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments,
		onEdit, onDelete, onShare
	}: PhotoCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onEdit?: () => void;
		onDelete?: () => void;
		onShare?: () => void;
	} = $props();

	let imageError = $state(false);
	let currentIdx = $state(0);
	let touchStartX = $state(0);

	const allImages = $derived.by(() => {
		if (images.length > 0) return images;
		return [{ url: imageUrl, width, height }];
	});
	const isMulti = $derived(allImages.length > 1);

	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.touches[0].clientX;
	}

	function handleTouchEnd(e: TouchEvent) {
		const dx = e.changedTouches[0].clientX - touchStartX;
		if (Math.abs(dx) < 40) return;
		if (dx < 0 && currentIdx < allImages.length - 1) currentIdx++;
		else if (dx > 0 && currentIdx > 0) currentIdx--;
	}
</script>

{#snippet photoHeader()}
	{#if !imageError}
		<div
			class="relative bg-surface-1 overflow-hidden"
			ontouchstart={isMulti ? handleTouchStart : undefined}
			ontouchend={isMulti ? handleTouchEnd : undefined}
		>
			<img
				src={allImages[currentIdx]?.url || imageUrl}
				alt={caption || 'Photo'}
				class="w-full h-auto object-cover"
				loading="lazy"
				onerror={() => (imageError = true)}
			/>

			{#if isMulti}
				<div class="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5">
					{#each allImages as _, i (i)}
						<button
							onclick={(e) => { e.stopPropagation(); currentIdx = i; }}
							class="rounded-full transition-all duration-200
								{i === currentIdx ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50'}"
							aria-label="Image {i + 1}"
						></button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

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
	headerContent={!imageError ? photoHeader : undefined}
>
	{#if caption}
		<p class="text-[13px] text-muted leading-relaxed">{caption}</p>
	{:else if imageError}
		<div class="flex items-center justify-center py-8 text-muted">
			<Icon icon="ph:image-broken" class="text-2xl" />
		</div>
	{/if}
</Card>
