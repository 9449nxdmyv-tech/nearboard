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
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare, onCommentClick, layout
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
	let currentTime = $state(0);
	let totalDuration = $state(durationMs / 1000);
	const progressPct = $derived(totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0);

	function togglePlay() {
		if (!videoEl) return;
		if (playing) {
			videoEl.pause();
		} else {
			videoEl.play();
		}
		playing = !playing;
	}

	function seekTo(e: MouseEvent) {
		if (!videoEl || !totalDuration) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		videoEl.currentTime = pct * totalDuration;
	}
</script>

{#snippet videoHeader()}
	<div class="relative bg-black overflow-hidden aspect-video">
		<video
			bind:this={videoEl}
			src={videoUrl}
			poster={thumbnailUrl}
			class="w-full h-full object-contain"
			onplay={() => playing = true}
			onpause={() => playing = false}
			onended={() => playing = false}
			ontimeupdate={(e) => { currentTime = (e.currentTarget as HTMLVideoElement).currentTime; }}
			onloadedmetadata={(e) => { totalDuration = (e.currentTarget as HTMLVideoElement).duration || durationMs / 1000; }}
			autoplay={autoplay}
			muted={autoplay && muted}
			playsinline
		></video>

		<!-- Tap area: toggles play/pause anywhere on the video -->
		<button
			type="button"
			onclick={(e) => { e.stopPropagation(); togglePlay(); }}
			aria-label={playing ? 'Pause video' : 'Play video'}
			class="absolute inset-0 flex items-center justify-center transition-opacity
				{playing ? 'opacity-0 hover:opacity-100' : 'bg-black/20'}"
		>
			<div class="w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center press-scale">
				<Icon icon={playing ? 'ph:pause-fill' : 'ph:play-fill'} class="text-2xl text-white {playing ? '' : 'ml-0.5'}" />
			</div>
		</button>

		<!-- Custom scrubber — always visible while playing, tap-to-seek -->
		{#if playing || currentTime > 0}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div
				onclick={(e) => { e.stopPropagation(); seekTo(e); }}
				class="absolute bottom-0 left-0 right-0 h-2 px-2 pb-1.5 group cursor-pointer"
			>
				<div class="relative w-full h-0.5 group-hover:h-1 bg-white/30 rounded-full overflow-hidden transition-all">
					<div
						class="absolute inset-y-0 left-0 bg-white rounded-full"
						style="width: {progressPct}%"
					></div>
				</div>
			</div>
		{/if}

		<!-- Duration / current time pill -->
		<div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm pointer-events-none">
			<span class="text-[11px] font-medium text-white tabular-nums">
				{playing ? formatDurationMs(currentTime * 1000) : formatDurationMs(durationMs)}
			</span>
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
	{layout}
	headerContent={videoHeader}
>

	<!-- Caption -->
	{#if caption}
		<p class="text-[13px] text-muted leading-relaxed">{caption}</p>
	{/if}
</Card>
