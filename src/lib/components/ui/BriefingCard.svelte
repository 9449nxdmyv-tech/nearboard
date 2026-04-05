<!--
  @file BriefingCard.svelte
  @description Displays the latest AI-generated briefing for a board.
               Compact card with sparkle icon, briefing text, and optional voice playback.
               Supports expand/collapse for long text and skeleton loading state.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { slide } from 'svelte/transition';
	import { relativeTime } from '$lib/utils/dateFormatter';
	import { renderSummaryHtml, stripMarkdown } from '$lib/utils/textFormatter';

	let {
		text,
		generatedAt,
		audioUrl = null
	}: {
		text: string;
		generatedAt: Date;
		audioUrl?: string | null;
	} = $props();

	let playing = $state(false);
	let audioEl: HTMLAudioElement | undefined = $state();
	let expanded = $state(false);

	const TRUNCATE_LIMIT = 120;
	const plainText = $derived(stripMarkdown(text));
	const isLong = $derived(plainText.length > TRUNCATE_LIMIT);
	const displayHtml = $derived(
		isLong && !expanded
			? renderSummaryHtml(text).slice(0, TRUNCATE_LIMIT * 2) + '…'
			: renderSummaryHtml(text)
	);
	const isLoading = $derived(text === '');

	function togglePlay() {
		if (!audioEl) return;
		if (playing) {
			audioEl.pause();
		} else {
			audioEl.play();
		}
		playing = !playing;
	}

	function handleEnded() {
		playing = false;
	}
</script>

<div class="border border-accent/20 bg-accent/5 rounded-card p-4">
	{#if isLoading}
		<!-- Skeleton loading state -->
		<div class="flex items-start gap-3">
			<div class="w-[18px] h-[18px] rounded bg-accent/20 shrink-0 skeleton-pulse"></div>
			<div class="flex-1 min-w-0 space-y-2">
				<div class="h-3.5 w-full rounded bg-accent/15 skeleton-pulse"></div>
				<div class="h-3.5 w-3/4 rounded bg-accent/10 skeleton-pulse"></div>
			</div>
		</div>
	{:else}
		<div class="flex items-start gap-3">
			<Icon icon="ph:sparkle-fill" class="text-accent text-lg shrink-0" aria-hidden="true" />
			<div class="flex-1 min-w-0">
				<div transition:slide={{ duration: 200 }}>
					<p class="summary-prose text-sm text-primary leading-relaxed">{@html displayHtml}</p>
				</div>
				{#if isLong}
					<button
						onclick={() => expanded = !expanded}
						class="text-xs text-accent font-medium mt-1 hover:underline"
					>
						{expanded ? 'Show less' : 'Show more'}
					</button>
				{/if}
				<p class="text-xs text-muted mt-2">{relativeTime(generatedAt)}</p>
			</div>
			{#if audioUrl}
				<button
					onclick={togglePlay}
					class="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center
						justify-center shrink-0 active:scale-[0.98] transition-transform"
					aria-label={playing ? 'Pause briefing' : 'Play briefing'}
				>
					{#if playing}
						<Icon icon="ph:pause-fill" class="text-sm" />
					{:else}
						<Icon icon="ph:play-fill" class="text-sm" />
					{/if}
				</button>
				<audio
					bind:this={audioEl}
					src={audioUrl}
					onended={handleEnded}
					preload="metadata"
				></audio>
			{/if}
		</div>
	{/if}
</div>

<style>
	@keyframes skeleton-pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 1; }
	}
	.skeleton-pulse {
		animation: skeleton-pulse 1.5s ease-in-out infinite;
	}
	:global(.summary-prose strong) {
		font-weight: 600;
		color: var(--color-primary);
	}
	:global(.summary-prose em) {
		font-style: italic;
		opacity: 0.8;
	}
</style>
