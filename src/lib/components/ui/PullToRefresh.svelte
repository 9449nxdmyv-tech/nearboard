<!--
  @file PullToRefresh.svelte
  @description Native-style pull-to-refresh component. iOS-style elastic drag
               with spinner at threshold. Works with any scrollable container.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { hapticLight, hapticSuccess } from '$lib/utils/haptics';

	let {
		onRefresh,
		disabled = false,
		threshold = 100,
		children
	}: {
		onRefresh: () => Promise<void>;
		disabled?: boolean;
		threshold?: number;
		children: Snippet;
	} = $props();

	let pullDistance = $state(0);
	let isRefreshing = $state(false);
	let isDragging = $state(false);
	let startY = $state(0);
	let thresholdReached = $state(false);

	function handleTouchStart(e: TouchEvent) {
		if (disabled || isRefreshing) return;
		const scrollable = getCurrentScrollable();
		if (!scrollable || scrollable.scrollTop > 0) return;

		isDragging = true;
		startY = e.touches[0].clientY;
		pullDistance = 0;
		thresholdReached = false;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isDragging || disabled || isRefreshing) return;

		const currentY = e.touches[0].clientY;
		const delta = currentY - startY;

		// Only allow downward pull
		if (delta <= 0) return;

		e.preventDefault();

		// Elastic resistance formula
		pullDistance = delta * 0.5;

		if (pullDistance >= threshold && !thresholdReached) {
			thresholdReached = true;
			hapticLight();
		} else if (pullDistance < threshold && thresholdReached) {
			thresholdReached = false;
		}
	}

	async function handleTouchEnd() {
		if (!isDragging || disabled || isRefreshing) return;
		isDragging = false;

		if (thresholdReached) {
			await doRefresh();
		} else {
			pullDistance = 0;
		}
	}

	function getCurrentScrollable(): HTMLElement | null {
		const el = document.querySelector('.pull-refresh-scroll');
		return (el as HTMLElement) || document.scrollingElement as HTMLElement;
	}

	async function doRefresh() {
		isRefreshing = true;
		pullDistance = threshold + 20;

		try {
			await onRefresh();
			hapticSuccess();
		} finally {
			// Animate back
			pullDistance = 0;
			setTimeout(() => {
				isRefreshing = false;
			}, 300);
		}
	}

	// Expose refresh method for programmatic refresh
	export async function refresh() {
		if (isRefreshing) return;
		await doRefresh();
	}

	const spinnerRotation = $derived(pullDistance / threshold * 360);
	const spinnerScale = $derived(0.8 + (pullDistance / threshold) * 0.2);
</script>

<div
	class="pull-to-refresh-container relative"
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
>
	<!-- Pull indicator -->
	{#if pullDistance > 0 || isRefreshing}
		<div
			class="fixed left-0 right-0 top-0 flex items-center justify-center pointer-events-none z-[60]"
			style="height: 0;"
		>
			<div
				class="flex items-center gap-2 px-4 py-2 rounded-full bg-surface shadow-lg border border-border/50"
				transition:fly={{ y: -20, duration: 200 }}
				style="transform: translateY({Math.min(pullDistance, threshold + 40)}px);"
			>
				{#if isRefreshing}
					<Icon
						icon="ph:circle-notch"
						class="text-accent text-lg animate-spin"
					/>
					<span class="text-xs text-primary font-medium">Refreshing…</span>
				{:else if thresholdReached}
					<Icon
						icon="ph:arrow-down"
						class="text-accent text-lg"
						style="transform: rotate(180deg);"
					/>
					<span class="text-xs text-accent font-medium">Release to refresh</span>
				{:else}
					<Icon
						icon="ph:arrow-down"
						class="text-muted/60 text-lg"
						style="transform: rotate({spinnerRotation}deg) scale({spinnerScale});"
					/>
					<span class="text-xs text-muted font-medium">Pull to refresh</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Content -->
	{@render children()}
</div>

<style>
	.pull-to-refresh-container {
		touch-action: pan-y;
		overscroll-behavior-y: none;
	}

	.pull-refresh-scroll {
		overscroll-behavior-y: none;
	}
</style>
