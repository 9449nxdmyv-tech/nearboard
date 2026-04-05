/**
 * @file onboardingStore.ts
 * @description Session-only store for onboarding flow state.
 *              Not persisted to Firestore — resets on page refresh.
 */

import { writable } from 'svelte/store';
import type { OnboardingIntent } from '$lib/utils/onboardingUtils';

export type OnboardingPath = 'A' | 'B' | 'C' | 'D';
export type OnboardingStep = 'intent' | 'board-creating' | 'whatsapp-offer' | 'invite' | 'complete';

interface OnboardingState {
	intent: OnboardingIntent | null;
	boardId: string | null;
	path: OnboardingPath | null;
	step: OnboardingStep | null;
	whatsAppDismissed: boolean;
	inviteSkipped: boolean;
}

const initial: OnboardingState = {
	intent: null,
	boardId: null,
	path: null,
	step: null,
	whatsAppDismissed: false,
	inviteSkipped: false
};

export const onboardingStore = writable<OnboardingState>(initial);

export function setIntent(intent: OnboardingIntent): void {
	onboardingStore.update((s) => ({ ...s, intent, step: 'intent' }));
}

export function setBoardId(boardId: string): void {
	onboardingStore.update((s) => ({ ...s, boardId }));
}

export function setPath(path: OnboardingPath): void {
	onboardingStore.update((s) => ({ ...s, path }));
}

export function advanceStep(step: OnboardingStep): void {
	onboardingStore.update((s) => ({ ...s, step }));
}

export function dismissWhatsApp(): void {
	onboardingStore.update((s) => ({ ...s, whatsAppDismissed: true }));
}

export function skipInvite(): void {
	onboardingStore.update((s) => ({ ...s, inviteSkipped: true }));
}

export function resetOnboarding(): void {
	onboardingStore.set(initial);
}
