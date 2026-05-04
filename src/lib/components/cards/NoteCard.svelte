<!--
  @file NoteCard.svelte
  @description Note card — plain text content.
               Short notes (≤80 chars, single line) render as tinted "sticky note"
               surfaces with display typography and a single decorative quote mark.
               Long notes use the standard card surface with size-adaptive body text.
-->
<script lang="ts">
	import type { NoteCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';
	import { pickNoteTone } from '$lib/utils/noteTone';

	let {
		id, boardId, text, authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments,
		onEdit, onDelete, onShare, onCommentClick, layout
	}: NoteCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onEdit?: () => void;
		onDelete?: () => void;
		onShare?: () => void;
		onCommentClick?: () => void;
	} = $props();

	const trimmedText = $derived(text.trim());
	const isShort = $derived(trimmedText.length <= 80 && !trimmedText.includes('\n'));

	// Sticky-note tone — colour is hashed off the text so the same note
	// always renders the same way, keeping the board's visual rhythm stable.
	const tone = $derived(isShort ? pickNoteTone(trimmedText) : null);

	// Size scales with length so 3-word notes feel like signage and 50-char
	// notes still breathe instead of stretching across multiple lines awkwardly.
	const shortTextSize = $derived.by(() => {
		const len = trimmedText.length;
		if (len <= 24) return 'text-[28px] leading-[1.15]';
		if (len <= 48) return 'text-[22px] leading-[1.2]';
		return 'text-[18px] leading-[1.3]';
	});

	const longTextSize = $derived.by(() => {
		const len = trimmedText.length;
		if (len <= 150) return 'text-lg';
		if (len <= 300) return 'text-[15px]';
		return 'text-[14px]';
	});

	// Tint applies only to the body — footer/avatar stay on the standard card
	// surface so author info and action buttons don't pick up the sticky-note hue.
	const bodyStyle = $derived(
		tone
			? `background-color: ${tone.bg}; box-shadow: inset 0 -1px 0 ${tone.ring};`
			: ''
	);
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
	{layout}
	{bodyStyle}
>
	{#if isShort && tone}
		<div class="relative pt-3 pb-4 px-2">
			<!-- Single oversized opening quote, bleeding into the corner so the
			     text feels held by it without being decorated to death. -->
			<span
				aria-hidden="true"
				class="absolute -top-2 -left-1 text-[64px] leading-none font-serif select-none pointer-events-none"
				style="color: {tone.mark};"
			>“</span>
			<p
				class="{shortTextSize} font-semibold tracking-[-0.01em] pl-6 pr-2"
				style="color: {tone.body};"
			>{trimmedText}</p>
		</div>
	{:else}
		<p class="{longTextSize} leading-relaxed text-on-surface whitespace-pre-wrap line-clamp-[12]">{trimmedText}</p>
	{/if}
</Card>
