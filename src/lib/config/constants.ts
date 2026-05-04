/**
 * @file constants.ts
 * @description App-wide constants. Import from here — never inline magic numbers.
 */

/** AI briefing debounce window after a Firestore write (ms) */
export const BRIEFING_DEBOUNCE_MS = 60_000;

/** Max briefing word count (Claude prompt constraint) */
export const BRIEFING_MAX_WORDS = 40;

/** Board content page size for cursor-based queries */
export const CONTENT_PAGE_SIZE = 50;

/** FAB radial menu item count */
export const FAB_ITEM_COUNT = 6;

/** Max poll options per card */
export const POLL_MAX_OPTIONS = 4;

/** Max photos per photo card */
export const MAX_PHOTOS_PER_CARD = 5;

/** Max video duration (ms) — 30 seconds */
export const MAX_VIDEO_DURATION_MS = 30_000;

/** Max video file size (bytes) — 50 MB */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** localStorage key for pending referral code */
export const REFERRAL_STORAGE_KEY = 'nearboard_referredBy';

/** Minimum age for account creation */
export const MIN_AGE = 13;

/** Teen age upper bound (exclusive) — 13–17 are teens */
export const ADULT_AGE = 18;

/** Max pending join requests per user per board */
export const MAX_PENDING_JOIN_REQUESTS_PER_USER = 1;

/** Streak reset hour in local time (midnight) */
export const STREAK_RESET_HOUR = 0;

/** Morning digest scheduled hour in local time */
export const MORNING_DIGEST_HOUR = 8;

/** Default daily email digest send time (24h format) */
export const DEFAULT_DIGEST_TIME = '07:30';

/** Default daily email digest enabled state */
export const DEFAULT_DIGEST_ENABLED = true;

/** MCP token rotation interval (days) */
export const MCP_TOKEN_ROTATION_DAYS = 30;

/** WhatsApp import: max text file size (bytes) */
export const WHATSAPP_IMPORT_MAX_TXT_BYTES = 50 * 1024 * 1024; // 50 MB
/** WhatsApp import: minimum message text length for inclusion */
export const WHATSAPP_IMPORT_MIN_MSG_LENGTH = 15;
/** WhatsApp import: messages per LLM classification chunk */
export const WHATSAPP_IMPORT_LLM_CHUNK_SIZE = 30;
/** WhatsApp import: max cards allowed per import */
export const WHATSAPP_IMPORT_MAX_CARDS = 200;
/** WhatsApp import: only process messages from last N days */
export const WHATSAPP_IMPORT_RECENCY_DAYS = 30;

// ─── Experience Settings ─────────────────────────────────────────────────────

import type { UserExperiencePreferences } from '$lib/types/firestore';

/** System default experience — calm, intentional, human-centered. */
export const DEFAULT_EXPERIENCE: UserExperiencePreferences = {
	scrollBehavior: 'load-more',
	videoPlayback: 'tap-to-play',
	feedOrder: 'newest',
	commentLayout: 'inline',
	layoutStyle: 'single-column',
	preset: 'calm'
};

/** Preset definitions for quick experience selection. */
export const EXPERIENCE_PRESETS: Record<'calm' | 'balanced' | 'lively', Omit<UserExperiencePreferences, 'preset' | 'updatedAt'>> = {
	calm: {
		scrollBehavior: 'load-more',
		videoPlayback: 'tap-to-play',
		feedOrder: 'newest',
		commentLayout: 'inline',
		layoutStyle: 'single-column'
	},
	balanced: {
		scrollBehavior: 'paged',
		videoPlayback: 'wifi-autoplay',
		feedOrder: 'most-active',
		commentLayout: 'inline',
		layoutStyle: 'single-column'
	},
	lively: {
		scrollBehavior: 'infinite',
		videoPlayback: 'muted-autoplay',
		feedOrder: 'most-active',
		commentLayout: 'chat',
		layoutStyle: 'masonry'
	}
};

/** Content types for board items */
export const CONTENT_TYPES = {
	NOTE: 'note',
	LIST: 'list',
	LINK: 'link',
	PRODUCT: 'product',
	VOICE: 'voice',
	PHOTO: 'photo',
	VIDEO: 'video',
	POLL: 'poll',
	LOCATION: 'location'
} as const;

export type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

/** Main tab navigation items */
export const TAB_ITEMS: { href: string; icon: string; iconActive: string; label: string }[] = [
	{ href: '/', icon: 'ph:house', iconActive: 'ph:house-fill', label: 'Home' },
	{ href: '/feed', icon: 'ph:globe', iconActive: 'ph:globe-hemisphere-west-fill', label: 'Feed' },
	{ href: '/people', icon: 'ph:users-three', iconActive: 'ph:users-three-fill', label: 'Friends' },
	{ href: '/profile', icon: 'ph:user', iconActive: 'ph:user-fill', label: 'Profile' }
];

import type { FABMenuItemType } from '$lib/types/ui';

/** Metadata for FAB radial menu and quick switcher */
export const FAB_MENU_ITEMS: { type: FABMenuItemType; icon: string; label: string; hint: string }[] = [
	{ type: 'note', icon: 'ph:note-pencil', label: 'Note', hint: 'Quick thought' },
	{ type: 'voice', icon: 'ph:microphone', label: 'Voice', hint: 'Record audio' },
	{ type: 'photo', icon: 'ph:camera', label: 'Photo', hint: 'Up to 5 photos' },
	{ type: 'video', icon: 'ph:video-camera', label: 'Video', hint: '30s clip' },
	{ type: 'link', icon: 'ph:link', label: 'Link', hint: 'Save a URL' },
	{ type: 'list', icon: 'ph:list-checks', label: 'List', hint: 'Checklist' },
	{ type: 'poll', icon: 'ph:chart-bar', label: 'Poll', hint: 'Ask & vote' },
	{ type: 'location', icon: 'ph:map-pin', label: 'Location', hint: 'Pin a place' }
];
