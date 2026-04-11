/**
 * @file experienceStore.ts
 * @description Reactive store for the user's experience preferences.
 *              Derives global preferences from userStore and provides
 *              getEffectiveExperience() for per-board resolution.
 */

import { derived } from 'svelte/store';
import { userStore } from './userStore';
import { resolveEffectiveExperience } from '$lib/utils/experienceResolver';
import { DEFAULT_EXPERIENCE } from '$lib/config/constants';
import type { UserExperiencePreferences, BoardExperienceOverrides } from '$lib/types/firestore';

/**
 * Reactive store exposing the user's global experience preferences
 * (with system defaults applied for missing fields).
 */
export const globalExperience = derived(userStore, ($userStore) => {
	return resolveEffectiveExperience($userStore.user?.experiencePreferences);
});

/**
 * Resolve the effective experience for a specific board context.
 * Call this with the board's overrides to get merged settings.
 */
export function getEffectiveExperience(
	userPrefs: UserExperiencePreferences | undefined | null,
	boardOverrides: BoardExperienceOverrides | undefined | null
): UserExperiencePreferences {
	return resolveEffectiveExperience(userPrefs, boardOverrides);
}
