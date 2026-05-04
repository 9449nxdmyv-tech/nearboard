<!--
  @file ProductCard.svelte
  @description Product card with price tracking and drop badge.
-->
<script lang="ts">
	import type { ProductCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';
	import Icon from '@iconify/svelte';
	import MetadataPill from './link/MetadataPill.svelte';
	import {
		isRecipeEnrichment,
		isMovieEnrichment,
		isProductEnrichment
	} from '$lib/utils/enrichmentGuards';

	let {
		id, boardId, url, title, image, price, domain,
		originalPrice, lastCheckedPrice, lastCheckedAt, priceDrop,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare, onCommentClick,
		enrichment, description, favicon, layout
	}: ProductCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onDelete?: () => void;
		onShare?: () => void;
		onCommentClick?: () => void;
	} = $props();

	let imageError = $state(false);
</script>

{#snippet productHeader()}
	{#if image && !imageError}
		<div class="relative bg-surface-1 overflow-hidden">
			<img
				src={image}
				alt={title}
				class="w-full aspect-square object-cover transition-transform duration-300 hover:scale-[1.02]"
				loading="lazy"
				onerror={() => (imageError = true)}
			/>
			{#if domain}
				<div class="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm">
					<div class="w-5 h-5 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
						<Icon icon="ph:storefront" class="text-[10px] text-white" />
					</div>
					<span class="text-[10px] text-white font-semibold">{domain}</span>
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
	{onCommentClick}
	{layout}
	headerContent={image && !imageError ? productHeader : undefined}
>

	<!-- Price and title -->
	<div class="space-y-1.5">
		{#if price && price.trim()}
			<div class="flex items-baseline gap-2">
				<span class="text-xl font-bold text-primary">{price}</span>
				{#if originalPrice && originalPrice !== price}
					<span class="text-sm text-muted line-through">{originalPrice}</span>
				{/if}
			</div>
		{/if}

		{#if title?.trim()}
			<a href={url} target="_blank" rel="noopener noreferrer" class="block group">
				<h3 class="text-[15px] font-semibold text-on-surface leading-snug group-hover:text-primary transition-colors">{title}</h3>
			</a>
		{/if}

		{#if domain && (!image || imageError)}
			<div class="flex items-center gap-1.5 text-[11px] text-muted font-medium">
				<Icon icon="ph:storefront" class="text-sm" />
				{domain}
			</div>
		{/if}

		<!-- Enrichment-aware metadata -->
		{#if enrichment}
			{@const e = enrichment}
			{#if isProductEnrichment(e)}
				<div class="flex flex-wrap items-center gap-1.5 mt-2">
					{#if e.brand}<MetadataPill icon="ph:storefront" text={e.brand} variant="surface" />{/if}
					{#if e.rating}
						<MetadataPill
							icon="ph:star-fill"
							text={e.ratingCount ? `${e.rating} (${e.ratingCount})` : String(e.rating)}
							variant="rating"
						/>
					{/if}
					{#if e.availability === 'OutOfStock'}
						<MetadataPill icon="ph:x-circle" text="Out of stock" variant="surface" />
					{:else if e.availability === 'PreOrder'}
						<MetadataPill icon="ph:clock" text="Pre-order" variant="surface" />
					{:else if e.availability === 'BackOrder'}
						<MetadataPill icon="ph:clock-countdown" text="Backorder" variant="surface" />
					{:else if e.availability === 'LimitedAvailability'}
						<MetadataPill icon="ph:warning" text="Limited" variant="surface" />
					{:else if e.availability === 'Discontinued'}
						<MetadataPill icon="ph:prohibit" text="Discontinued" variant="surface" />
					{/if}
				</div>
			{:else if isRecipeEnrichment(e)}
				<div class="flex flex-wrap items-center gap-1.5 mt-2">
					{#if e.totalTime}<MetadataPill icon="ph:timer" text={e.totalTime} variant="surface" />{/if}
					{#if e.servings}<MetadataPill icon="ph:users" text={e.servings} variant="surface" />{/if}
					{#if e.calories}<MetadataPill icon="ph:fire" text={e.calories} variant="surface" />{/if}
				</div>
			{:else if isMovieEnrichment(e)}
				<div class="flex flex-wrap items-center gap-1.5 mt-2">
					{#if e.rating}<MetadataPill icon="ph:star-fill" text={String(e.rating)} variant="rating" />{/if}
					{#if e.year}<MetadataPill text={String(e.year)} variant="surface" />{/if}
					{#if e.runtime}<MetadataPill text={e.runtime} variant="surface" />{/if}
				</div>
			{/if}
		{/if}
	</div>
</Card>
