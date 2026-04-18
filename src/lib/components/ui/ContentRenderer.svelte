<!--
  @file ContentRenderer.svelte
  @description Renders a single content item as the appropriate card component
               based on its type. Used across board view, feed, and public board pages.
-->
<script lang="ts">
	import type { ContentDoc, ListContentDoc, ProductContentDoc } from '$lib/types';
	import NoteCard from '$lib/components/cards/NoteCard.svelte';
	import ListCard from '$lib/components/cards/ListCard.svelte';
	import LinkCard from '$lib/components/cards/LinkCard.svelte';
	import ProductCard from '$lib/components/cards/ProductCard.svelte';
	import VoiceCard from '$lib/components/cards/VoiceCard.svelte';
	import PhotoCard from '$lib/components/cards/PhotoCard.svelte';
	import VideoCard from '$lib/components/cards/VideoCard.svelte';
	import LocationCard from '$lib/components/cards/LocationCard.svelte';
	import PollCard from '$lib/components/ui/PollCard.svelte';

	let {
		item,
		boardId,
		isBoardOwner = false,
		allowComments = true,
		expandComments = false,
		onEdit,
		onDelete,
		onToggleListItem,
		onShare,
		onCommentClick,
		resolveAuthorPhoto
	}: {
		item: ContentDoc;
		boardId: string;
		isBoardOwner?: boolean;
		allowComments?: boolean;
		expandComments?: boolean;
		onEdit?: (item: ContentDoc) => void;
		onDelete?: (item: ContentDoc) => void;
		onToggleListItem?: (contentItem: ListContentDoc, itemId: string) => void;
		onShare?: (item: ContentDoc) => void;
		/** Fires when the comment button is tapped. Opens the card detail modal with comments expanded. */
		onCommentClick?: () => void;
		/** Resolve author photo from current member data. Falls back to item.authorPhotoURL. */
		resolveAuthorPhoto?: (authorId: string, snapshotUrl: string | null) => string | null;
	} = $props();

	// Common props shared by all card types
	const common = $derived({
		id: item.id,
		boardId,
		authorId: item.authorId,
		authorName: item.authorName,
		authorPhotoURL: resolveAuthorPhoto
			? resolveAuthorPhoto(item.authorId, item.authorPhotoURL)
			: item.authorPhotoURL,
		createdAt: item.createdAt?.toDate() ?? new Date(),
		isBoardOwner,
		allowComments,
		expandComments,
		commentCount: item.commentCount,
		acknowledgments: item.acknowledgments,
		onDelete: onDelete ? () => onDelete(item) : undefined,
		onShare: onShare ? () => onShare(item) : undefined,
		onCommentClick
	});
</script>

{#if item.type === 'note'}
	<NoteCard
		{...common}
		text={item.text}
		onEdit={onEdit ? () => onEdit(item) : undefined}
	/>
{:else if item.type === 'list'}
	<ListCard
		{...common}
		title={item.title}
		items={item.items}
		onToggleItem={(itemId) => onToggleListItem?.(item as ListContentDoc, itemId)}
		onEdit={onEdit ? () => onEdit(item) : undefined}
	/>
{:else if item.type === 'link'}
	<LinkCard
		{...common}
		url={item.url}
		title={item.title}
		description={item.description}
		image={item.image}
		domain={item.domain}
		favicon={item.favicon}
		enrichment={item.enrichment}
	/>
{:else if item.type === 'product'}
	<ProductCard
		{...common}
		url={item.url}
		title={item.title}
		description={item.description}
		image={item.image}
		domain={item.domain}
		favicon={item.favicon}
		enrichment={item.enrichment}
		price={item.price}
		originalPrice={item.originalPrice}
		lastCheckedPrice={item.lastCheckedPrice}
		lastCheckedAt={item.lastCheckedAt}
		priceDrop={item.priceDrop}
	/>
{:else if item.type === 'voice'}
	<VoiceCard
		{...common}
		audioUrl={item.audioUrl}
		durationMs={item.durationMs}
	/>
{:else if item.type === 'photo'}
	<PhotoCard
		{...common}
		imageUrl={item.imageUrl}
		images={item.images ?? []}
		caption={item.caption}
		width={item.width}
		height={item.height}
	/>
{:else if item.type === 'video'}
	<VideoCard
		{...common}
		videoUrl={item.videoUrl}
		thumbnailUrl={item.thumbnailUrl}
		durationMs={item.durationMs}
		caption={item.caption}
	/>
{:else if item.type === 'location'}
	<LocationCard
		{...common}
		latitude={item.latitude}
		longitude={item.longitude}
		address={item.address}
		name={item.name}
	/>
{:else if item.type === 'poll'}
	<PollCard
		{...common}
		question={item.question}
		options={item.options}
	/>
{/if}
