/**
 * @file onboardingUtils.ts
 * @description Intent mappings, board name inference, example cards, and nudge logic
 *              for the post-signup onboarding flow.
 */

import type { BoardTemplate } from '$lib/types';

// ─── Intent Types & Mappings ─────────────────────────────────────────────────

export type OnboardingIntent = 'home' | 'trip' | 'event' | 'work' | 'family' | 'other';

export interface IntentOption {
	key: OnboardingIntent;
	icon: string;
	label: string;
}

export const INTENT_OPTIONS: IntentOption[] = [
	{ key: 'home', icon: 'ph:house', label: 'Home project' },
	{ key: 'trip', icon: 'ph:suitcase-rolling', label: 'Trip planning' },
	{ key: 'event', icon: 'ph:confetti', label: 'Event / Party' },
	{ key: 'work', icon: 'ph:briefcase', label: 'Work project' },
	{ key: 'family', icon: 'ph:users-three', label: 'Family stuff' },
	{ key: 'other', icon: 'ph:package', label: 'Something else' }
];

export const INTENT_BOARD_NAMES: Record<OnboardingIntent, string> = {
	home: 'Our Home Project',
	trip: 'Trip Planning',
	event: 'Event Planning',
	work: 'Work Project',
	family: 'Family Board',
	other: 'My First Board'
};

export const INTENT_TEMPLATES: Record<OnboardingIntent, BoardTemplate> = {
	home: 'household',
	trip: 'trip',
	event: 'blank',
	work: 'team',
	family: 'family',
	other: 'blank'
};

// ─── Example Cards ───────────────────────────────────────────────────────────

interface ExampleCard {
	type: 'note';
	text: string;
}

export const INTENT_EXAMPLE_CARDS: Record<OnboardingIntent, ExampleCard[]> = {
	home: [
		{ type: 'note', text: 'Ideas we\'re considering — styles, materials, inspiration.' },
		{ type: 'note', text: 'Budget notes — quotes and cost estimates.' },
		{ type: 'note', text: 'Contacts — contractors, suppliers, and anyone helping out.' }
	],
	trip: [
		{ type: 'note', text: 'Where we want to go — destinations, links, and inspo.' },
		{ type: 'note', text: 'Dates to consider — potential travel windows.' },
		{ type: 'note', text: 'Packing list — we\'ll fill this in as we get closer.' }
	],
	event: [
		{ type: 'note', text: 'Guest list — who\'s coming and RSVPs.' },
		{ type: 'note', text: 'Venue & logistics — location, timing, setup.' },
		{ type: 'note', text: 'Food & drinks — menu ideas and dietary notes.' }
	],
	work: [
		{ type: 'note', text: 'Key decisions — things we need to align on.' },
		{ type: 'note', text: 'Resources & links — docs, tools, references.' },
		{ type: 'note', text: 'Action items — who\'s doing what, by when.' }
	],
	family: [
		{ type: 'note', text: 'Upcoming plans — events, trips, and get-togethers.' },
		{ type: 'note', text: 'Shared list — groceries, errands, household tasks.' },
		{ type: 'note', text: 'Memories — photos, moments, and things to remember.' }
	],
	other: [
		{ type: 'note', text: 'Ideas — drop anything interesting here.' },
		{ type: 'note', text: 'Links — save articles, videos, and references.' },
		{ type: 'note', text: 'Notes — quick thoughts and reminders.' }
	]
};

export const SEED_SUMMARY = {
	content: 'Just getting started. Add links, photos, and notes — the summary will update as your board grows.',
	headline: 'New board — add your first item to get started',
	highlights: [] as string[],
	version: 0,
	editedByAdmin: true
};

// ─── Board Name Inference (Path B — Share Extension) ─────────────────────────

const DOMAIN_BOARD_NAMES: Record<string, string> = {
	'zillow.com': 'House Search',
	'realtor.com': 'House Search',
	'redfin.com': 'House Search',
	'trulia.com': 'House Search',
	'rightmove.co.uk': 'House Search',
	'maps.google.com': 'Places to Visit',
	'google.com/maps': 'Places to Visit',
	'tripadvisor.com': 'Places to Visit',
	'yelp.com': 'Places to Visit',
	'youtube.com': 'Watch List',
	'youtu.be': 'Watch List',
	'vimeo.com': 'Watch List',
	'tiktok.com': 'Watch List',
	'netflix.com': 'Watch List',
	'amazon.com': 'Shopping Ideas',
	'ebay.com': 'Shopping Ideas',
	'etsy.com': 'Shopping Ideas',
	'walmart.com': 'Shopping Ideas',
	'target.com': 'Shopping Ideas',
	'pinterest.com': 'Inspiration Board',
	'instagram.com': 'Inspiration Board',
	'airbnb.com': 'Trip Planning',
	'booking.com': 'Trip Planning',
	'skyscanner.com': 'Trip Planning',
	'kayak.com': 'Trip Planning',
	'allrecipes.com': 'Recipes',
	'food52.com': 'Recipes',
	'seriouseats.com': 'Recipes'
};

/**
 * Infers a board name from a shared URL's domain.
 * Falls back to 'My First Board' for unknown domains.
 */
export function inferBoardNameFromContent(url: string): string {
	try {
		const hostname = new URL(url).hostname.replace(/^www\./, '');
		for (const [domain, name] of Object.entries(DOMAIN_BOARD_NAMES)) {
			if (hostname.endsWith(domain) || hostname === domain) return name;
		}
	} catch { /* invalid URL */ }
	return 'My First Board';
}

// ─── Ambient Nudges ──────────────────────────────────────────────────────────

export type NudgeId = 'share-tip' | 'invite-tip' | 'summary-coming' | 'invite-reminder';

export interface NudgeConfig {
	id: NudgeId;
	text: string;
	/** If present, renders as a tappable action link. */
	action?: { label: string; type: 'invite' };
}

const NUDGE_DEFINITIONS: NudgeConfig[] = [
	{
		id: 'share-tip',
		text: 'Tip: Next time you find something, use the Share button in any app to add it here instantly.'
	},
	{
		id: 'invite-tip',
		text: 'This board is just you right now. Add someone to make it shared.',
		action: { label: 'Invite someone', type: 'invite' }
	},
	{
		id: 'summary-coming',
		text: 'Your board is filling up. A summary will appear soon to keep everyone on the same page.'
	},
	{
		id: 'invite-reminder',
		text: 'Ready to share this board?',
		action: { label: 'Invite someone', type: 'invite' }
	}
];

interface NudgeContext {
	realCardCount: number;
	memberCount: number;
	hasSkippedInvite: boolean;
	seenNudges: string[];
	hasAiSummary: boolean;
}

/**
 * Returns the single most relevant nudge for the current board state,
 * or null if none apply. Each nudge is shown at most once (tracked via seenNudges).
 */
export function getNudgeToShow(ctx: NudgeContext): NudgeConfig | null {
	const { realCardCount, memberCount, hasSkippedInvite, seenNudges, hasAiSummary } = ctx;
	const seen = new Set(seenNudges);

	const candidates: NudgeId[] = [];

	if (realCardCount < 3 && !seen.has('share-tip')) candidates.push('share-tip');
	if (memberCount <= 1 && !seen.has('invite-tip')) candidates.push('invite-tip');
	if (realCardCount >= 5 && !hasAiSummary && !seen.has('summary-coming')) candidates.push('summary-coming');
	if (hasSkippedInvite && !seen.has('invite-reminder')) candidates.push('invite-reminder');

	if (candidates.length === 0) return null;
	return NUDGE_DEFINITIONS.find((n) => n.id === candidates[0]) ?? null;
}
