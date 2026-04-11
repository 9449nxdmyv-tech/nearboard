<!--
  @file QuickCaptureVoiceSheet.svelte
  @description Fullscreen voice recording overlay with three phases:
               1. Ready — tap to start, waveform visualization
               2. Recording — live waveform, timer, tap to stop
               3. Review — playback, discard/save
               Mobile: fullscreen. Desktop: centered panel.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, Button } from 'konsta/svelte';
	import { MAX_VIDEO_DURATION_MS } from '$lib/config/constants';
	import { addContent } from '$lib/firebase';
	import { userStore, showToast } from '$lib/stores';
	import { hapticSuccess, hapticLight, hapticMedium, hapticHeavy } from '$lib/utils/haptics';
	import type { VoiceContentDoc } from '$lib/types';
	import { onDestroy } from 'svelte';

	let {
		boardId,
		onClose
	}: {
		boardId: string;
		onClose: () => void;
	} = $props();

	// ─── Phase management ────────────────────────────────────────────────
	type Phase = 'ready' | 'recording' | 'review';
	let phase = $state<Phase>('ready');

	// ─── Audio state ─────────────────────────────────────────────────────
	let stream = $state<MediaStream | null>(null);
	let recorder = $state<MediaRecorder | null>(null);
	let analyser = $state<AnalyserNode | null>(null);
	let audioCtx = $state<AudioContext | null>(null);

	// ─── Recording data ──────────────────────────────────────────────────
	let audioBlob = $state<Blob | null>(null);
	let audioUrl = $state<string | null>(null);
	let recordingStartTime = $state(0);
	let elapsed = $state(0);
	let elapsedTimer: ReturnType<typeof setInterval> | null = null;
	let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
	let animFrameId: number | null = null;

	// ─── Waveform ────────────────────────────────────────────────────────
	let waveformBars = $state<number[]>(new Array(40).fill(0.05));
	let canvasEl = $state<HTMLCanvasElement | undefined>();

	// ─── Review ──────────────────────────────────────────────────────────
	let reviewAudioEl = $state<HTMLAudioElement | undefined>();
	let playing = $state(false);
	let playbackProgress = $state(0);
	let busy = $state(false);

	const MAX_SECONDS = MAX_VIDEO_DURATION_MS / 1000;
	const progressPct = $derived(Math.min(100, (elapsed / MAX_SECONDS) * 100));
	const timeDisplay = $derived(formatTime(elapsed));

	// ─── Body scroll lock ────────────────────────────────────────────────
	$effect(() => {
		const scrollY = window.scrollY;
		document.body.style.overflow = 'hidden';
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollY}px`;
		document.body.style.width = '100%';
		return () => {
			document.body.style.overflow = '';
			document.body.style.position = '';
			document.body.style.top = '';
			document.body.style.width = '';
			window.scrollTo(0, scrollY);
		};
	});

	// ─── Keyboard ────────────────────────────────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleClose();
		if (e.key === ' ' && phase !== 'review') {
			e.preventDefault();
			if (phase === 'ready') startRecording();
			else if (phase === 'recording') stopRecording();
		}
	}

	onDestroy(cleanup);

	function cleanup() {
		clearTimers();
		if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		if (stream) stream.getTracks().forEach((t) => t.stop());
		if (audioCtx) audioCtx.close();
		if (audioUrl) URL.revokeObjectURL(audioUrl);
		stream = null;
		recorder = null;
		analyser = null;
		audioCtx = null;
	}

	function clearTimers() {
		if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
		if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
	}

	function formatTime(s: number): string {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	// ─── Recording ───────────────────────────────────────────────────────
	async function startRecording() {
		try {
			const s = await navigator.mediaDevices.getUserMedia({ audio: true });
			stream = s;

			// Set up Web Audio analyser for waveform
			const ctx = new AudioContext();
			audioCtx = ctx;
			const source = ctx.createMediaStreamSource(s);
			const an = ctx.createAnalyser();
			an.fftSize = 128;
			source.connect(an);
			analyser = an;

			// Start MediaRecorder
			const chunks: Blob[] = [];
			const mr = new MediaRecorder(s, { mimeType: 'audio/webm' });
			mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
			mr.onstop = () => {
				s.getTracks().forEach((t) => t.stop());
				audioBlob = new Blob(chunks, { type: 'audio/webm' });
				audioUrl = URL.createObjectURL(audioBlob);
				phase = 'review';
			};
			mr.start();
			recorder = mr;
			recordingStartTime = Date.now();
			elapsed = 0;
			phase = 'recording';
			hapticHeavy();

			elapsedTimer = setInterval(() => {
				elapsed = (Date.now() - recordingStartTime) / 1000;
			}, 100);

			autoStopTimer = setTimeout(() => {
				if (phase === 'recording') stopRecording();
			}, MAX_VIDEO_DURATION_MS);

			// Animate waveform
			drawWaveform();
		} catch (err) {
			console.error('Microphone access failed:', err);
			showToast('Could not access microphone');
		}
	}

	function drawWaveform() {
		if (!analyser) return;
		const data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(data);

		// Map to 40 bars, normalized 0–1
		const barCount = 40;
		const step = Math.floor(data.length / barCount);
		const bars: number[] = [];
		for (let i = 0; i < barCount; i++) {
			let sum = 0;
			for (let j = 0; j < step; j++) {
				sum += data[i * step + j] / 255;
			}
			bars.push(Math.max(0.08, sum / step));
		}
		waveformBars = bars;

		if (phase === 'recording') {
			animFrameId = requestAnimationFrame(drawWaveform);
		}
	}

	function stopRecording() {
		clearTimers();
		if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		recorder = null;
		if (audioCtx) { audioCtx.close(); audioCtx = null; }
		analyser = null;
		hapticMedium();
	}

	// ─── Review controls ─────────────────────────────────────────────────
	function togglePlayback() {
		if (!reviewAudioEl) return;
		if (playing) {
			reviewAudioEl.pause();
			playing = false;
		} else {
			reviewAudioEl.play();
			playing = true;
		}
	}

	function handleTimeUpdate() {
		if (!reviewAudioEl) return;
		playbackProgress = reviewAudioEl.duration ? (reviewAudioEl.currentTime / reviewAudioEl.duration) * 100 : 0;
	}

	function handlePlayEnded() {
		playing = false;
		playbackProgress = 0;
	}

	// ─── Discard / Retake ────────────────────────────────────────────────
	function discard() {
		if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
		audioBlob = null;
		elapsed = 0;
		playing = false;
		playbackProgress = 0;
		waveformBars = new Array(40).fill(0.05);
		phase = 'ready';
	}

	// ─── Submit ──────────────────────────────────────────────────────────
	async function submitVoice() {
		const user = $userStore.user;
		if (!user || !audioBlob) return;
		busy = true;
		try {
			const { uploadVoiceNote } = await import('$lib/firebase/storageService');
			const uploadedUrl = await uploadVoiceNote(boardId, user.uid, audioBlob);
			const durationMs = Math.round(elapsed * 1000);
			await addContent(boardId, {
				type: 'voice',
				audioUrl: uploadedUrl,
				durationMs,
				boardId,
				authorId: user.uid,
				authorName: user.displayName || user.email,
				authorPhotoURL: user.photoURL
			} as Omit<VoiceContentDoc, 'id' | 'createdAt'>);
			hapticSuccess();
			showToast('Voice note saved!');
			onClose();
		} catch (err) {
			console.error('Failed to save voice note:', err);
			showToast('Failed to save voice note');
		} finally {
			busy = false;
		}
	}

	function handleClose() {
		if (phase === 'recording') stopRecording();
		cleanup();
		onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) handleClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-[60] flex items-stretch sm:items-center sm:justify-center"
	onclick={handleBackdropClick}
	transition:fade={{ duration: 200 }}
>
	<div class="fixed inset-0 bg-black sm:bg-black/60 sm:backdrop-blur-md" aria-hidden="true"></div>

	<div
		class="relative z-10 w-full h-full sm:h-auto sm:max-w-xl sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-white/10
			bg-surface flex flex-col overflow-hidden"
		in:fly={{ y: 40, duration: 300, easing: quintOut }}
	>
		<!-- Header -->
		{#snippet navLeft()}
			{#if phase === 'review'}
				<Link onClick={discard}>
					<Icon icon="ph:arrow-counter-clockwise-bold" class="w-4 h-4 mr-1" />
					Retake
				</Link>
			{:else}
				<NavbarBackLink onClick={handleClose} text="Close" />
			{/if}
		{/snippet}
		<Navbar title="Voice Note" left={navLeft} />

		<!-- Content -->
		<div class="flex-1 flex flex-col items-center justify-center px-6 sm:px-8 py-8 sm:py-10 gap-6">

			{#if phase === 'ready'}
				<!-- ═══ Ready state ═══ -->
				<div class="flex flex-col items-center gap-6" in:fade={{ duration: 200 }}>
					<!-- Idle waveform visualization -->
					<div class="flex items-center justify-center gap-[3px] h-16">
						{#each waveformBars as _, i}
							<div
								class="w-[3px] rounded-full bg-primary/20 transition-all duration-500"
								style="height: {8 + Math.sin(i * 0.4) * 6}px"
							></div>
						{/each}
					</div>

					<!-- Record button -->
					<button
						onclick={startRecording}
						class="relative w-20 h-20 rounded-full flex items-center justify-center
							active:scale-95 transition-transform group"
						aria-label="Start recording"
					>
						<div class="absolute inset-0 rounded-full border-[4px] border-type-voice/30 group-hover:border-type-voice/50 transition-colors"></div>
						<div class="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-lg
							group-hover:scale-105 transition-transform">
							<Icon icon="ph:microphone" class="text-2xl text-white" />
						</div>
					</button>

					<div class="text-center">
						<p class="text-[15px] font-semibold text-primary">Tap to record</p>
						<p class="text-[13px] text-muted mt-1">
							Up to {MAX_SECONDS} seconds
							<span class="hidden sm:inline">&middot; or press Space</span>
						</p>
					</div>
				</div>

			{:else if phase === 'recording'}
				<!-- ═══ Recording state ═══ -->
				<div class="flex flex-col items-center gap-6 w-full" in:fade={{ duration: 200 }}>
					<!-- Timer -->
					<div class="flex items-center gap-2.5">
						<div class="relative flex h-3 w-3">
							<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-recording-indicator-pulse opacity-75"></span>
							<span class="relative inline-flex rounded-full h-3 w-3 bg-recording-indicator-dot"></span>
						</div>
						<span class="text-2xl font-bold text-primary tabular-nums">{timeDisplay}</span>
					</div>

					<!-- Live waveform -->
					<div class="flex items-center justify-center gap-[3px] h-20 w-full max-w-xs">
						{#each waveformBars as bar, i}
							<div
								class="w-[3px] rounded-full bg-primary transition-all duration-75"
								style="height: {Math.max(4, bar * 80)}px"
							></div>
						{/each}
					</div>

					<!-- Progress bar -->
					<div class="w-full max-w-xs">
						<div class="h-1 bg-border/30 rounded-full overflow-hidden">
							<div class="h-full bg-recording-indicator-dot rounded-full transition-all duration-100 ease-linear"
								style="width: {progressPct}%"></div>
						</div>
						<p class="text-[11px] text-muted text-center mt-1.5">{MAX_SECONDS - Math.floor(elapsed)}s remaining</p>
					</div>

					<!-- Stop button -->
					<button
						onclick={stopRecording}
						class="relative w-20 h-20 rounded-full flex items-center justify-center
							active:scale-95 transition-transform"
						aria-label="Stop recording"
					>
						<div class="absolute inset-0 rounded-full border-[4px] border-recording-indicator-border transition-colors"></div>
						<div class="w-7 h-7 rounded-[6px] bg-recording-indicator-dot transition-all duration-200"></div>
					</button>

					<p class="text-[13px] text-muted font-medium">Tap to stop</p>
				</div>

			{:else if phase === 'review'}
				<!-- ═══ Review state ═══ -->
				<div class="flex flex-col items-center gap-6 w-full" in:fly={{ y: 20, duration: 250, easing: quintOut }}>
					<!-- Playback visualization -->
					<div class="relative w-full max-w-sm">
						<!-- Static waveform bars (frozen from recording) -->
						<div class="flex items-center justify-center gap-[3px] h-20">
							{#each waveformBars as bar, i}
								{@const barPct = (i / waveformBars.length) * 100}
								<div
									class="w-[3px] rounded-full transition-colors duration-100
										{barPct <= playbackProgress ? 'bg-primary' : 'bg-primary/20'}"
									style="height: {Math.max(4, bar * 80)}px"
								></div>
							{/each}
						</div>

						<!-- Duration label -->
						<div class="flex items-center justify-between mt-2">
							<span class="text-[11px] text-muted tabular-nums">
								{playing && reviewAudioEl ? formatTime(reviewAudioEl.currentTime) : '0:00'}
							</span>
							<span class="text-[11px] text-muted font-semibold tabular-nums">{formatTime(elapsed)}</span>
						</div>
					</div>

					<!-- Play / Pause button -->
					<button
						onclick={togglePlayback}
						class="w-16 h-16 rounded-full bg-primary flex items-center justify-center shadow-lg
							active:scale-95 hover:scale-105 transition-transform"
						aria-label={playing ? 'Pause' : 'Play'}
					>
						<Icon icon={playing ? 'ph:pause-fill' : 'ph:play-fill'} class="text-2xl text-white {playing ? '' : 'ml-0.5'}" />
					</button>

					<!-- Hidden audio element -->
					<audio
						bind:this={reviewAudioEl}
						src={audioUrl}
						ontimeupdate={handleTimeUpdate}
						onended={handlePlayEnded}
					></audio>

				</div>
			{/if}
		</div>

		<!-- Save footer (review phase only) -->
		{#if phase === 'review'}
			<div class="p-4 pb-safe border-t border-border-light">
				<Button large rounded onClick={submitVoice} disabled={busy}>
					{#if busy}
						<Icon icon="ph:circle-notch-bold" class="text-lg animate-spin mr-2" />
						Saving...
					{:else}
						Save Voice Note
					{/if}
				</Button>
			</div>
		{/if}
	</div>
</div>

<style>
	.pb-safe {
		padding-bottom: max(env(safe-area-inset-bottom, 0px), 1rem);
	}
</style>

