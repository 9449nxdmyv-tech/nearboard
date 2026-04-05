<!--
  @file QuickCaptureVideoSheet.svelte
  @description Fullscreen video capture overlay with three phases:
               1. Mode select — record or upload
               2. Camera viewfinder — fullscreen (mobile) / centered panel (desktop)
               3. Review — playback, caption, save
               Mobile: truly fullscreen. Desktop: centered dialog with backdrop.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { Navbar, NavbarBackLink, Link, Button, List, ListInput } from 'konsta/svelte';
	import { MAX_VIDEO_DURATION_MS } from '$lib/config/constants';
	import { userStore, showToast, queueVideoUpload } from '$lib/stores';
	import { hapticLight, hapticMedium, hapticHeavy } from '$lib/utils/haptics';
	import { onDestroy } from 'svelte';

	let {
		boardId,
		onClose
	}: {
		boardId: string;
		onClose: () => void;
	} = $props();

	// ─── Phase management ────────────────────────────────────────────────
	type Phase = 'select' | 'viewfinder' | 'review';
	let phase = $state<Phase>('select');

	// ─── Camera state ────────────────────────────────────────────────────
	let stream = $state<MediaStream | null>(null);
	let recorder = $state<MediaRecorder | null>(null);
	let recording = $state(false);
	let previewEl = $state<HTMLVideoElement | undefined>();
	let reviewEl = $state<HTMLVideoElement | undefined>();
	let facingMode = $state<'environment' | 'user'>('environment');
	let dragOver = $state(false);

	// ─── Recording data ──────────────────────────────────────────────────
	let videoFile = $state<Blob | null>(null);
	let videoPreviewUrl = $state<string | null>(null);
	let recordingStartTime = $state(0);
	let elapsed = $state(0);
	let elapsedTimer: ReturnType<typeof setInterval> | null = null;
	let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

	// ─── Review/submit state ─────────────────────────────────────────────
	let caption = $state('');
	let busy = $state(false);
	let uploadProgress = $state(0);

	const MAX_SECONDS = MAX_VIDEO_DURATION_MS / 1000;
	const progressPct = $derived(Math.min(100, (elapsed / MAX_SECONDS) * 100));
	const timeDisplay = $derived(formatTime(elapsed));
	const timeRemaining = $derived(formatTime(MAX_SECONDS - elapsed));

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

	// ─── Keyboard shortcut ───────────────────────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (recording) stopRecording();
			else handleClose();
		}
		// Space to start/stop recording in viewfinder
		if (e.key === ' ' && phase === 'viewfinder') {
			e.preventDefault();
			if (recording) stopRecording();
			else startRecording();
		}
	}

	onDestroy(cleanup);

	function cleanup() {
		clearTimers();
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		if (stream) stream.getTracks().forEach((t) => t.stop());
		if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
		stream = null;
		recorder = null;
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

	// ─── Camera lifecycle ────────────────────────────────────────────────
	async function openCamera() {
		phase = 'viewfinder';
		try {
			const s = await navigator.mediaDevices.getUserMedia({
				video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
				audio: true
			});
			stream = s;
			await tick();
			if (previewEl) {
				previewEl.srcObject = s;
				previewEl.play();
			}
		} catch (err) {
			console.error('Camera access failed:', err);
			showToast('Could not access camera');
			phase = 'select';
		}
	}

	async function tick() {
		return new Promise((r) => setTimeout(r, 50));
	}

	async function flipCamera() {
		if (recording) return;
		facingMode = facingMode === 'environment' ? 'user' : 'environment';
		if (stream) {
			stream.getTracks().forEach((t) => t.stop());
			stream = null;
		}
		try {
			const s = await navigator.mediaDevices.getUserMedia({
				video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
				audio: true
			});
			stream = s;
			if (previewEl) {
				previewEl.srcObject = s;
				previewEl.play();
			}
			hapticLight();
		} catch {
			showToast('Could not switch camera');
		}
	}

	// ─── Recording controls ──────────────────────────────────────────────
	function startRecording() {
		if (!stream) return;
		hapticHeavy();
		const chunks: Blob[] = [];
		const mr = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 2_500_000 });
		mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
		mr.onstop = () => {
			videoFile = new Blob(chunks, { type: 'video/webm' });
			videoPreviewUrl = URL.createObjectURL(videoFile);
			if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
			phase = 'review';
		};
		mr.start();
		recorder = mr;
		recording = true;
		recordingStartTime = Date.now();
		elapsed = 0;

		elapsedTimer = setInterval(() => {
			elapsed = (Date.now() - recordingStartTime) / 1000;
		}, 100);

		autoStopTimer = setTimeout(() => {
			if (recording) stopRecording();
		}, MAX_VIDEO_DURATION_MS);
	}

	function stopRecording() {
		clearTimers();
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		recording = false;
		recorder = null;
		hapticMedium();
	}

	// ─── File upload / drag-drop ─────────────────────────────────────────
	function processFile(file: File) {
		if (file.size > 50 * 1024 * 1024) {
			showToast('Video must be under 50MB');
			return;
		}
		if (!file.type.startsWith('video/')) {
			showToast('Please select a video file');
			return;
		}

		videoFile = file;
		videoPreviewUrl = URL.createObjectURL(file);

		const vid = document.createElement('video');
		vid.preload = 'metadata';
		vid.src = videoPreviewUrl;
		vid.onloadedmetadata = () => {
			if (vid.duration > 60) {
				showToast('Video must be 60 seconds or less');
				videoFile = null;
				if (videoPreviewUrl) { URL.revokeObjectURL(videoPreviewUrl); videoPreviewUrl = null; }
				return;
			}
			elapsed = vid.duration;
			phase = 'review';
		};
		vid.onerror = () => {
			showToast('Could not read video file');
			videoFile = null;
			if (videoPreviewUrl) { URL.revokeObjectURL(videoPreviewUrl); videoPreviewUrl = null; }
		};
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) processFile(file);
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) processFile(file);
	}

	// ─── Retake ──────────────────────────────────────────────────────────
	function retake() {
		if (videoPreviewUrl) { URL.revokeObjectURL(videoPreviewUrl); videoPreviewUrl = null; }
		videoFile = null;
		caption = '';
		elapsed = 0;
		phase = 'select';
	}

	/** Capture a poster frame from the video blob for use as thumbnail */
	async function generateThumbnail(blob: Blob): Promise<Blob | null> {
		return new Promise((resolve) => {
			const vid = document.createElement('video');
			vid.muted = true;
			vid.playsInline = true;
			vid.preload = 'auto';
			vid.src = URL.createObjectURL(blob);

			vid.onloadeddata = () => {
				// Seek to 0.5s for a more interesting frame than pure black
				vid.currentTime = Math.min(0.5, vid.duration / 2);
			};

			vid.onseeked = () => {
				try {
					const canvas = document.createElement('canvas');
					canvas.width = vid.videoWidth;
					canvas.height = vid.videoHeight;
					canvas.getContext('2d')!.drawImage(vid, 0, 0);
					canvas.toBlob((b) => {
						URL.revokeObjectURL(vid.src);
						resolve(b);
					}, 'image/jpeg', 0.7);
				} catch {
					URL.revokeObjectURL(vid.src);
					resolve(null);
				}
			};

			vid.onerror = () => {
				URL.revokeObjectURL(vid.src);
				resolve(null);
			};

			// Timeout fallback
			setTimeout(() => { URL.revokeObjectURL(vid.src); resolve(null); }, 5000);
		});
	}

	// ─── Submit ──────────────────────────────────────────────────────────
	async function submitVideo() {
		const user = $userStore.user;
		if (!user || !videoFile) return;
		busy = true;

		try {
			// Generate thumbnail before closing — fast, local operation
			const thumbBlob = await generateThumbnail(videoFile);
			const durationMs = Math.min(Math.round(elapsed * 1000) || MAX_VIDEO_DURATION_MS, MAX_VIDEO_DURATION_MS);

			// Hand off to background queue
			queueVideoUpload({
				boardId,
				userId: user.uid,
				userName: user.displayName || user.email || '',
				userPhoto: user.photoURL,
				videoFile,
				durationMs,
				caption: caption.trim(),
				thumbnailBlob: thumbBlob
			});

			// Clear local refs so cleanup doesn't revoke what the upload needs
			videoFile = null;
			videoPreviewUrl = null;
			onClose();
		} catch {
			showToast('Failed to prepare video');
			busy = false;
		}
	}

	function handleClose() {
		if (recording) stopRecording();
		cleanup();
		onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) handleClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Fullscreen overlay -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-[60] flex items-stretch sm:items-center sm:justify-center"
	onclick={phase !== 'viewfinder' ? handleBackdropClick : undefined}
	transition:fade={{ duration: 200 }}
