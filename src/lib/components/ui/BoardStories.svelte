<!--
  @file BoardStories.svelte
  @description Instagram-style stories row showing recent videos from each board.
               Tapping a board circle opens a fullscreen story viewer with auto-advance.
               Only renders if at least one board has videos from the past week.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { getRecentVideos } from '$lib/firebase';
	import type { BoardDoc, ContentDoc, VideoContentDoc } from '$lib/types';

	let { boards }: { boards: BoardDoc[] } = $props();

	interface BoardStory {
		board: BoardDoc;
		videos: VideoContentDoc[];
	}

	let stories = $state<BoardStory[]>([]);
	let loading = $state(true);

	// ── Viewer state ──
	let viewerOpen = $state(false);
	let activeStoryIdx = $state(0);
	let activeVideoIdx = $state(0);
	let videoEl = $state<HTMLVideoElement | undefined>();
	let progressTimer: ReturnType<typeof setInterval> | null = null;
	let progress = $state(0);
	let paused = $state(false);

	const activeStory = $derived(stories[activeStoryIdx] ?? null);
	const activeVideo = $derived(activeStory?.videos[activeVideoIdx] ?? null);
	const totalVideosInStory = $derived(activeStory?.videos.length ?? 0);

	onMount(async () => {
		const weekAgo = new Date();
		weekAgo.setDate(weekAgo.getDate() - 7);

		const results = await Promise.all(
			boards.map(async (board) => {
				try {
					const videos = await getRecentVideos(board.id, weekAgo, 10);
					if (videos.length === 0) return null;
					return { board, videos: videos as VideoContentDoc[] };
				} catch {
					return null;
				}
			})
		);

		stories = results.filter((r): r is BoardStory => r !== null);
		loading = false;
	});

	function openStory(idx: number) {
		activeStoryIdx = idx;
		activeVideoIdx = 0;
		progress = 0;
		viewerOpen = true;
	}

	function closeViewer() {
		viewerOpen = false;
		stopProgress();
	}

	function startProgress(durationMs: number) {
		stopProgress();
		const interval = 50;
		const step = (interval / durationMs) * 100;
		progressTimer = setInterval(() => {
			progress += step;
			if (progress >= 100) {
				nextSegment();
			}
		}, interval);
	}

	function stopProgress() {
		if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
	}

	function nextSegment() {
		stopProgress();
		if (activeVideoIdx < totalVideosInStory - 1) {
			activeVideoIdx++;
			progress = 0;
		} else if (activeStoryIdx < stories.length - 1) {
			activeStoryIdx++;
			activeVideoIdx = 0;
			progress = 0;
		} else {
			closeViewer();
		}
	}

	function prevSegment() {
		stopProgress();
		if (activeVideoIdx > 0) {
			activeVideoIdx--;
			progress = 0;
		} else if (activeStoryIdx > 0) {
			activeStoryIdx--;
			activeVideoIdx = 0;
			progress = 0;
		}
	}

	function handleVideoPlay() {
		if (videoEl) {
			const dur = (videoEl.duration || 15) * 1000;
			startProgress(dur);
		}
	}

	function handleVideoEnded() {
		nextSegment();
	}

	function handleTap(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX - rect.left;
		if (x < rect.width / 3) {
			prevSegment();
		} else if (x > (rect.width * 2) / 3) {
			nextSegment();
		} else {
			// Center tap: pause/resume
			if (videoEl) {
				if (videoEl.paused) { videoEl.play(); startProgress((videoEl.duration - videoEl.currentTime) * 1000); paused = false; }
				else { videoEl.pause(); stopProgress(); paused = true; }
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!viewerOpen) return;
		if (e.key === 'Escape') closeViewer();
		else if (e.key === 'ArrowRight') nextSegment();
		else if (e.key === 'ArrowLeft') prevSegment();
	}

	// Reset video when active video changes
	$effect(() => {
		if (viewerOpen && activeVideo) {
			progress = 0;
			paused = false;
			// Wait for DOM update
			setTimeout(() => {
				if (videoEl) {
					videoEl.currentTime = 0;
					videoEl.play().catch(() => {});
				}
			}, 50);
		}
	});

	// Cleanup on close
	$effect(() => {
		if (!viewerOpen) stopProgress();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if !loading && stories.length > 0}
	<div class="flex gap-3 overflow-x-auto scrollbar-hide py-2 px-1" transition:fade={{ duration: 200 }}>
		{#each stories as story, i (story.board.id)}
			<button
				onclick={() => openStory(i)}
				class="flex flex-col items-center gap-1.5 shrink-0 press-scale"
			>
				<!-- Ring + thumbnail -->
				<div class="relative w-16 h-16 rounded-full p-[2.5px] bg-gradient-to-br from-accent via-primary to-error">
					<div class="w-full h-full rounded-full overflow-hidden bg-surface ring-2 ring-surface">
						{#if story.videos[0]?.thumbnailUrl}
							<img
								src={story.videos[0].thumbnailUrl}
								alt=""
								class="w-full h-full object-cover"
								loading="lazy"
							/>
						{:else}
							<div class="w-full h-full bg-surface-1 flex items-center justify-center">
								<Icon icon="ph:video-camera" class="text-xl text-muted/40" />
							</div>
						{/if}
					</div>
					<!-- Video count badge -->
					{#if story.videos.length > 1}
						<div class="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-accent text-white
							flex items-center justify-center text-[9px] font-bold ring-2 ring-surface">
							{story.videos.length}
						</div>
					{/if}
				</div>
				<span class="text-[11px] text-on-surface font-medium truncate w-16 text-center">{story.board.name}</span>
			</button>
		{/each}
	</div>
{/if}

<!-- Fullscreen story viewer -->
{#if viewerOpen && activeStory && activeVideo}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[70] bg-black flex flex-col"
		transition:fade={{ duration: 200 }}
		onclick={handleTap}
	>
		<!-- Progress bars -->
		<div class="absolute top-0 left-0 right-0 z-20 flex gap-1 px-3 pt-safe">
			{#each activeStory.videos as _, i}
				<div class="flex-1 h-[3px] rounded-full bg-white/25 overflow-hidden">
					<div
						class="h-full bg-white rounded-full transition-[width] duration-75 ease-linear"
						style="width: {i < activeVideoIdx ? 100 : i === activeVideoIdx ? progress : 0}%"
					></div>
				</div>
			{/each}
		</div>

		<!-- Header -->
		<div class="absolute top-0 left-0 right-0 z-20 pt-safe">
			<div class="flex items-center gap-3 px-4 pt-4 pb-2">
				<div class="w-8 h-8 rounded-full overflow-hidden bg-white/10 shrink-0">
					{#if activeVideo.thumbnailUrl}
						<img src={activeVideo.thumbnailUrl} alt="" class="w-full h-full object-cover" />
					{/if}
				</div>
				<div class="flex-1 min-w-0">
					<p class="text-[13px] font-semibold text-white truncate">{activeStory.board.name}</p>
					<p class="text-[11px] text-white/50">
						{#if activeVideo.authorName}{activeVideo.authorName} · {/if}
						{#if activeVideo.caption}{activeVideo.caption}{:else}Video{/if}
					</p>
				</div>
				<button
					onclick={(e) => { e.stopPropagation(); closeViewer(); }}
					class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white
						active:bg-white/20 transition-colors"
					aria-label="Close"
				>
					<Icon icon="ph:x-bold" class="text-sm" />
				</button>
			</div>
		</div>

		<!-- Video -->
		<div class="flex-1 flex items-center justify-center">
			<!-- svelte-ignore a11y_media_has_caption -->
			{#key `${activeStoryIdx}-${activeVideoIdx}`}
				<video
					bind:this={videoEl}
					src={activeVideo.videoUrl}
					class="w-full h-full object-contain"
					playsinline
					muted={false}
					onplay={handleVideoPlay}
					onended={handleVideoEnded}
					in:fade={{ duration: 150 }}
				></video>
			{/key}
		</div>

		<!-- Pause indicator -->
		{#if paused}
			<div class="absolute inset-0 flex items-center justify-center pointer-events-none" transition:fade={{ duration: 100 }}>
				<div class="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
					<Icon icon="ph:pause-fill" class="text-3xl text-white" />
				</div>
			</div>
		{/if}

		<!-- Navigation hint areas (visual) -->
		<div class="absolute top-1/2 left-3 -translate-y-1/2 pointer-events-none opacity-0 group-active:opacity-100">
			<Icon icon="ph:caret-left-bold" class="text-white/30 text-2xl" />
		</div>
		<div class="absolute top-1/2 right-3 -translate-y-1/2 pointer-events-none opacity-0 group-active:opacity-100">
			<Icon icon="ph:caret-right-bold" class="text-white/30 text-2xl" />
		</div>
	</div>
{/if}

<style>
	.pt-safe {
		padding-top: max(env(safe-area-inset-top, 0px), 0.75rem);
	}
</style>
