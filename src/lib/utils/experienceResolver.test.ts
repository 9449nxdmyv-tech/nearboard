import { describe, it, expect } from 'vitest';
import { resolveEffectiveExperience, detectPreset, applyPreset } from './experienceResolver';
import { DEFAULT_EXPERIENCE, EXPERIENCE_PRESETS } from '$lib/config/constants';
import type { UserExperiencePreferences, BoardExperienceOverrides } from '$lib/types/firestore';

describe('resolveEffectiveExperience', () => {
	it('returns system defaults when no prefs or overrides', () => {
		const result = resolveEffectiveExperience();
		expect(result.scrollBehavior).toBe('load-more');
		expect(result.videoPlayback).toBe('tap-to-play');
		expect(result.feedOrder).toBe('newest');
		expect(result.conversationMode).toBe('board');
		expect(result.layoutStyle).toBe('single-column');
		expect(result.preset).toBe('calm');
	});

	it('applies user prefs over defaults', () => {
		const userPrefs: UserExperiencePreferences = {
			scrollBehavior: 'infinite',
			videoPlayback: 'muted-autoplay',
			feedOrder: 'most-active',
			conversationMode: 'chat',
			layoutStyle: 'masonry'
		};
		const result = resolveEffectiveExperience(userPrefs);
		expect(result.scrollBehavior).toBe('infinite');
		expect(result.videoPlayback).toBe('muted-autoplay');
		expect(result.feedOrder).toBe('most-active');
		expect(result.conversationMode).toBe('chat');
		expect(result.layoutStyle).toBe('masonry');
	});

	it('partially overrides defaults with user prefs', () => {
		const userPrefs: UserExperiencePreferences = {
			scrollBehavior: 'paged',
			videoPlayback: 'tap-to-play',
			feedOrder: 'newest',
			conversationMode: 'board',
			layoutStyle: 'single-column'
		};
		// Only change scroll
		const partial = { ...DEFAULT_EXPERIENCE, scrollBehavior: 'paged' as const };
		const result = resolveEffectiveExperience(partial);
		expect(result.scrollBehavior).toBe('paged');
		expect(result.videoPlayback).toBe('tap-to-play');
	});

	it('ignores board overrides when not enabled', () => {
		const boardOverrides: BoardExperienceOverrides = {
			enabled: false,
			scrollBehavior: 'infinite',
			layoutStyle: 'compact-grid'
		};
		const result = resolveEffectiveExperience(null, boardOverrides);
		expect(result.scrollBehavior).toBe('load-more');
		expect(result.layoutStyle).toBe('single-column');
	});

	it('applies board overrides when enabled', () => {
		const boardOverrides: BoardExperienceOverrides = {
			enabled: true,
			scrollBehavior: 'infinite',
			layoutStyle: 'compact-grid'
		};
		const result = resolveEffectiveExperience(null, boardOverrides);
		expect(result.scrollBehavior).toBe('infinite');
		expect(result.layoutStyle).toBe('compact-grid');
		// Non-overridden fields stay at defaults
		expect(result.videoPlayback).toBe('tap-to-play');
	});

	it('merges all three layers: defaults → user → board', () => {
		const userPrefs: UserExperiencePreferences = {
			scrollBehavior: 'paged',
			videoPlayback: 'wifi-autoplay',
			feedOrder: 'newest',
			conversationMode: 'hybrid',
			layoutStyle: 'masonry'
		};
		const boardOverrides: BoardExperienceOverrides = {
			enabled: true,
			conversationMode: 'chat',
			layoutStyle: 'single-column'
		};
		const result = resolveEffectiveExperience(userPrefs, boardOverrides);
		expect(result.scrollBehavior).toBe('paged'); // from user
		expect(result.videoPlayback).toBe('wifi-autoplay'); // from user
		expect(result.conversationMode).toBe('chat'); // from board override
		expect(result.layoutStyle).toBe('single-column'); // from board override
	});
});

describe('detectPreset', () => {
	it('detects calm preset', () => {
		const prefs: UserExperiencePreferences = { ...EXPERIENCE_PRESETS.calm };
		expect(detectPreset(prefs)).toBe('calm');
	});

	it('detects balanced preset', () => {
		const prefs: UserExperiencePreferences = { ...EXPERIENCE_PRESETS.balanced };
		expect(detectPreset(prefs)).toBe('balanced');
	});

	it('detects lively preset', () => {
		const prefs: UserExperiencePreferences = { ...EXPERIENCE_PRESETS.lively };
		expect(detectPreset(prefs)).toBe('lively');
	});

	it('returns custom when no preset matches', () => {
		const prefs: UserExperiencePreferences = {
			scrollBehavior: 'infinite',
			videoPlayback: 'tap-to-play',
			feedOrder: 'oldest',
			conversationMode: 'board',
			layoutStyle: 'compact-grid'
		};
		expect(detectPreset(prefs)).toBe('custom');
	});

	it('returns custom when one field differs from all presets', () => {
		const prefs: UserExperiencePreferences = {
			...EXPERIENCE_PRESETS.calm,
			layoutStyle: 'masonry' // differs from calm's single-column
		};
		expect(detectPreset(prefs)).toBe('custom');
	});
});

describe('applyPreset', () => {
	it('returns calm preset settings', () => {
		const result = applyPreset('calm');
		expect(result.scrollBehavior).toBe('load-more');
		expect(result.preset).toBe('calm');
	});

	it('returns balanced preset settings', () => {
		const result = applyPreset('balanced');
		expect(result.scrollBehavior).toBe('paged');
		expect(result.videoPlayback).toBe('wifi-autoplay');
		expect(result.preset).toBe('balanced');
	});

	it('returns lively preset settings', () => {
		const result = applyPreset('lively');
		expect(result.scrollBehavior).toBe('infinite');
		expect(result.videoPlayback).toBe('muted-autoplay');
		expect(result.layoutStyle).toBe('masonry');
		expect(result.preset).toBe('lively');
	});
});