>
	<!-- Backdrop — visible on desktop, black on mobile -->
	<div class="fixed inset-0 bg-black sm:bg-black/60 sm:backdrop-blur-md" aria-hidden="true"></div>

	{#if phase === 'select'}
		<!-- ═══ Phase 1: Mode select ═══ -->
		<div
			class="relative z-10 w-full h-full sm:h-auto sm:max-w-xl sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-white/10
				bg-surface flex flex-col overflow-hidden"
			in:fly={{ y: 40, duration: 300, easing: quintOut }}
		>
			{#snippet videoNavLeft()}
				<NavbarBackLink onClick={handleClose} text="Close" />
			{/snippet}
			<Navbar title="Short Video" left={videoNavLeft} />

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="flex-1 flex flex-col items-center justify-center px-6 sm:px-8 py-8 sm:py-10 gap-6"
				ondragover={(e) => { e.preventDefault(); dragOver = true; }}
				ondragleave={() => { dragOver = false; }}
				ondrop={handleDrop}
			>
				<!-- Stacked icon buttons -->
				<div class="flex items-center gap-8 sm:gap-10">
					<!-- Record -->
					<button onclick={openCamera}
						class="flex flex-col items-center gap-3 group active:scale-95 transition-transform">
						<div class="w-20 h-20 rounded-full bg-type-video/10 flex items-center justify-center
							group-hover:bg-type-video/15 transition-colors">
							<Icon icon="ph:video-camera-fill" class="text-3xl text-type-video" />
						</div>
						<div class="text-center">
							<p class="text-[14px] font-semibold text-on-surface">Record</p>
							<p class="text-[11px] text-muted">Up to {MAX_SECONDS}s</p>
						</div>
					</button>

					<!-- Divider -->
					<div class="h-16 w-px bg-border-light"></div>

					<!-- Upload -->
					<label class="flex flex-col items-center gap-3 group active:scale-95 transition-transform cursor-pointer
						{dragOver ? 'scale-105' : ''}">
						<div class="w-20 h-20 rounded-full bg-type-video/10 flex items-center justify-center
							group-hover:bg-type-video/15 transition-colors {dragOver ? '!bg-type-video/20' : ''}">
							<Icon icon={dragOver ? 'ph:arrow-down-bold' : 'ph:upload-simple-fill'} class="text-3xl text-type-video" />
						</div>
						<div class="text-center">
							<p class="text-[14px] font-semibold text-on-surface">Upload</p>
							<p class="text-[11px] text-muted">Max 60s, 50MB</p>
						</div>
						<input type="file" accept="video/*" onchange={handleFileSelect} class="hidden" />
					</label>
				</div>

				<!-- Drag hint on desktop -->
				<p class="hidden sm:block text-[12px] text-muted/50">
					Drag &amp; drop a video file, or press
					<kbd class="px-1.5 py-0.5 bg-card border border-border/60 rounded text-[10px] font-mono">Esc</kbd> to cancel
				</p>
			</div>
		</div>

	{:else if phase === 'viewfinder'}
		<!-- ═══ Phase 2: Camera viewfinder ═══ -->
		<!-- Mobile: fullscreen. Desktop: centered 16:9 panel -->
		<div
			class="relative z-10 w-full h-full sm:h-auto sm:w-full sm:max-w-3xl sm:aspect-video sm:rounded-2xl sm:overflow-hidden sm:shadow-2xl sm:ring-1 sm:ring-white/10 flex flex-col"
			in:fade={{ duration: 200 }}
		>
			<!-- Camera preview -->
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={previewEl}
				muted
				playsinline
				class="absolute inset-0 w-full h-full object-cover {facingMode === 'user' ? 'scale-x-[-1]' : ''}"
			></video>

			<!-- Top gradient -->
			<div class="absolute top-0 inset-x-0 h-28 bg-gradient-to-b from-black/60 to-transparent pointer-events-none z-10"></div>

			<!-- Top controls -->
			<div class="relative z-20 flex items-center justify-between px-5 pt-safe sm:pt-4 pb-2">
				<button onclick={handleClose}
					class="w-10 h-10 rounded-full bg-black/30 backdrop-blur-xl flex items-center justify-center text-white hover:bg-black/50 transition-all">
					<Icon icon="ph:x-bold" class="text-lg" />
				</button>

				<!-- Timer display — always visible, shows 0:00 before recording -->
				<div class="flex items-center gap-2 bg-black/30 backdrop-blur-xl rounded-full px-4 py-2">
					{#if recording}
						<div class="relative flex h-2.5 w-2.5">
							<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
							<span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
						</div>
					{:else}
						<div class="h-2.5 w-2.5 rounded-full bg-white/30"></div>
					{/if}
					<span class="text-white text-sm font-bold tabular-nums">{timeDisplay}</span>
					<span class="text-white/40 text-xs">/ {MAX_SECONDS}s</span>
				</div>

				<button onclick={flipCamera} disabled={recording}
					class="w-10 h-10 rounded-full bg-black/30 backdrop-blur-xl flex items-center justify-center text-white
						hover:bg-black/50 disabled:opacity-30 transition-all">
					<Icon icon="ph:camera-rotate-bold" class="text-lg" />
				</button>
			</div>

			<!-- Bottom gradient -->
			<div class="absolute bottom-0 inset-x-0 h-44 sm:h-36 bg-gradient-to-t from-black/70 to-transparent pointer-events-none z-10"></div>

			<!-- Bottom controls -->
			<div class="relative z-20 mt-auto flex flex-col items-center gap-3 pb-safe sm:pb-6 px-6 pb-8">
				<!-- Progress bar -->
				<div class="w-full max-w-xs sm:max-w-sm">
					<div class="h-1 bg-white/15 rounded-full overflow-hidden">
						<div class="h-full bg-red-500 rounded-full transition-all duration-100 ease-linear"
							style="width: {progressPct}%"></div>
					</div>
				</div>

				<!-- Record / Stop button -->
				<button
					onclick={recording ? stopRecording : startRecording}
					class="relative w-20 h-20 sm:w-[72px] sm:h-[72px] rounded-full flex items-center justify-center
						active:scale-95 transition-transform"
					aria-label={recording ? 'Stop recording' : 'Start recording'}
				>
					<div class="absolute inset-0 rounded-full border-[4px] {recording ? 'border-red-500' : 'border-white'} transition-colors"></div>
					<div class="{recording
						? 'w-7 h-7 sm:w-6 sm:h-6 rounded-[6px] bg-red-500'
						: 'w-[60px] h-[60px] sm:w-[54px] sm:h-[54px] rounded-full bg-red-500'} transition-all duration-200"></div>
				</button>

				{#if !recording}
					<p class="text-white/60 text-[13px] font-medium">
						Tap to record
						<span class="hidden sm:inline">&middot; or press Space</span>
					</p>
				{:else}
					<p class="text-white/60 text-[13px] font-medium">{timeRemaining} remaining</p>
				{/if}
			</div>
		</div>

	{:else if phase === 'review'}
		<!-- ═══ Phase 3: Review & submit ═══ -->
		<!-- Mobile: fullscreen. Desktop: centered panel with side-by-side layout -->
		<div
			class="relative z-10 w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[85vh] sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-black/10
				bg-surface flex flex-col sm:flex-row overflow-hidden"
			in:fly={{ y: 40, duration: 300, easing: quintOut }}
		>
			<!-- Video preview — left side on desktop -->
			<div class="flex-1 min-h-0 sm:min-w-0 relative bg-black flex items-center justify-center">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					bind:this={reviewEl}
					src={videoPreviewUrl}
					controls
					playsinline
					class="w-full h-full sm:h-auto sm:max-h-[85vh] object-contain"
				></video>
				<!-- Duration badge -->
				<div class="absolute top-3 right-3 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full text-[11px] text-white font-bold tabular-nums">
					{formatTime(elapsed)}
				</div>
			</div>

			<!-- Controls — right side on desktop, bottom on mobile -->
			<div class="sm:w-[300px] md:w-[340px] shrink-0 flex flex-col border-t sm:border-t-0 sm:border-l border-border/30 bg-surface">
				{#snippet reviewLeft()}
					<Link onClick={retake}>
						<Icon icon="ph:arrow-counter-clockwise" class="w-5 h-5 mr-1" />
						Retake
					</Link>
				{/snippet}
				{#snippet reviewRight()}
					<Link onClick={handleClose}>
						<Icon icon="ph:x" class="w-5 h-5" />
					</Link>
				{/snippet}
				<Navbar title="Review" left={reviewLeft} right={reviewRight} />

				<div class="flex-1 flex flex-col">
					<!-- Duration info -->
					<div class="px-5 pt-4 pb-2">
						<p class="text-[13px] text-muted">
							Duration: <span class="font-semibold text-on-surface tabular-nums">{formatTime(elapsed)}</span>
						</p>
					</div>

					<!-- Caption -->
					<List inset strong outline>
						<ListInput
							outline
							label="Caption"
							type="text"
							placeholder="Add a caption..."
							value={caption}
							onInput={(e) => { caption = e.target.value; }}
							clearButton={caption.length > 0}
							onClear={() => { caption = ''; }}
						/>
					</List>

					<!-- Spacer to push footer down -->
					<div class="flex-1"></div>

					<!-- Upload progress -->
					{#if busy && uploadProgress > 0 && uploadProgress < 100}
						<div class="px-5 pb-2">
							<div class="flex items-center justify-between mb-1.5">
								<span class="text-[11px] text-muted font-medium">Uploading...</span>
								<span class="text-[11px] text-primary font-bold tabular-nums">{Math.round(uploadProgress)}%</span>
							</div>
							<div class="w-full h-1.5 bg-border/30 rounded-full overflow-hidden">
								<div class="h-full bg-primary rounded-full transition-all duration-300"
									style="width: {uploadProgress}%"></div>
							</div>
						</div>
					{/if}

					<!-- Save footer -->
					<div class="p-4 pb-safe border-t border-border-light">
						<Button large rounded onClick={submitVideo} disabled={busy}>
							{#if busy}
								<Icon icon="ph:circle-notch-bold" class="text-lg animate-spin mr-2" />
								Uploading{uploadProgress > 0 ? ` ${Math.round(uploadProgress)}%` : '...'}
							{:else}
								Save Video
							{/if}
						</Button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.pt-safe {
		padding-top: max(env(safe-area-inset-top, 0px), 1rem);
	}
	.pb-safe {
		padding-bottom: max(env(safe-area-inset-bottom, 0px), 1rem);
	}
</style>
