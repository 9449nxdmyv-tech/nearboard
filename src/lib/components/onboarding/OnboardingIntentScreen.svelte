<!--
  @file OnboardingIntentScreen.svelte
  @description Full-screen intent picker shown immediately after SSO signup.
               Single question, large tap targets, no confirm button.
-->
<script lang="ts">
	import Icon from '@iconify/svelte';
	import { fade } from 'svelte/transition';
	import { PAGE_TRANSITION } from '$lib/config/animations';
	import { INTENT_OPTIONS, type OnboardingIntent } from '$lib/utils/onboardingUtils';

	interface Props {
		onselect: (intent: OnboardingIntent) => void;
	}

	let { onselect }: Props = $props();
	let selected = $state<OnboardingIntent | null>(null);

	function handleSelect(intent: OnboardingIntent) {
		if (selected) return;
		selected = intent;
		setTimeout(() => onselect(intent), 150);
	}

	function handleSkip() {
		handleSelect('other');
	}
</script>

<div
	class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface px-6"
	in:fade={{ duration: PAGE_TRANSITION.duration }}
>
	<h1 class="font-display text-2xl font-semibold text-primary mb-2 text-center">
		What are you working on right now?
	</h1>
	<p class="text-sm text-muted mb-8 text-center">
		We'll set up your first board around it.
	</p>

	<div class="grid grid-cols-2 gap-3 w-full max-w-sm">
		{#each INTENT_OPTIONS as option (option.key)}
			<button
				class="flex items-center gap-3 px-4 py-3.5 rounded-full bg-card shadow-card
					border border-border text-left transition-all duration-150
					disabled:opacity-50 active:scale-95
					{selected === option.key ? 'ring-2 ring-accent border-accent' : ''}"
				onclick={() => handleSelect(option.key)}
				disabled={selected !== null && selected !== option.key}
			>
				<div class="w-6 h-6 flex items-center justify-center shrink-0">
					<Icon icon={option.icon} width={20} height={20} class="text-accent" />
				</div>
				<span class="text-sm font-medium text-primary">{option.label}</span>
			</button>
		{/each}
	</div>

	<button
		class="mt-8 text-sm font-medium text-muted hover:text-primary underline underline-offset-4 transition-colors"
		onclick={handleSkip}
		aria-label="Skip and pick a neutral board"
	>
		Not sure yet — skip
	</button>
</div>
