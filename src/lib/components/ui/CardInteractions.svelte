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
		onShare
	}: {
		boardId: string;
		contentId: string;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		commentCount?: number;
		showComments?: boolean;
		onShare?: () => void;
	} = $props();
</script>

<div class="flex items-center px-1 py-1 border-t border-surface-1">
	<!-- Fave / Heart -->
	<div class="flex-1 flex justify-center">
		<CardAcknowledgmentButton {boardId} {contentId} {acknowledgments} />
	</div>

	<!-- Comments toggle -->
	<div class="flex-1 flex justify-center">
		<button
			onclick={() => { hapticLight(); showComments = !showComments; }}
			class="flex items-center gap-1.5 py-2 px-3 transition-colors duration-200 press-scale
				{showComments ? 'text-accent' : 'text-muted'}"
			aria-label="Toggle comments"
		>
			<Icon icon={showComments ? 'ph:chat-circle-dots-fill' : 'ph:chat-circle-dots'} class="text-lg" />
			{#if commentCount && commentCount > 0}
				<span class="text-xs font-semibold tabular-nums">{commentCount}</span>
			{/if}
		</button>
	</div>

	<!-- Share -->
	<div class="flex-1 flex justify-center">
		<button
			onclick={() => { hapticLight(); onShare?.(); }}
			class="flex items-center gap-1.5 py-2 px-3 text-muted transition-colors duration-200 press-scale"
			aria-label="Share"
		>
			<Icon icon="ph:share-network" class="text-lg" />
		</button>
	</div>
</div>
