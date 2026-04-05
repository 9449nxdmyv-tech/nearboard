<!--
  @file StreakBadge.svelte
  @description Board streak counter with flame icon. Shows consecutive days
               of activity on a board. Rendered on board cards and board header.
               Features milestone glow animations and flame color intensity scaling.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';

	let {
		streak,
		size = 'sm'
	}: {
		streak: number;
		size?: 'sm' | 'lg';
	} = $props();

	const isMilestone = $derived(streak === 7 || streak === 30 || streak === 100);

	const flameColor = $derived(
		streak >= 100 ? 'text-[color:var(--color-streak-extreme-text)]' :
		streak >= 30 ? 'text-[color:var(--color-streak-high-text)]' :
		streak >= 7 ? 'text-[color:var(--color-streak-mid-text)]' :
		'text-[color:var(--color-streak-low-text)]'
	);

	const badgeBg = $derived(
		streak >= 100 ? 'bg-[color:var(--color-streak-extreme-bg)]' :
		streak >= 30 ? 'bg-[color:var(--color-streak-high-bg)]' :
		streak >= 7 ? 'bg-[color:var(--color-streak-mid-bg)]' :
		'bg-[color:var(--color-streak-low-bg)]'
	);
</script>

{#if streak > 0}
	<span
		class="inline-flex items-center gap-1 font-medium
			{size === 'lg' ? 'text-base px-3 py-1' : 'text-xs px-2 py-0.5'}
			{badgeBg} rounded-full
			{isMilestone ? 'streak-milestone' : ''}"
	>
		<Icon icon="ph:flame-fill" class={flameColor} aria-hidden="true" />
		{streak}d
	</span>
{/if}

<style>
	@keyframes milestone-glow {
		0%, 100% {
			box-shadow: 0 0 4px var(--shadow-streak-low);
			transform: scale(1);
		}
		50% {
			box-shadow: 0 0 12px var(--shadow-streak-high);
			transform: scale(1.08);
		}
	}
	.streak-milestone {
		animation: milestone-glow 2s ease-in-out infinite;
	}
</style>
