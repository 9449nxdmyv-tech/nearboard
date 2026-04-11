<!--
  @file CardAcknowledgmentButton.svelte
  @description Fave (heart) toggle with pop animation and inline count.
               Enhanced for mobile with larger touch targets and better visibility.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { userStore } from '$lib/stores';
	import { toggleAcknowledgment } from '$lib/firebase/boardService';
	import { scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { hapticLight } from '$lib/utils/haptics';

	let {
		boardId,
		contentId,
		acknowledgments = {},
		isDetail = false
	}: {
		boardId: string;
		contentId: string;
		acknowledgments?: Record<string, { type: 'heart'; createdAt: any }>;
		isDetail?: boolean;
	} = $props();

	const user = $derived($userStore.user);
	const hasFaved = $derived(user ? !!acknowledgments[user.uid] : false);
	const faveCount = $derived(Object.keys(acknowledgments).length);

	let justTapped = $state(false);
	let toggling = $state(false);

	async function handleToggle() {
		if (!user || toggling) return;
		toggling = true;
		hapticLight();
		justTapped = true;
		setTimeout(() => (justTapped = false), 400);
		try {
			await toggleAcknowledgment(boardId, contentId, user.uid, !hasFaved);
		} catch (e) {
			console.error('Failed to toggle fave:', e);
		} finally {
			toggling = false;
		}
	}
</script>

<button
	onclick={handleToggle}
	class="relative flex items-center justify-center gap-1.5 transition-all duration-200 press-scale
		{isDetail ? 'px-3 py-2 text-error' : 'py-2 px-3 text-muted'}
		{!isDetail && hasFaved ? 'text-error' : ''}"
	aria-label={hasFaved ? 'Unfave' : 'Fave'}
>
	<!-- Burst particles -->
	{#if justTapped && hasFaved}
		<div class="heart-burst">
			{#each Array(6) as _, i}
				<span class="heart-particle" style="--angle: {i * 60}deg; --delay: {i * 30}ms"></span>
			{/each}
		</div>
		<span class="heart-ring"></span>
	{/if}

	{#if hasFaved}
		<span class="heart-pop" class:heart-tap={justTapped} in:scale={{ duration: 300, easing: quintOut }}>
			<Icon icon="ph:heart-fill" class={isDetail ? 'text-xl' : 'text-lg'} />
		</span>
	{:else}
		<Icon icon="ph:heart" class={isDetail ? 'text-xl' : 'text-lg'} />
	{/if}
	{#if faveCount > 0}
		<span class="{isDetail ? 'text-sm' : 'text-xs'} font-semibold tabular-nums" class:count-bump={justTapped}>{faveCount}</span>
	{/if}
</button>

<style>
	@keyframes heart-pop {
		0% { transform: scale(1); }
		30% { transform: scale(1.4); }
		60% { transform: scale(0.85); }
		100% { transform: scale(1); }
	}
	.heart-tap {
		animation: heart-pop 0.4s cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* Count bump */
	@keyframes count-bump {
		0% { transform: scale(1); }
		40% { transform: scale(1.3); }
		100% { transform: scale(1); }
	}
	.count-bump {
		animation: count-bump 0.35s ease-out;
	}

	/* Burst ring */
	.heart-ring {
		position: absolute;
		left: 12px;
		top: 50%;
		width: 24px;
		height: 24px;
		margin-top: -12px;
		border-radius: 50%;
		border: 2px solid var(--color-error);
		opacity: 0;
		animation: ring-expand 0.45s ease-out forwards;
		pointer-events: none;
	}
	@keyframes ring-expand {
		0% { transform: scale(0.3); opacity: 0.7; }
		100% { transform: scale(2); opacity: 0; }
	}

	/* Particle burst */
	.heart-burst {
		position: absolute;
		left: 20px;
		top: 50%;
		pointer-events: none;
	}
	.heart-particle {
		position: absolute;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--color-error);
		animation: particle-fly 0.5s ease-out forwards;
		animation-delay: var(--delay);
		opacity: 0;
	}
	@keyframes particle-fly {
		0% { transform: translate(0, 0) scale(1); opacity: 1; }
		100% { transform: translate(
			calc(cos(var(--angle)) * 18px),
			calc(sin(var(--angle)) * 18px)
		) scale(0); opacity: 0; }
	}
</style>
