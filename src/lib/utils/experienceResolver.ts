/**
 * @file experienceResolver.ts
 * @description Resolves effective experience settings by merging:
 *              system defaults → user global preferences → board overrides.
 *              Also detects which preset (if any) matches the current settings.
 */

import { DEFAULT_EXPERIENCE, EXPERIENCE_PRESETS } from '$lib/config/constants';
import type {
	UserExperiencePreferences,
	BoardExperienceOverrides,
	ExperiencePreset
} from '$lib/types/firestore';

const SETTING_KEYS = ['scrollBehavior', 'videoPlayback', 'feedOrder', 'layoutStyle'] as const;

/**
 * Resolve the effective experience for a given context.
 * Merges: system defaults → user preferences → board overrides (field-by-field).
 */
export function resolveEffectiveExperience(
	userPrefs?: UserExperiencePreferences | null,
	boardOverrides?: BoardExperienceOverrides | null
): UserExperiencePreferences {
	// Start with system defaults
	const effective: UserExperiencePreferences = { ...DEFAULT_EXPERIENCE };

	// Layer user preferences
	if (userPrefs) {
		for (const key of SETTING_KEYS) {
			if (userPrefs[key] != null) {
				(effective as any)[key] = userPrefs[key];
			}
		}
	}

	// Layer board overrides (only when enabled)
	if (boardOverrides?.enabled) {
		for (const key of SETTING_KEYS) {
			if (boardOverrides[key] != null) {
				(effective as any)[key] = boardOverrides[key];
			}
		}
	}

	// Detect preset
	effective.preset = detectPreset(effective);

	return effective;
}

/**
 * Detect which preset matches the given settings, or 'custom' if none match.
 */
export function detectPreset(prefs: UserExperiencePreferences): ExperiencePreset {
	for (const [name, preset] of Object.entries(EXPERIENCE_PRESETS) as [ExperiencePreset, typeof EXPERIENCE_PRESETS['calm']][]) {
		const matches = SETTING_KEYS.every(key => prefs[key] === preset[key]);
		if (matches) return name;
	}
	return 'custom';
}

/**
 * Apply a preset, returning a full UserExperiencePreferences object.
 */
export function applyPreset(preset: 'calm' | 'balanced' | 'lively'): UserExperiencePreferences {
	return {
		...EXPERIENCE_PRESETS[preset],
		preset
	};
}
