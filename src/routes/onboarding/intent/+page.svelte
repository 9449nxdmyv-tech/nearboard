<!--
  @file onboarding/intent/+page.svelte
  @description Post-signup intent selection. Creates the Magic First Board
               with example cards, then proceeds to the setup flow.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { userStore } from '$lib/stores';
	import {
		onboardingStore, setIntent, setBoardId, setPath, advanceStep
	} from '$lib/stores';
	import { createBoard, addContent } from '$lib/firebase';
	import { addContentOptimistic } from '$lib/stores';
	import {
		INTENT_BOARD_NAMES,
		INTENT_TEMPLATES,
		INTENT_EXAMPLE_CARDS,
		SEED_SUMMARY,
		type OnboardingIntent
	} from '$lib/utils/onboardingUtils';
	import type { NoteContentDoc } from '$lib/types';
	import OnboardingIntentScreen from '$lib/components/onboarding/OnboardingIntentScreen.svelte';

	let creating = $state(false);

	async function handleIntentSelected(intent: OnboardingIntent) {
		const user = $userStore.user;
		if (!user || creating) return;
		creating = true;

		setIntent(intent);
		setPath('A');
		advanceStep('board-creating');

		try {
			const boardId = await createBoard(
				INTENT_BOARD_NAMES[intent],
				INTENT_TEMPLATES[intent],
				user.uid,
				null,
				user.displayName,
				user.photoURL,
				{
					isOnboarding: true,
					livingSummary: SEED_SUMMARY
				}
			);

			setBoardId(boardId);

			// Write example cards in parallel (fire-and-forget — don't block navigation)
			const cards = INTENT_EXAMPLE_CARDS[intent];
			Promise.all(
				cards.map((card) =>
					addContentOptimistic(boardId, {
						type: card.type,
						text: card.text,
						boardId,
						authorId: user.uid,
						authorName: user.displayName,
						authorPhotoURL: user.photoURL,
						userIntent: 'Onboarding example card'  // Lever 7: Required intent
					} as Omit<NoteContentDoc, 'id' | 'createdAt' | 'moderationStatus'>, addContent)
				)
			).catch(console.error);

			goto('/onboarding/setup');
		} catch (err) {
			console.error('Magic First Board creation failed:', err);
			creating = false;
		}
	}
</script>

<OnboardingIntentScreen onselect={handleIntentSelected} />
