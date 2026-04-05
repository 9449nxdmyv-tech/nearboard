<!--
  @file NudgeCard.svelte
  @description Ambient onboarding nudge card. Visually distinct from real cards.
               Dismissible — marks nudge as permanently seen on UserDoc.
-->
<script lang="ts">
	import { fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { CARD_ENTRANCE } from '$lib/config/animations';
	import { userStore } from '$lib/stores';
	import { updateDoc, doc, arrayUnion } from 'firebase/firestore';
	import { db } from '$lib/firebase/app';
	import type { NudgeConfig } from '$lib/utils/onboardingUtils';

	interface Props {
		nudge: NudgeConfig;
		onaction?: () => void;
	}

	let { nudge, onaction }: Props = $props();
	let dismissed = $state(false);

	async function dismiss() {
		dismissed = true;
		const user = $userStore.user;
		if (user) {
			updateDoc(doc(db(), 'users', user.uid), {
				seenNudges: arrayUnion(nudge.id)
			}).catch(console.error);
		}
	}
</script>

{#if !dismissed}
	<div
		class="bg-accent/5 border border-dashed border-accent/20 rounded-card p-4 mb-4 relative"
		in:fly={{ y: CARD_ENTRANCE.y, duration: CARD_ENTRANCE.duration }}
	>
		<button
			class="absolute top-2.5 right-2.5 w-6 h-6 flex items-center justify-center rounded-full
				text-on-surface/50 hover:text-on-surface hover:bg-surface transition-colors"
			onclick={dismiss}
			aria-label="Dismiss tip"
		>
			<Icon icon="ph:x" class="text-sm" />
		</button>

		<div class="flex items-start gap-3 pr-6">
			<Icon icon="ph:sparkle" class="text-accent text-base shrink-0 mt-0.5" />
			<p class="text-sm text-primary/80 leading-relaxed">{nudge.text}</p>
		</div>

		{#if nudge.action}
			<button
				class="mt-2.5 ml-7 text-sm font-medium text-accent hover:underline
					flex items-center gap-1"
				onclick={onaction}
			>
				{nudge.action.label}
				<Icon icon="ph:arrow-right" class="text-xs" />
			</button>
		{/if}
	</div>
{/if}
