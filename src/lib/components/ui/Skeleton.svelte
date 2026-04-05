<!--
  @file Skeleton.svelte
  @description Native-style skeleton loading component with shimmer animation.
               Supports multiple variants for different content types.
-->
<script lang="ts">
	import { fade } from 'svelte/transition';

	let {
		variant = 'text',
		width,
		height,
		radius,
		delay = 0,
		class: className = ''
	}: {
		variant?: 'text' | 'text-line' | 'avatar' | 'image' | 'card' | 'button' | 'chip';
		width?: string;
		height?: string;
		radius?: string;
		delay?: number;
		class?: string;
	} = $props();

	const baseClasses = 'bg-surface relative overflow-hidden';

	const variantClasses = {
		text: 'h-3 w-full rounded-sm',
		'text-line': 'h-3 w-3/4 rounded-sm',
		avatar: 'w-10 h-10 rounded-full',
		image: 'w-full h-32 rounded-card',
		card: 'w-full h-48 rounded-card',
		button: 'h-10 w-28 rounded-full',
		chip: 'h-6 w-16 rounded-full'
	};

	const style = $derived(
		[
			width ? `width:${width}` : '',
			height ? `height:${height}` : '',
			radius ? `border-radius:${radius}` : '',
			delay ? `animation-delay:${delay}ms` : ''
		].filter(Boolean).join(';')
	);
</script>

<div
	class="{baseClasses} {variantClasses[variant]} {className} skeleton-shimmer"
	style={style}
	in:fade={{ duration: 200 }}
></div>

<style>
	@keyframes shimmer {
		0% {
			background-position: -200% 0;
		}
		100% {
			background-position: 200% 0;
		}
	}

	.skeleton-shimmer {
		background: linear-gradient(
			90deg,
			var(--color-surface) 0%,
			color-mix(in srgb, var(--color-border) 15%, var(--color-surface)) 50%,
			var(--color-surface) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.8s ease-in-out infinite;
	}
</style>
