<!--
  @file VideoCard.svelte
  @description Video card with play overlay and duration badge.
-->
<script lang="ts">
	import { getContext } from 'svelte';
	import { browser } from '$app/environment';
	import type { VideoCardProps } from '$lib/types/ui';
	import type { VideoPlayback } from '$lib/types/firestore';
	import Card from '$lib/components/ui/Card.svelte';
	import Icon from '@iconify/svelte';
	import { formatDurationMs } from '$lib/utils/dateFormatter';
	import { globalExperience } from '$lib/stores';

	let {
		id, boardId, videoUrl, thumbnailUrl, durationMs, caption,
		authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare, onCommentClick
	}: VideoCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onDelete?: () => void;
		onShare?: () => void;
		onCommentClick?: () => void;
	} = $props();

	const getVideoPlayback = getContext<(() => VideoPlayback) | undefined>('videoPlayback');
	const videoPlayback = $derived(getVideoPlayback?.() ?? $globalExperience.videoPlayback);

	function shouldAutoplay(): boolean {
		if (videoPlayback === 'tap-to-play') return false;
		if (videoPlayback === 'muted-autoplay' || videoPlayback === 'full-autoplay') return true;
		if (videoPlayback === 'wifi-autoplay' && browser) {
			const conn = (navigator as any).connection;
			return conn?.type === 'wifi' || conn?.effectiveType === '4g';
		}
		return false;
	}

	const autoplay = $derived(shouldAutoplay());
	const muted = $derived(videoPlayback !== 'full-autoplay');

	let playing = $state(false);
	let videoEl: HTMLVideoElement | undefined;

	function togglePlay() {
		if (!videoEl) return;
		if (playing) {
			videoEl.pause();
		} else {
			videoEl.play();
		}
		playing = !playing;
	}
</script>

{#snippet videoHeader()}
	<div class="relative bg-black overflow-hidden">
		<video
			bind:this={videoEl}
			src={videoUrl}
			poster={thumbnailUrl}
			class="w-full max-h-72 object-contain transition-transform duration-300 hover:scale-[1.02]"
			onplay={() => playing = true}
			onpause={() => playing = false}
			onended={() => playing = false}
			controls={playing}
			autoplay={autoplay}
			muted={autoplay && muted}
			playsinline
		/>

		{#if !playing}
			<div
				class="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer"
				onclick={(e) => { e.stopPropagation(); togglePlay(); }}
			>
				<div class="w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center press-scale">
					<Icon icon="ph:play-fill" class="text-2xl text-white ml-0.5" />
				</div>
			</div>
		{/if}

		<div class="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm">
			<span class="text-[11px] font-medium text-white">{formatDurationMs(durationMs)}</span>
		</div>
	</div>
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
	headerContent={videoHeader}
>

	<!-- Caption -->
	{#if caption}
		<p class="text-[13px] text-muted leading-relaxed">{caption}</p>
	{/if}
</Card>
