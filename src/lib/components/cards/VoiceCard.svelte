<!--
  @file VoiceCard.svelte
  @description Voice note card with full-width waveform visualization and playback.
-->
<script lang="ts">
	import type { VoiceCardProps } from '$lib/types/ui';
	import Card from '$lib/components/ui/Card.svelte';
	import Icon from '@iconify/svelte';

	let {
		id, boardId, audioUrl, durationMs, authorId, authorName, authorPhotoURL, createdAt,
		isBoardOwner, allowComments, expandComments, commentCount, acknowledgments, onDelete, onShare
	}: VoiceCardProps & {
		commentCount?: number;
		expandComments?: boolean;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		onDelete?: () => void;
		onShare?: () => void;
	} = $props();

	let audio = $state<HTMLAudioElement | undefined>();
	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);

	const BAR_COUNT = 48;
	const barHeights = Array.from({ length: BAR_COUNT }, () => 12 + Math.random() * 20);

	$effect(() => {
		duration = durationMs / 1000;
	});

	const progress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function togglePlayback() {
		if (!audio) {
			audio = new Audio(audioUrl);
			audio.addEventListener('timeupdate', () => {
				currentTime = audio!.currentTime;
			});
			audio.addEventListener('ended', () => {
				playing = false;
				currentTime = 0;
			});
		}

		if (playing) {
			audio.pause();
		} else {
			audio.play();
		}
		playing = !playing;
	}

	function seek(e: MouseEvent) {
		if (!audio) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const percent = (e.clientX - rect.left) / rect.width;
		audio.currentTime = percent * duration;
	}
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
	{onShare}
	{onDelete}
>
	<!-- Full-width waveform with overlaid play button -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="relative w-full h-14 bg-surface-1 rounded-xl cursor-pointer flex items-center px-2 overflow-hidden"
		onclick={seek}
	>
		<!-- Progress fill -->
		<div class="absolute inset-0 bg-type-voice/8 origin-left transition-[transform] duration-100"
			style="transform: scaleX({progress / 100})"></div>

		<!-- Bars -->
		<div class="relative flex items-end gap-[2px] flex-1 h-full py-2">
			{#each barHeights as h, i}
				<div
					class="flex-1 min-w-[2px] max-w-[4px] rounded-full transition-colors duration-100
						{i / BAR_COUNT < progress / 100 ? 'bg-type-voice' : 'bg-type-voice/20'}"
					style="height: {h}px"
				></div>
			{/each}
		</div>

		<!-- Centered play/pause overlay -->
		<button
			onclick={(e) => { e.stopPropagation(); togglePlayback(); }}
			class="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-type-voice/15
				flex items-center justify-center press-scale backdrop-blur-sm"
		>
			<Icon icon={playing ? 'ph:pause-fill' : 'ph:play-fill'}
				class="text-base text-type-voice {playing ? '' : 'ml-0.5'}" />
		</button>
	</div>

	<!-- Time row -->
	<div class="flex items-center justify-between mt-1.5 px-0.5">
		<span class="text-[11px] text-muted font-medium tabular-nums">{formatDuration(currentTime)}</span>
		<span class="text-[11px] text-muted font-medium tabular-nums">{formatDuration(duration)}</span>
	</div>
</Card>
