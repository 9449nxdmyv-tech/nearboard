<!--
  @file PhotoCard.svelte
  @description Photo card with multi-image carousel, smooth swipe gestures,
               spring-like transitions, and image counter.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { PhotoCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';

	let {
		id, boardId, imageUrl, images = [], caption, width, height,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments,
		layout,
		onEdit, onDelete, onShare, onCommentClick
	}: PhotoCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onEdit?: () => void;
		onDelete?: () => void;
		onShare?: () => void;
		onCommentClick?: () => void;
	} = $props();

	let imageError = $state(false);
	let currentIdx = $state(0);

	const isCompact = $derived(layout === 'compact-grid');

	// Swipe tracking
	let pointerDown = $state(false);
	let startX = $state(0);
	let startY = $state(0);
	let dragX = $state(0);
	let swiping = $state(false);

	const allImages = $derived.by(() => {
		if (images && images.length > 0) return images;
		return [{ url: imageUrl, width, height }];
	});
	const isMulti = $derived(allImages.length > 1);

	const currentSrc = $derived(allImages[currentIdx]?.url || imageUrl);

	const SWIPE_THRESHOLD = 30;

	function onPointerDown(e: PointerEvent) {
		if (!isMulti) return;
		pointerDown = true;
		swiping = false;
		startX = e.clientX;
		startY = e.clientY;
		dragX = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!pointerDown) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;

		if (!swiping && Math.abs(dx) > 6) {
			if (Math.abs(dx) / (Math.abs(dy) + 0.1) > 1.2) {
				swiping = true;
			} else {
				pointerDown = false;
				dragX = 0;
				return;
			}
		}

		if (swiping) {
			e.preventDefault();
			const atStart = currentIdx === 0 && dx > 0;
			const atEnd = currentIdx === allImages.length - 1 && dx < 0;
			dragX = (atStart || atEnd) ? dx * 0.25 : dx;
		}
	}

	function onPointerUp() {
		if (!pointerDown) return;
		pointerDown = false;

		if (swiping && Math.abs(dragX) > SWIPE_THRESHOLD) {
			if (dragX < 0 && currentIdx < allImages.length - 1) currentIdx++;
			else if (dragX > 0 && currentIdx > 0) currentIdx--;
		}
		dragX = 0;
		swiping = false;
	}

	function goTo(idx: number) {
		currentIdx = idx;
	}
</script>

{#snippet photoHeader()}
	{#if !imageError}
		<div
			data-card-type="photo"
			class="relative bg-surface-1 overflow-hidden select-none touch-pan-y h-full"
			onpointerdown={isMulti ? onPointerDown : undefined}
			onpointermove={isMulti ? onPointerMove : undefined}
			onpointerup={isMulti ? onPointerUp : undefined}
			onpointercancel={isMulti ? onPointerUp : undefined}
		>
			<!-- Drag hint: translate the image slightly while swiping -->
			<img
				src={currentSrc}
				alt={caption || 'Photo'}
				class="w-full h-auto object-cover transition-transform duration-200 ease-out"
				style={swiping ? `transform: translateX(${dragX}px); transition: none;` : ''}
				loading="lazy"
				draggable="false"
				onerror={() => (imageError = true)}
			/>

			{#if isMulti}
				<!-- Dots indicator -->
				<div class="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5">
					{#each allImages as _, i (i)}
						<button
							onclick={(e) => { e.stopPropagation(); goTo(i); }}
							class="rounded-full transition-all duration-300 ease-out
								{i === currentIdx
									? 'w-4 h-1.5 bg-white shadow-sm shadow-black/20'
									: 'w-1.5 h-1.5 bg-white/50 hover:bg-white/70'}"
							aria-label="Image {i + 1}"
						></button>
					{/each}
				</div>
				<!-- Counter pill -->
				<div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm">
					<span class="text-[10px] text-white font-semibold tabular-nums">{currentIdx + 1}/{allImages.length}</span>
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
	{onCommentClick}
	{layout}
	headerContent={!imageError ? photoHeader : undefined}
>
	{#if caption && !isCompact}
		<p class="text-[13px] text-muted leading-relaxed">{caption}</p>
	{:else if imageError}
		<div class="flex items-center justify-center py-8 text-muted">
			<Icon icon="ph:image-broken" class="text-2xl" />
		</div>
	{/if}
</Card>
