<!--
  @file LocationCard.svelte
  @description Location card with static map tile, pin, and address.
-->
<script lang="ts">
	import type { LocationCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';
	import { Button } from 'konsta/svelte';
	import Icon from '@iconify/svelte';

	let {
		id, boardId, latitude, longitude, address, name,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare
	}: LocationCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onDelete?: () => void;
		onShare?: () => void;
	} = $props();

	let mapError = $state(false);

	function getGoogleMapsUrl(): string {
		return `https://www.google.com/maps?q=${latitude},${longitude}`;
	}

	// OpenStreetMap static tile (no API key needed)
	const staticMapUrl = $derived(
		`https://staticmap.openstreetmap.de/staticmap.php?center=${latitude},${longitude}&zoom=15&size=600x200&maptype=mapnik&markers=${latitude},${longitude},red-pushpin`
	);
</script>

{#snippet mapHeader()}
	{#if !mapError}
		<div class="relative bg-surface-1 overflow-hidden">
			<img
				src={staticMapUrl}
				alt={name || address || 'Location'}
				class="w-full h-40 object-cover"
				loading="lazy"
				onerror={() => { mapError = true; }}
			/>
			<div class="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm">
				<Icon icon="ph:map-pin-fill" class="text-xs text-white" />
				<span class="text-[11px] text-white/90 font-medium">{name || 'Location'}</span>
			</div>
		</div>
	{:else}
		<div class="h-32 bg-surface-1 flex items-center justify-center">
			<div class="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center">
				<Icon icon="ph:map-pin-fill" class="text-2xl text-on-surface/40" />
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
	headerContent={mapHeader}
>
	<div class="space-y-2.5">
		{#if name}
			<h3 class="font-semibold text-base text-on-surface">{name}</h3>
		{/if}
		{#if address}
			<p class="text-sm text-muted line-clamp-2">{address}</p>
		{/if}

		<a href={getGoogleMapsUrl()} target="_blank" rel="noopener noreferrer">
			<Button rounded class="w-full">
				<Icon icon="ph:map-trifold" class="mr-2" />
				Open in Maps
			</Button>
		</a>
	</div>
</Card>
