<!--
  @file LinkCard.svelte
  @description Content-aware link card. Each enrichment kind gets a distinct
               native-feeling layout rather than a generic link preview.
               YouTube → embedded player, Recipe → ingredients count + time,
               Movie → poster + rating + year, Article → clean excerpt, etc.
-->
<script lang="ts">
	import type { LinkCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';
	import { extractYouTubeId } from '$lib/utils/urlUtils';
	import {
		isRecipeEnrichment,
		isMovieEnrichment,
		isBookEnrichment,
		isPlaceEnrichment,
		isMusicEnrichment,
		isArticleEnrichment,
		isGithubEnrichment
	} from '$lib/utils/enrichmentGuards';
	import type { LinkEnrichment } from '$lib/types/api';
	import Icon from '@iconify/svelte';
	import MetadataPill from './link/MetadataPill.svelte';
	import LinkSourceBar from './link/LinkSourceBar.svelte';

	let {
		id, boardId, url, title, description, image, domain, favicon, enrichment, price,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments,
		onDelete, onShare
	}: LinkCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onDelete?: () => void;
		onShare?: () => void;
		price?: string;
	} = $props();

	let imageError = $state(false);
	const youtubeId = $derived(extractYouTubeId(url));

	const contentType = $derived.by(() => {
		if (youtubeId) return 'youtube';
		if (price) return 'product';
		if (enrichment) {
			if (isRecipeEnrichment(enrichment)) return 'recipe';
			if (isMovieEnrichment(enrichment)) return 'movie';
			if (isBookEnrichment(enrichment)) return 'book';
			if (isPlaceEnrichment(enrichment)) return 'place';
			if (isMusicEnrichment(enrichment)) return 'music';
			if (isArticleEnrichment(enrichment)) return 'article';
			if (isGithubEnrichment(enrichment)) return 'github';
		}
		return 'default';
	});

	function getVariantIcon(): string {
		switch (contentType) {
			case 'youtube': return 'ph:youtube-logo';
			case 'product': return 'ph:shopping-bag';
			case 'recipe': return 'ph:chef-hat';
			case 'movie': return 'ph:film-strip';
			case 'book': return 'ph:book';
			case 'place': return 'ph:map-pin';
			case 'music': return 'ph:music-note';
			case 'article': return 'ph:newspaper';
			case 'github': return 'ph:github-logo';
			default: return 'ph:link';
		}
	}

	// YouTube player state
	let ytLoaded = $state(false);
	let ytImageError = $state(false);
	const ytThumbnail = $derived(image ?? (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null));
</script>

