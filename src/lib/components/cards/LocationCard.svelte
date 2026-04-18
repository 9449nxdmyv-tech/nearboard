<!--
  @file LocationCard.svelte
  @description Location card with interactive map, address, and navigation.
-->
<script lang="ts">
	import type { LocationCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';
	import { Button } from 'konsta/svelte';
	import Icon from '@iconify/svelte';
	import MapView from '$lib/components/ui/MapView.svelte';

	let {
		id, boardId, latitude, longitude, address, name,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare, onCommentClick
	}: LocationCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onDelete?: () => void;
		onShare?: () => void;
		onCommentClick?: () => void;
	} = $props();

	let mapError = $state(false);

	function getGoogleMapsUrl(): string {
		return `https://www.google.com/maps?q=${latitude},${longitude}`;
	}
</script>

{#snippet mapHeader()}
	{#if !mapError}
		<div class="relative bg-surface-1 overflow-hidden">
			<MapView
				{latitude}
				{longitude}
				zoom={14}
				interactive={false}
				height="180px"
				onMapError={() => { mapError = true; }}
			/>
			{#if name}
				<div class="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
					<div class="w-5 h-5 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shrink-0 shadow-sm">
						<Icon icon="ph:map-pin-fill" class="text-xs text-primary" />
					</div>
					<span class="text-[11px] text-white font-semibold truncate drop-shadow-md">{name}</span>
				</div>
			{/if}
		</div>
	{:else}
		<div class="relative h-32 bg-gradient-to-br from-primary/20 via-primary/10 to-accent/20 flex items-center justify-center">
			<div class="flex flex-col items-center gap-2">
				<div class="w-12 h-12 rounded-full bg-white/60 backdrop-blur-sm flex items-center justify-center shadow-lg">
					<Icon icon="ph:map-pin" class="text-xl text-primary" />
				</div>
				{#if name}
					<p class="text-[12px] font-semibold text-on-surface/80 px-4 truncate">{name}</p>
				{/if}
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
	{onCommentClick}
	headerContent={mapHeader}
>
	<div class="flex flex-col gap-2">
		{#if address}
			<p class="text-[13px] text-muted leading-snug line-clamp-2">{address}</p>
		{/if}

		<a href={getGoogleMapsUrl()} target="_blank" rel="noopener noreferrer" class="w-full">
			<Button small rounded class="w-full">
				<Icon icon="ph:navigation-arrow" class="mr-1.5" />
				Navigate
			</Button>
		</a>
	</div>
</Card>
