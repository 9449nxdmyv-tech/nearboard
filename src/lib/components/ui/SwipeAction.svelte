<!--
  @file SwipeAction.svelte
  @description Swipe-to-reveal wrapper. Swipe left to show a delete action behind the card.
               Uses touch events (not pointer events) to avoid conflicts with the long-press
               handler on parent elements. Direction-locked: horizontal swipe vs vertical scroll
               is decided after 10px of movement and can't change mid-gesture.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { hapticWarning, hapticHeavy } from '$lib/utils/haptics';

	let {
		onAction,
		children
	}: {
		onAction: () => void;
		children: Snippet;
	} = $props();

	const THRESHOLD = 80;
	const ACTION_WIDTH = 80;
	const MAX_OVERSWIPE = ACTION_WIDTH + 20;

	let offsetX = $state(0);
	let startX = 0;
	let startY = 0;
	let swiping = $state(false);
	let revealed = $state(false);
	let direction: 'none' | 'horizontal' | 'vertical' = 'none';
	let thresholdTriggered = false;

	function onTouchStart(e: TouchEvent) {
		if ((e.target as HTMLElement).closest('button, a')) return;

		// Don't interfere with horizontal scrollables (e.g. photo carousel)
		if ((e.target as HTMLElement).closest('.snap-x, .overflow-x-auto, [data-no-swipe]')) return;

		// Tap anywhere to close a revealed action
		if (revealed) {
			revealed = false;
			offsetX = 0;
			e.preventDefault(); // suppress pointer events for this tap
			return;
		}

		const touch = e.touches[0];
		startX = touch.clientX;
		startY = touch.clientY;
		swiping = false;
		direction = 'none';
		thresholdTriggered = false;
	}

	function onTouchMove(e: TouchEvent) {
		if (direction === 'vertical') return;

		const touch = e.touches[0];
		const dx = touch.clientX - startX;
		const dy = touch.clientY - startY;

		// Decide direction after 10px dead zone
		if (direction === 'none') {
			if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
			if (Math.abs(dy) > Math.abs(dx)) {
				direction = 'vertical';
				return;
			}
			direction = 'horizontal';
			swiping = true;
		}

		// Prevent scroll + suppress pointer events while swiping
		e.preventDefault();

		// Only allow left swipe, clamped
		offsetX = Math.min(0, Math.max(-MAX_OVERSWIPE, dx));

		// Haptic tick at threshold
		if (offsetX < -THRESHOLD && !thresholdTriggered) {
			thresholdTriggered = true;
			hapticWarning();
		} else if (offsetX >= -THRESHOLD) {
			thresholdTriggered = false;
		}
	}

	function onTouchEnd() {
		if (!swiping) {
			direction = 'none';
			return;
		}
		swiping = false;
		direction = 'none';
		thresholdTriggered = false;

		if (offsetX < -THRESHOLD) {
			offsetX = -ACTION_WIDTH;
			revealed = true;
		} else {
			offsetX = 0;
			revealed = false;
		}
	}

	// One-time hint peek to teach users they can swipe
	let hintEl: HTMLElement | undefined;
	onMount(() => {
		const HINT_KEY = 'nearboard:swipe-hint-shown';
		if (localStorage.getItem(HINT_KEY)) return;
		localStorage.setItem(HINT_KEY, '1');
		// Brief peek after a short delay
		setTimeout(() => {
			if (!hintEl) return;
			hintEl.style.transition = 'transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
			hintEl.style.transform = 'translateX(-30px)';
			setTimeout(() => {
				if (!hintEl) return;
				hintEl.style.transform = 'translateX(0)';
			}, 600);
		}, 1500);
	});

	function handleAction() {
		hapticHeavy();
		revealed = false;
		offsetX = 0;
		onAction();
	}
</script>

<div class="relative overflow-hidden rounded-card">
	<!-- Delete action behind -->
	<div class="absolute inset-y-0 right-0 w-20 bg-[color:var(--color-delete-action)] flex items-center justify-center"
		style="opacity: {Math.min(1, Math.abs(offsetX) / ACTION_WIDTH)}">
		<button onclick={handleAction} class="w-full h-full flex items-center justify-center" aria-label="Delete">
			<Icon icon="ph:trash-bold" class="text-white text-xl"
				style="transform: scale({0.8 + 0.2 * Math.min(1, Math.abs(offsetX) / ACTION_WIDTH)})" />
		</button>
	</div>

	<!-- Swipeable card -->
	<div
		bind:this={hintEl}
		role="group"
		class="relative bg-card will-change-transform"
		style="transform: translateX({offsetX}px); transition: {swiping ? 'none' : 'transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'}"
		ontouchstart={onTouchStart}
		ontouchmove={onTouchMove}
		ontouchend={onTouchEnd}
		ontouchcancel={onTouchEnd}
	>
		{@render children()}
	</div>
</div>
