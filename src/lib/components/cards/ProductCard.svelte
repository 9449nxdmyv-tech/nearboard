<!--
  @file ProductCard.svelte
  @description Product card with price tracking and drop badge.
-->
<script lang="ts">
	import type { ProductCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';
	import { Button } from 'konsta/svelte';
	import Icon from '@iconify/svelte';

	let {
		id, boardId, url, title, image, price, domain,
		originalPrice, lastCheckedPrice, lastCheckedAt, priceDrop,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare
	}: ProductCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onDelete?: () => void;
		onShare?: () => void;
	} = $props();

	let imageError = $state(false);
</script>

{#snippet productHeader()}
	{#if image && !imageError}
		<div class="relative bg-surface-1 overflow-hidden">
			<img
				src={image}
				alt={title}
				class="w-full h-48 object-cover transition-transform duration-300 hover:scale-[1.02]"
				loading="lazy"
				onerror={() => (imageError = true)}
			/>
			{#if domain}
				<div class="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm">
					<Icon icon="ph:storefront" class="text-xs text-white" />
					<span class="text-[11px] text-white/90 font-medium">{domain}</span>
				</div>
			{/if}
			{#if priceDrop}
				<div class="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-success backdrop-blur-sm">
					<Icon icon="ph:arrow-trend-down" class="text-xs text-white" />
					<span class="text-[11px] text-white font-medium">Price Drop</span>
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
	{onShare}
	{onDelete}
	headerContent={image && !imageError ? productHeader : undefined}
>

	<!-- Price and title -->
	<div class="space-y-1.5">
		<div class="flex items-baseline gap-2">
			<span class="text-xl font-bold text-type-product">{price}</span>
			{#if originalPrice && originalPrice !== price}
				<span class="text-sm text-muted line-through">{originalPrice}</span>
			{/if}
		</div>

		<a href={url} target="_blank" rel="noopener noreferrer" class="block group">
			<h3 class="text-[15px] font-semibold text-on-surface leading-snug group-hover:text-primary transition-colors">{title}</h3>
		</a>

		{#if domain && (!image || imageError)}
			<div class="flex items-center gap-1.5 text-[11px] text-muted font-medium">
				<Icon icon="ph:storefront" class="text-sm" />
				{domain}
			</div>
		{/if}

		<!-- View button -->
		<a href={url} target="_blank" rel="noopener noreferrer">
			<Button rounded class="w-full mt-2 press-scale">
				<Icon icon="ph:shopping-bag" class="mr-2" />
				View Product
			</Button>
		</a>
	</div>
</Card>
