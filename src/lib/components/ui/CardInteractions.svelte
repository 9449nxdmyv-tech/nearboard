<!--
  @file CardInteractions.svelte
  @description Interaction bar: fave heart, comments toggle, share.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import CardAcknowledgmentButton from './CardAcknowledgmentButton.svelte';
	import { hapticLight } from '$lib/utils/haptics';

	let {
		boardId,
		contentId,
		acknowledgments = {},
		commentCount = 0,
		showComments = $bindable(false),
		onShare,
		onCommentClick,
		isDetail = false
	}: {
		boardId: string;
		contentId: string;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		commentCount?: number;
		showComments?: boolean;
		onShare?: () => void;
		/** Fires when the comment button is tapped. If provided, overrides the default toggle behavior. */
		onCommentClick?: () => void;
		isDetail?: boolean;
	} = $props();
</script>

<div class="flex items-center px-1 py-1 border-t border-surface-1 {isDetail ? 'gap-8 px-8 py-3 justify-around' : ''}">
	<!-- Fave / Heart -->
	<div class={isDetail ? '' : 'flex-1 flex justify-center'}>
		<CardAcknowledgmentButton {boardId} {contentId} {acknowledgments} {isDetail} />
	</div>

	<!-- Comments toggle -->
	<div class={isDetail ? '' : 'flex-1 flex justify-center'}>
		<button
			onclick={(e) => { e.stopPropagation(); hapticLight(); if (onCommentClick) { onCommentClick(); } else { showComments = !showComments; } }}
			class="flex items-center justify-center gap-1.5 transition-all duration-200 press-scale
				{isDetail ? 'px-3 py-2 text-accent' : 'py-2 px-3 text-muted'}
				{!isDetail && showComments ? 'text-accent' : ''}"
			aria-label="Toggle comments"
		>
			<Icon icon={showComments ? 'ph:chat-circle-dots-fill' : 'ph:chat-circle-dots'} class={isDetail ? 'text-xl' : 'text-lg'} />
			{#if commentCount && commentCount > 0}
				<span class="{isDetail ? 'text-sm' : 'text-xs'} font-semibold tabular-nums">{commentCount}</span>
			{/if}
		</button>
	</div>

	<!-- Share -->
	<div class={isDetail ? '' : 'flex-1 flex justify-center'}>
		<button
			onclick={(e) => { e.stopPropagation(); hapticLight(); onShare?.(); }}
			class="flex items-center justify-center transition-all duration-200 press-scale
				{isDetail ? 'px-3 py-2 text-primary' : 'py-2 px-3 text-muted'}"
			aria-label="Share"
		>
			<Icon icon="ph:share-fat" class={isDetail ? 'text-xl' : 'text-lg'} />
		</button>
	</div>
</div>
