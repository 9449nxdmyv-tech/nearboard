<!--
  @file ImageZoom.svelte
  @description Native-style image zoom/lightbox component. Pinch to zoom,
               double-tap to zoom, swipe to close. iOS Photos app style.
               Optimized for mobile with proper touch handling and performance.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Icon from '@iconify/svelte';
	import { hapticLight, hapticMedium } from '$lib/utils/haptics';
	import { useConditionalScrollLock } from '$lib/utils/scrollLock.svelte';

	let {
		src,
		alt = '',
		caption,
		open,
		onClose,
		shareUrl
	}: {
		src: string;
		alt?: string;
		caption?: string;
		open: boolean;
		onClose: () => void;
		shareUrl?: string;
	} = $props();

	let scale = $state(1);
	let translateX = $state(0);
	let translateY = $state(0);
	let isZoomed = $state(false);
	let isLoading = $state(true);
	let imageError = $state(false);

	// Swipe to close
	let dragStartY = $state(0);
	let dragOffsetY = $state(0);
	let dragging = $state(false);

	// Pinch zoom state
	let initialPinchDistance = 0;
	let initialScale = 1;
	let isPinching = $state(false);

	// Double tap state
	let lastTapTime = 0;
	let tapPosition = { x: 0, y: 0 };

	const maxScale = 3;
	const minScale = 1;
	const CLOSE_THRESHOLD = 100;

	// Body scroll lock
	useConditionalScrollLock(() => open);

	// Reset loading/error state whenever the source image changes so that
	// reopening the viewer on a different image doesn't reuse stale state.
	$effect(() => {
		src; // track
		isLoading = true;
		imageError = false;
		resetZoom();
	});

	// Keyboard escape handling
	$effect(() => {
		if (open) {
			const handleEscape = (e: KeyboardEvent) => {
				if (e.key === 'Escape') handleClose();
			};
			window.addEventListener('keydown', handleEscape);
			return () => window.removeEventListener('keydown', handleEscape);
		}
	});

	function handleClose() {
		if (isZoomed) {
			resetZoom();
		} else {
			onClose();
		}
	}

	function resetZoom() {
		scale = 1;
		translateX = 0;
		translateY = 0;
		isZoomed = false;
	}

	function getDistance(touches: TouchList): number {
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			// Pinch zoom start
			isPinching = true;
			initialPinchDistance = getDistance(e.touches);
			initialScale = scale;
		} else if (e.touches.length === 1) {
			// Single touch - check for double tap or drag
			const touch = e.touches[0];
			const now = Date.now();

			if (now - lastTapTime < 300) {
				// Double tap - zoom in/out
				e.preventDefault();
				hapticMedium();
				if (scale > 1.5) {
					resetZoom();
				} else {
					zoomToPoint(touch.clientX, touch.clientY);
				}
				lastTapTime = 0; // prevent triple-tap cascading
				return;
			} else if (!isZoomed) {
				// Start drag for swipe to close
				dragging = true;
				dragStartY = touch.clientY;
				tapPosition = { x: touch.clientX, y: touch.clientY };
			} else {
				// Zoomed single touch — seed pan origin so first delta isn't stale
				tapPosition = { x: touch.clientX, y: touch.clientY };
			}

			lastTapTime = now;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (e.touches.length === 2 && isPinching) {
			// Pinch zoom
			e.preventDefault();
			const currentDistance = getDistance(e.touches);
			const zoomFactor = currentDistance / initialPinchDistance;
			scale = Math.min(maxScale, Math.max(minScale, initialScale * zoomFactor));
		} else if (e.touches.length === 1 && dragging && !isZoomed) {
			// Swipe to close
			const touch = e.touches[0];
			dragOffsetY = touch.clientY - dragStartY;

			// Only allow downward drag
			if (dragOffsetY < 0) {
				dragOffsetY = 0;
				dragging = false;
			} else if (dragOffsetY > CLOSE_THRESHOLD) {
				hapticLight();
			}
		} else if (isZoomed && e.touches.length === 1) {
			// Pan zoomed image
			e.preventDefault();
			const touch = e.touches[0];
			const deltaX = touch.clientX - tapPosition.x;
			const deltaY = touch.clientY - tapPosition.y;

			// Limit pan based on scale
			const panLimit = (scale - 1) * 200;
			translateX = Math.max(-panLimit, Math.min(panLimit, deltaX));
			translateY = Math.max(-panLimit, Math.min(panLimit, deltaY));

			tapPosition = { x: touch.clientX, y: touch.clientY };
		}
	}

	function handleTouchEnd() {
		if (isPinching) {
			isPinching = false;
			hapticLight();
		}

		if (dragging) {
			dragging = false;
			if (dragOffsetY > CLOSE_THRESHOLD) {
				hapticMedium();
				handleClose();
			} else {
				dragOffsetY = 0;
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleClose();
		}
	}

	function zoomToPoint(clientX: number, clientY: number) {
		const rect = (document.querySelector('.zoom-image') as HTMLElement)?.getBoundingClientRect();
		if (!rect) return;

		// Calculate zoom center relative to image
		const centerX = (clientX - rect.left) / rect.width - 0.5;
		const centerY = (clientY - rect.top) / rect.height - 0.5;

		scale = 2;
		translateX = -centerX * 100;
		translateY = -centerY * 100;
		isZoomed = true;
	}

	function handleWheel(e: WheelEvent) {
		if (!open) return;

		e.preventDefault();
		const delta = e.deltaY > 0 ? -0.1 : 0.1;
		scale = Math.min(maxScale, Math.max(minScale, scale + delta));
		isZoomed = scale > 1;
	}

	function handleShare() {
		if (shareUrl) {
			// Swallow AbortError when the user cancels the system share sheet.
			navigator.share?.({ url: shareUrl }).catch(() => {});
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[100] bg-black flex items-center justify-center"
		onclick={handleClose}
		transition:fade={{ duration: 200 }}
		onwheel={handleWheel}
		role="dialog"
		aria-modal="true"
		aria-label={caption || 'Image viewer'}
	>
		<!-- Image container -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative w-full h-full flex items-center justify-center overflow-hidden"
			style="transform: translateY({dragOffsetY}px); opacity: {Math.max(0.5, 1 - dragOffsetY / 300)};"
			ontouchstart={handleTouchStart}
			ontouchmove={handleTouchMove}
			ontouchend={handleTouchEnd}
		>
			{#if isLoading}
				<div class="absolute inset-0 flex items-center justify-center">
					<Icon icon="ph:circle-notch" class="text-white text-3xl animate-spin" />
				</div>
			{/if}

			{#if !imageError}
				<img
					src={src}
					{alt}
					class="zoom-image max-w-full max-h-full object-contain transition-transform duration-200"
					class:loading={isLoading}
					style="transform: scale({scale}) translate({translateX / scale}px, {translateY / scale}px);"
					onload={() => (isLoading = false)}
					onerror={() => (imageError = true)}
					draggable="false"
				/>
			{:else}
				<div class="flex flex-col items-center gap-3 text-white/60">
					<Icon icon="ph:image-broken" class="text-5xl" />
					<p class="text-sm">Image failed to load</p>
					<button 
						onclick={handleClose}
						class="mt-2 px-4 py-2 rounded-full bg-white/20 backdrop-blur-md text-white text-sm font-medium hover:bg-white/30 transition-colors"
					>
						Close
					</button>
				</div>
			{/if}
		</div>

		<!-- Top bar with improved visibility -->
		<div class="absolute top-0 left-0 right-0 p-3 pt-safe flex items-center justify-between bg-gradient-to-b from-black/70 via-black/40 to-transparent pointer-events-none">
			<button
				onclick={handleClose}
				class="w-10 h-10 rounded-full bg-white/25 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/35 transition-colors pointer-events-auto active:scale-95"
				aria-label="Close"
			>
				<Icon icon="ph:x-bold" class="text-lg" />
			</button>

			{#if caption}
				<p class="text-white/90 text-sm font-medium truncate max-w-[50%] text-balance">{caption}</p>
			{/if}

			<div class="w-10"></div> <!-- Spacer for centering -->
		</div>

		<!-- Bottom actions -->
		{#if shareUrl}
			<div class="absolute bottom-0 left-0 right-0 p-4 pb-safe flex items-center justify-center bg-gradient-to-t from-black/70 via-black/40 to-transparent pointer-events-none">
				<button
					onclick={handleShare}
					class="px-5 py-2.5 rounded-full bg-white/25 backdrop-blur-md text-white text-sm font-semibold hover:bg-white/35 transition-colors flex items-center gap-2 pointer-events-auto active:scale-95"
				>
					<Icon icon="ph:share" class="text-base" />
					Share
				</button>
			</div>
		{/if}

		<!-- Zoom indicator -->
		{#if isZoomed}
			<div class="absolute top-20 right-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-white text-xs font-bold shadow-lg">
				{Math.round(scale * 100)}%
			</div>
		{/if}
	</div>
{/if}

<style>
	.zoom-image {
		will-change: transform;
		touch-action: none;
	}

	.zoom-image.loading {
		opacity: 0;
	}
</style>
