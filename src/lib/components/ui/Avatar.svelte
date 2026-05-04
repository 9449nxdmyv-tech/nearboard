<!--
  @file Avatar.svelte
  @description Single source of truth for user avatar rendering.
               Falls back to coloured initial when no photoURL or on image load error.
-->
<script lang="ts">
	import { avatarInitial } from '$lib/utils/textFormatter';

	type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
	type Ring = 'none' | 'card' | 'surface' | 'accent';

	let {
		name,
		photoURL = null,
		size = 'md',
		ring = 'none',
		title,
		active = false
	}: {
		name: string | null | undefined;
		photoURL?: string | null;
		size?: Size;
		ring?: Ring;
		title?: string;
		/** Soft glow + pulse — used by AvatarStack to mark members currently viewing a board. */
		active?: boolean;
	} = $props();

	let imageError = $state(false);

	$effect(() => {
		if (photoURL) imageError = false;
	});

	const sizeClass: Record<Size, string> = {
		xs: 'w-5 h-5 text-[8px]',
		sm: 'w-7 h-7 text-[11px]',
		md: 'w-10 h-10 text-sm',
		lg: 'w-14 h-14 text-xl',
		xl: 'w-20 h-20 text-2xl',
		'2xl': 'w-24 h-24 text-3xl'
	};

	const ringClass: Record<Ring, string> = {
		none: '',
		card: 'ring-2 ring-card shadow-sm',
		surface: 'ring-2 ring-surface',
		accent: 'ring-2 ring-accent/20'
	};

	const tooltip = $derived(title ?? (name || ''));
	const showImage = $derived(!!photoURL && !imageError);
</script>

{#if showImage}
	<img
		src={photoURL}
		alt={name || 'User'}
		title={tooltip}
		class="{sizeClass[size]} {ringClass[ring]} rounded-full object-cover shrink-0 {active ? 'presence-pulse' : ''}"
		onerror={() => { imageError = true; }}
	/>
{:else}
	<div
		title={tooltip}
		class="{sizeClass[size]} {ringClass[ring]} rounded-full bg-accent/10 text-accent font-semibold flex items-center justify-center shrink-0 {active ? 'presence-pulse' : ''}"
	>
		{avatarInitial(name)}
	</div>
{/if}

<style>
	/* Soft, ambient halo for users currently viewing a board.
	   Avoids Tailwind's animate-pulse (which fades the whole avatar) by
	   pulsing only an outer ring shadow. */
	:global(.presence-pulse) {
		position: relative;
		box-shadow: 0 0 0 2px var(--color-accent, #ff7752), 0 0 0 4px rgba(255, 119, 82, 0.18);
		animation: nb-presence-pulse 2.4s ease-in-out infinite;
	}
	@keyframes nb-presence-pulse {
		0%, 100% { box-shadow: 0 0 0 2px var(--color-accent, #ff7752), 0 0 0 4px rgba(255, 119, 82, 0.12); }
		50%      { box-shadow: 0 0 0 2px var(--color-accent, #ff7752), 0 0 0 7px rgba(255, 119, 82, 0.0); }
	}
</style>