{#snippet linkHeader()}
	{#if youtubeId}
		<!-- YouTube embed -->
		{#if ytLoaded}
			<div class="relative w-full" style="padding-bottom: 56.25%;">
				<iframe
					src="https://www.youtube-nocookie.com/embed/{youtubeId}?rel=0&playsinline=1&autoplay=1&mute=1"
					{title}
					class="absolute inset-0 w-full h-full"
					frameborder="0"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowfullscreen
				></iframe>
			</div>
		{:else}
			<button onclick={() => { ytLoaded = true; }} class="relative block w-full group cursor-pointer overflow-hidden">
				{#if ytThumbnail && !ytImageError}
					<img src={ytThumbnail} alt={title}
						width="480" height="270" loading="lazy"
						class="w-full aspect-video object-cover transition-transform duration-300 group-hover:scale-[1.03]"
						onerror={() => { ytImageError = true; }} />
				{:else}
					<div class="w-full aspect-video bg-on-surface flex items-center justify-center">
						<Icon icon="ph:youtube-logo" class="text-[color:var(--color-youtube-red)] text-5xl opacity-30" />
					</div>
				{/if}
				<div class="absolute inset-0 bg-black/25 flex items-center justify-center group-hover:bg-black/35 transition-colors">
					<div class="w-16 h-16 rounded-full bg-[color:var(--color-youtube-red)] flex items-center justify-center shadow-xl
						transition-transform duration-300 group-hover:scale-105">
						<Icon icon="ph:play-fill" class="text-white text-3xl ml-0.5" />
					</div>
				</div>
				<div class="absolute bottom-2.5 right-2.5 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[11px] text-white font-semibold">
					YouTube
				</div>
			</button>
		{/if}
	{:else if image && !imageError}
		<!-- Hero image with variant badge -->
		<div class="relative bg-surface-1 overflow-hidden">
			<img
				src={image}
				alt={title}
				class="w-full h-44 object-cover transition-transform duration-300 hover:scale-[1.02]"
				loading="lazy"
				onerror={() => (imageError = true)}
			/>
			<div class="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm">
				<Icon icon={getVariantIcon()} class="text-xs text-white" />
				<span class="text-[11px] text-white/90 font-medium">{domain}</span>
			</div>
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
	headerContent={(youtubeId || (image && !imageError)) ? linkHeader : undefined}
>
	{#if !image || imageError}
		<!-- Compact fallback with icon + source -->
		<div class="flex items-center gap-2.5 mb-2">
			<div class="w-9 h-9 rounded-[var(--radius-sm)] bg-primary/10 flex items-center justify-center shrink-0">
				<Icon icon={getVariantIcon()} class="text-lg text-primary" />
			</div>
			<LinkSourceBar {domain} {favicon} />
		</div>
	{/if}

	<h3 class="font-semibold text-[15px] text-on-surface leading-snug">{title}</h3>

	{#if price}
		<div class="text-sm font-bold text-primary mt-2">{price}</div>
	{/if}

	<!-- ═══ Enrichment-aware body ═══ -->
	{#if enrichment && isRecipeEnrichment(enrichment)}
		<!-- Recipe: time + servings + ingredient count -->
		<div class="flex flex-wrap items-center gap-1.5 mt-2.5">
			{#if enrichment.totalTime}
				<MetadataPill icon="ph:timer" text={enrichment.totalTime} variant="surface" />
			{/if}
			{#if enrichment.servings}
				<MetadataPill icon="ph:users" text={enrichment.servings} variant="surface" />
			{/if}
			{#if enrichment.calories}
				<MetadataPill icon="ph:fire" text={enrichment.calories} variant="surface" />
			{/if}
			{#if enrichment.cuisine}
				<MetadataPill text={enrichment.cuisine} variant="surface" />
			{/if}
		</div>
		{#if enrichment.ingredients.length > 0}
			<p class="text-[12px] text-muted mt-2">
				<Icon icon="ph:list-bullets" class="inline text-sm mr-0.5 align-[-2px]" />{enrichment.ingredients.length} ingredients
			</p>
		{/if}

	{:else if enrichment && isMovieEnrichment(enrichment)}
		<!-- Movie: year + rating + genre + director -->
		<div class="flex flex-wrap items-center gap-1.5 mt-2.5">
			{#if enrichment.rating}
				<MetadataPill icon="ph:star-fill" iconColor="var(--color-rating-star)" text="{enrichment.rating}{enrichment.ratingSource ?? ''}" variant="rating" />
			{/if}
			{#if enrichment.year}
				<MetadataPill text={String(enrichment.year)} variant="surface" />
			{/if}
			{#if enrichment.runtime}
				<MetadataPill icon="ph:clock" text={enrichment.runtime} variant="surface" />
			{/if}
			{#if enrichment.genre}
				<MetadataPill text={enrichment.genre} variant="surface" />
			{/if}
		</div>
		{#if enrichment.director}
			<p class="text-[12px] text-muted mt-1.5">
				<Icon icon="ph:megaphone" class="inline text-sm mr-0.5 align-[-2px]" />Directed by {enrichment.director}
			</p>
		{/if}
		{#if enrichment.cast?.length > 0}
			<p class="text-[12px] text-muted mt-0.5 line-clamp-1">
				{enrichment.cast.slice(0, 3).join(', ')}
			</p>
		{/if}

	{:else if enrichment && isBookEnrichment(enrichment)}
		<!-- Book: author + rating + pages -->
		{#if enrichment.author}
			<p class="text-[13px] text-muted mt-1.5">by {enrichment.author}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-1.5 mt-2">
			{#if enrichment.averageRating}
				<MetadataPill icon="ph:star-fill" iconColor="#eab308" text={enrichment.averageRating} variant="rating" />
			{/if}
			{#if enrichment.pageCount}
				<MetadataPill text="{enrichment.pageCount} pages" variant="surface" />
			{/if}
			{#if enrichment.genre}
				<MetadataPill text={enrichment.genre} variant="surface" />
			{/if}
		</div>

	{:else if enrichment && isPlaceEnrichment(enrichment)}
		<!-- Place: rating + category + price range + address -->
		<div class="flex flex-wrap items-center gap-1.5 mt-2.5">
			{#if enrichment.rating}
				<MetadataPill icon="ph:star-fill" iconColor="#eab308" text={enrichment.rating} variant="rating" />
			{/if}
			{#if enrichment.category}
				<MetadataPill text={enrichment.category} variant="surface" />
			{/if}
			{#if enrichment.priceRange}
				<MetadataPill icon="ph:currency-dollar" text={enrichment.priceRange} variant="surface" />
			{/if}
		</div>
		{#if enrichment.address}
			<p class="text-[12px] text-muted mt-1.5 line-clamp-1">
				<Icon icon="ph:map-pin" class="inline text-sm mr-0.5 align-[-2px]" />{enrichment.address}
			</p>
		{/if}
		{#if enrichment.hours}
			<p class="text-[12px] text-muted mt-0.5 line-clamp-1">
				<Icon icon="ph:clock" class="inline text-sm mr-0.5 align-[-2px]" />{enrichment.hours}
			</p>
		{/if}

	{:else if enrichment && isMusicEnrichment(enrichment)}
		<!-- Music: artist + album -->
		{#if enrichment.artist}
			<p class="text-[13px] text-muted mt-1.5">{enrichment.artist}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-1.5 mt-2">
			{#if enrichment.album}
				<MetadataPill icon="ph:vinyl-record" text={enrichment.album} variant="surface" />
			{/if}
			{#if enrichment.duration}
				<MetadataPill icon="ph:clock" text={enrichment.duration} variant="surface" />
			{/if}
			{#if enrichment.genre}
				<MetadataPill text={enrichment.genre} variant="surface" />
			{/if}
		</div>

	{:else if enrichment && isArticleEnrichment(enrichment)}
		<!-- Article: author byline + reading time + clean excerpt -->
		<div class="flex flex-wrap items-center gap-1.5 mt-2">
			{#if enrichment.author}
				<span class="text-[12px] text-muted font-medium">{enrichment.author}</span>
			{/if}
			{#if enrichment.author && (enrichment.readingTime || enrichment.siteName)}
				<span class="text-[10px] text-muted/40">·</span>
			{/if}
			{#if enrichment.readingTime}
				<span class="text-[12px] text-muted">{enrichment.readingTime}</span>
			{/if}
			{#if enrichment.siteName}
				<span class="text-[10px] text-muted/40">·</span>
				<span class="text-[12px] text-muted">{enrichment.siteName}</span>
			{/if}
		</div>
		{#if description}
			<p class="text-[13px] text-muted leading-relaxed line-clamp-4 mt-1.5">{description}</p>
		{/if}

	{:else if enrichment && isGithubEnrichment(enrichment)}
		<!-- GitHub: owner/repo + stats -->
		{#if enrichment.description}
			<p class="text-[13px] text-muted leading-relaxed line-clamp-2 mt-1.5">{enrichment.description}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-1.5 mt-2">
			{#if enrichment.language}
				<MetadataPill text={enrichment.language} variant="surface" />
			{/if}
			{#if enrichment.stars}
				<MetadataPill icon="ph:star" iconColor="#eab308" text={enrichment.stars} variant="surface" />
			{/if}
			{#if enrichment.forks}
				<MetadataPill icon="ph:git-fork" text={enrichment.forks} variant="surface" />
			{/if}
		</div>

	{:else}
		<!-- Default: just show description -->
		{#if description}
			<p class="text-[13px] text-muted leading-relaxed line-clamp-3 mt-1.5">{description}</p>
		{/if}
	{/if}
</Card>
