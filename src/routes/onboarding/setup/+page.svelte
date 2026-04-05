<!--
  @file onboarding/setup/+page.svelte
  @description Orchestrates WhatsApp offer → Invite prompt sequence.
               Navigates to the new board on completion.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { onboardingStore, advanceStep, dismissWhatsApp, resetOnboarding } from '$lib/stores';
	import OnboardingWhatsAppOffer from '$lib/components/onboarding/OnboardingWhatsAppOffer.svelte';
	import OnboardingInvitePrompt from '$lib/components/onboarding/OnboardingInvitePrompt.svelte';

	let boardId = $state<string | null>(null);
	let showWhatsApp = $state(true);
	let showInvite = $state(false);
	let whatsAppAuthors = $state<string[]>([]);

	onMount(() => {
		const unsub = onboardingStore.subscribe((state) => {
			boardId = state.boardId;
		});
		// If no boardId, user navigated here directly
		if (!boardId) goto('/onboarding/intent');
		return unsub;
	});

	function handleWhatsAppSkip() {
		advanceStep('invite');
		dismissWhatsApp();
		showWhatsApp = false;
		showInvite = true;
	}

	function handleWhatsAppImported(authors: string[]) {
		advanceStep('invite');
		whatsAppAuthors = authors;
		showWhatsApp = false;
		showInvite = true;
	}

	function finishOnboarding() {
		advanceStep('complete');
		const id = boardId;
		resetOnboarding();
		goto(`/board/${id}`);
	}
</script>

{#if boardId}
	{#if showWhatsApp}
		<OnboardingWhatsAppOffer
			{boardId}
			onskip={handleWhatsAppSkip}
			onimport={(e) => handleWhatsAppImported(e.authors)}
		/>
	{/if}

	{#if showInvite}
		<OnboardingInvitePrompt
			{boardId}
			preselectedNames={whatsAppAuthors}
			oncomplete={finishOnboarding}
			onskip={finishOnboarding}
		/>
	{/if}
{/if}
