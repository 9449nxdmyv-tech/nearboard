/**
 * @file firestore.ts
 * @description Firestore document shape interfaces — shared between client,
 *              Cloud Functions, and MCP server. No logic here, types only.
 *
 * Server-side validation: Document shapes are enforced via Firestore security
 * rules (firestore.rules) using hasAll() field checks on create operations for
 * BoardDoc, ContentDoc, and UserDoc. See the create rules for each collection.
 */

import type { Timestamp } from 'firebase/firestore';

// ─── Placeholder stubs — expand in Steps 2–3 ─────────────────────────────────

export type AgeGroup = 'adult' | 'teen';

// ─── Experience Settings ─────────────────────────────────────────────────────

// Const arrays are the single source of truth for allowed values — derive types
// from them and use the arrays for runtime validation (e.g. `.includes(value)`).

export const SCROLL_BEHAVIORS = ['load-more', 'paged', 'infinite'] as const;
export type ScrollBehavior = typeof SCROLL_BEHAVIORS[number];

export const VIDEO_PLAYBACKS = ['tap-to-play', 'wifi-autoplay', 'muted-autoplay', 'full-autoplay'] as const;
export type VideoPlayback = typeof VIDEO_PLAYBACKS[number];

export const FEED_ORDERS = ['newest', 'oldest', 'most-active', 'curated'] as const;
export type FeedOrder = typeof FEED_ORDERS[number];

export const LAYOUT_STYLES = ['single-column', 'masonry', 'compact-grid'] as const;
export type LayoutStyle = typeof LAYOUT_STYLES[number];

export const EXPERIENCE_PRESETS_LIST = ['calm', 'balanced', 'lively', 'custom'] as const;
export type ExperiencePreset = typeof EXPERIENCE_PRESETS_LIST[number];

/** Type guard — checks if a string is a valid ScrollBehavior. */
export function isScrollBehavior(v: unknown): v is ScrollBehavior {
	return typeof v === 'string' && (SCROLL_BEHAVIORS as readonly string[]).includes(v);
}
/** Type guard — checks if a string is a valid VideoPlayback. */
export function isVideoPlayback(v: unknown): v is VideoPlayback {
	return typeof v === 'string' && (VIDEO_PLAYBACKS as readonly string[]).includes(v);
}
/** Type guard — checks if a string is a valid FeedOrder. */
export function isFeedOrder(v: unknown): v is FeedOrder {
	return typeof v === 'string' && (FEED_ORDERS as readonly string[]).includes(v);
}
/** Type guard — checks if a string is a valid LayoutStyle. */
export function isLayoutStyle(v: unknown): v is LayoutStyle {
	return typeof v === 'string' && (LAYOUT_STYLES as readonly string[]).includes(v);
}

export interface UserExperiencePreferences {
	scrollBehavior: ScrollBehavior;
	videoPlayback: VideoPlayback;
	feedOrder: FeedOrder;
	layoutStyle: LayoutStyle;
	preset?: ExperiencePreset;
	updatedAt?: Timestamp;
}

export interface BoardExperienceOverrides {
	enabled: boolean;
	scrollBehavior?: ScrollBehavior;
	videoPlayback?: VideoPlayback;
	feedOrder?: FeedOrder;
	layoutStyle?: LayoutStyle;
	updatedAt?: Timestamp;
}

export interface UserDoc {
	uid: string;
	displayName: string;
	email: string;
	photoURL: string | null;
	birthDate: Timestamp | null;
	ageGroup: AgeGroup;
	createdAt: Timestamp;
	/** UID of the user who referred this user. Null if organic sign-up. */
	referredBy: string | null;
	/** Global feed seen-state tracking. */
	lastSeenAt?: Timestamp;
	/** Set when all onboarding conditions are met (board + invite + card). */
	onboardingCompletedAt?: Timestamp | null;
	/** True if user skipped the invite prompt during onboarding. */
	hasSkippedInvite?: boolean;
	/** IDs of dismissed ambient nudges — each shown at most once. */
	seenNudges?: string[];
	/** IANA timezone string (e.g., 'America/New_York'). Set on sign-in. */
	timezone?: string;
	/** Quiet hours start (hour 0-23). No notifications sent during quiet hours. */
	quietHoursStart?: number;
	/** Quiet hours end (hour 0-23). */
	quietHoursEnd?: number;
	/** Whether daily email digest is enabled. Default true. */
	digestEnabled?: boolean;
	/** Preferred digest send time in 24h format (e.g., '07:30'). Default '07:30'. */
	digestTime?: string;
	/** IANA timezone for digest scheduling (e.g., 'America/New_York'). Falls back to timezone field. */
	digestTimezone?: string;
	/** Timestamp of the last digest email sent (used as cutoff for next digest). */
	lastDigestSentAt?: Timestamp;
	/** IDs of public boards the user follows (read-only access, feed updates). */
	followingBoardIds?: string[];
	/** Number of boards owned by this user (informational — no cap on free tier). */
	ownedBoardCount?: number;
	/** Subscription tier: 'free' or 'plus'. Plus gates voice briefings and manual AI regen. */
	subscriptionTier?: 'free' | 'plus';
	/** Timestamp when Plus subscription started. */
	subscriptionStartedAt?: Timestamp;
	/** User-controlled social experience preferences (global defaults). */
	experiencePreferences?: UserExperiencePreferences;
}

export interface BoardDoc {
	id: string;
	name: string;
	ownerId: string;
	memberIds: string[];
	isPublic: boolean;
	template: BoardTemplate;
	streak: number;
	lastActivityAt: Timestamp;
	createdAt: Timestamp;
	timeCapsuleUnlockAt: Timestamp | null;
	timeCapsuleLocked: boolean;
	coverImageUrl?: string | null;
	pendingInviteCount?: number;
	contentCount?: number;
	/** True for boards auto-created during onboarding (suppresses AI summary until real content). */
	isOnboarding?: boolean;

	// Living Summary (V3 strategy — single intelligence layer)
	livingSummary?: {
		content: string;
		headline: string;
		highlights: string[];
		/** Warm 2-sentence briefing for push notifications, generated in the same AI call as the summary. */
		briefingText: string;
		updatedAt: Timestamp;
		version: number;
		editedByAdmin: boolean;
		/** Hash of content used for caching AI responses */
		cacheKey?: string;
	};
	enableLivingSummary: boolean;
	/** True when content changed since last summary generation. Cleared by processDirtyBoards. */
	summaryDirty?: boolean;
	summaryStyle: 'paragraph' | 'bullets' | 'action-items';
	/** Optional user-provided focus hint for the AI summary (e.g., "focus on budget tracking"). */
	summaryFocus?: string;
	lastRegenerationRequestedAt?: Timestamp;
	allowComments: boolean;
	/** Number of users following this public board (not members). */
	followerCount?: number;
	/** Per-board experience overrides (inherit from user global when disabled). */
	experienceOverrides?: BoardExperienceOverrides;
}

export interface InviteDoc {
	id: string;
	boardId: string;
	inviterId: string;
	contactName: string;
	contactIdentifier: string; // email or phone
	status: 'pending' | 'joined' | 'expired';
	invitedAt: Timestamp;
}

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

export interface JoinRequestDoc {
	id: string;
	boardId: string;
	requesterId: string;
	requesterName: string;
	requesterPhotoURL: string | null;
	status: JoinRequestStatus;
	requestedAt: Timestamp;
	resolvedAt: Timestamp | null;
	resolvedBy: string | null;
}

export interface CommentDoc {
	id: string;
	authorId: string;
	authorName: string;
	authorPhotoURL: string | null;
	text: string;
	createdAt: Timestamp;
	updatedAt?: Timestamp;
}

export interface MemberDoc {
	userId: string;
	displayName: string;
	photoURL: string | null;
	role: 'owner' | 'member' | 'guest';
	joinedAt: Timestamp;
	notificationMode: 'silent' | 'ping' | 'voice';
	lastReadAt: Timestamp;
	lastCommentAt?: Timestamp;
	joinedViaInviteId?: string | null;
	/** If true, this board is excluded from the user's email digest. */
	digestMuted?: boolean;
	/** Heartbeat timestamp written while the board page is open. Drives the presence pulse on AvatarStack. */
	lastViewedAt?: Timestamp;
}

export interface BriefingDoc {
	id: string;
	boardId: string;
	text: string;
	audioUrl: string | null;
	generatedAt: Timestamp;
	// audioUrl populated by Google Cloud TTS (ttsService)
}

export type BoardTemplate =
	| 'household'
	| 'family'
	| 'trip'
	| 'team'
	| 'creative'
	| 'wishlist'
	| 'renovation'
	| 'blank';

// ─── Content documents ────────────────────────────────────────────────────────

export type ContentType = 'note' | 'list' | 'link' | 'product' | 'voice' | 'photo' | 'video' | 'location' | 'poll';

export type ModerationStatus = 'approved' | 'pending' | 'quarantined';

export interface BaseContentDoc {
	id: string;
	boardId: string;
	authorId: string;
	authorName: string;
	authorPhotoURL: string | null;
	type: ContentType;
	moderationStatus: ModerationStatus;
	createdAt: Timestamp;

	// Comment count (V3 Feature)
	commentCount?: number;

	// Private Acknowledgments (V3 Feature)
	acknowledgments?: {
		[userId: string]: {
			type: 'heart';
			createdAt: Timestamp;
		};
	};

	// WhatsApp import provenance
	importedFrom?: {
		source: 'whatsapp';
		originalAuthorName: string;
		originalTimestamp: string; // ISO from parsed chat date
		importedAt: Timestamp;
	};

	// Affiliate monetization fields (V1 strategy)
	isAffiliate?: boolean;
	originalUrl?: string;
	resolvedUrl?: string;
	affiliateProvider?: 'skimlinks' | 'sovrn' | 'amazon' | null;
	affiliateStatus?: 'wrapped' | 'not-eligible' | 'fallback-original' | 'error';

	// Lever 7 (Agent guardrails): Intent-required API
	/** Non-empty description of user's intent for adding this content. Required for all cards. */
	userIntent?: string;
	/** True if content was added by an AI agent/bot (vs. human). For audit purposes. */
	agentAdded?: boolean;
	/** If agentAdded=true, identifies which agent added the content */
	agentId?: string;
}

export interface NoteContentDoc extends BaseContentDoc {
	type: 'note';
	text: string;
}

export interface ListItem {
	id: string;
	text: string;
	completed: boolean;
}

export interface ListContentDoc extends BaseContentDoc {
	type: 'list';
	title: string;
	items: ListItem[];
}

export interface LinkContentDoc extends BaseContentDoc {
	type: 'link';
	url: string;
	title: string;
	description: string | null;
	image: string | null;
	domain: string;
	favicon: string | null;
	/** Structured enrichment data extracted from the page (recipe, movie, book, etc.) */
	enrichment?: import('./api').LinkEnrichment | null;
	/** Reference to /globalContent/{contentHash} for deduplication */
	contentHash?: string;
}

export interface ProductContentDoc extends BaseContentDoc {
	type: 'product';
	url: string;
	title: string;
	description: string | null;
	image: string | null;
	domain: string;
	favicon: string | null;
	enrichment?: import('./api').LinkEnrichment | null;
	contentHash?: string;
	/** Price tracking fields */
	price: string;
	originalPrice: string | null;
	lastCheckedPrice: string | null;
	lastCheckedAt: Timestamp | null;
	priceDrop: boolean;
}

export interface VoiceContentDoc extends BaseContentDoc {
	type: 'voice';
	audioUrl: string;
	durationMs: number;
	/** Auto-generated caption from voice-to-text (Lever 3 — voice-first capture) */
	autoCaption?: string | null;
	/** Source of voice capture: 'manual' | 'siri-shortcut' | 'android-voice-intent' */
	captureSource?: 'manual' | 'siri-shortcut' | 'android-voice-intent';
	/** Timestamp when voice was captured (may differ from createdAt for shortcuts) */
	capturedAt?: Timestamp;
	/** Pre-computed waveform peaks (0–1, ~64 values) — derived from the audio blob at upload.
	 *  Renderers fall back to a deterministic shape when this is missing (legacy notes). */
	waveform?: number[];
}

export interface PollOption {
	id: string;
	text: string;
}

export interface PollContentDoc extends BaseContentDoc {
	type: 'poll';
	question: string;
	options: PollOption[];
}

export interface VoteDoc {
	userId: string;
	optionId: string;
	votedAt: Timestamp;
}

export interface PhotoImage {
	/** Original full-resolution image URL */
	url: string;
	/** Thumbnail URL (150px max dimension) */
	thumbnailUrl?: string;
	/** Medium URL (600px max dimension) */
	mediumUrl?: string;
	/** Large URL (1200px max dimension) */
	largeUrl?: string;
	width: number;
	height: number;
}

export interface PhotoContentDoc extends BaseContentDoc {
	type: 'photo';
	/** Primary image (always present for backward compat) */
	imageUrl: string;
	/** All images (1–5). First element matches imageUrl. */
	images: PhotoImage[];
	caption: string | null;
	width: number;
	height: number;
}

export interface VideoContentDoc extends BaseContentDoc {
	type: 'video';
	videoUrl: string;
	thumbnailUrl: string | null;
	durationMs: number;
	caption: string | null;
}

export interface LocationContentDoc extends BaseContentDoc {
	type: 'location';
	latitude: number;
	longitude: number;
	address: string;
	name: string | null;
}

export type ContentDoc =
	| NoteContentDoc
	| ListContentDoc
	| LinkContentDoc
	| ProductContentDoc
	| VoiceContentDoc
	| PollContentDoc
	| PhotoContentDoc
	| VideoContentDoc
	| LocationContentDoc;

export interface WrappedDoc {
	boardId: string;
	year: number;
	itemsAdded: number;
	productsSaved: number;
	voiceNotesRecorded: number;
	mostActiveMember: { uid: string; name: string; count: number };
	longestStreak: number;
	narrative: string;
	generatedAt: Timestamp;
}

export interface TemplateDoc {
	id: string;
	name: string;
	description: string;
	category: BoardTemplate;
	creatorId: string;
	creatorName: string;
	sections: TemplateSectionDoc[];
	cloneCount: number;
	createdAt: Timestamp;
	/** True for officially curated marketplace templates */
	isCurated?: boolean;
}

export interface TemplateSectionDoc {
	title: string;
	contentType: ContentType;
	placeholder: string;
	// Link/product fields (curated templates)
	url?: string;
	description?: string | null;
	image?: string | null;
	domain?: string;
	favicon?: string | null;
	price?: string;
	originalPrice?: string | null;
	// List items (curated templates)
	items?: { id: string; text: string; completed: boolean }[];
}

export interface AssistantMessageDoc {
	role: 'user' | 'assistant';
	text: string;
	createdAt: Timestamp;
}

export interface PriceHistoryEntry {
	price: string;
	checkedAt: Timestamp;
}

export interface PriceHistoryDoc {
	productUrl: string;
	boardId: string;
	contentId: string;
	entries: PriceHistoryEntry[];
	priceDrop?: boolean;
	lastCheckedAt?: Timestamp;
}

// ─── Global Content Cache ─────────────────────────────────────────────────────

// ─── On This Day memories ────────────────────────────────────────────────────

export interface MemoryItem {
	contentId: string;
	boardId: string;
	boardName: string;
	type: string;
	title: string;
	imageUrl: string | null;
	authorName: string;
	originalDate: Timestamp;
}

export interface MemoryDoc {
	userId: string;
	date: string; // YYYY-MM-DD
	items: MemoryItem[];
	daysAgo: number; // 7, 30, or 365
	label: string; // "1 week ago", "1 month ago", "1 year ago"
	createdAt: Timestamp;
}

// ─── Global content cache ────────────────────────────────────────────────────

export interface GlobalContentDoc {
	/** SHA-256 hex digest of the normalized URL (= Firestore doc ID) */
	contentHash: string;
	/** Normalized canonical URL */
	url: string;
	/** Content type that created this cache entry */
	type: 'link' | 'product';
	/** OG metadata */
	title: string;
	description: string | null;
	image: string | null;
	domain: string;
	favicon: string | null;
	/** Structured enrichment data (recipe, movie, book, etc.) — links only */
	enrichment?: import('./api').LinkEnrichment | null;
	/** Product-specific fields */
	price?: string | null;
	originalPrice?: string | null;
	/** How many times this URL has been saved across all boards */
	saveCount: number;
	/** When enrichment was last fetched/refreshed */
	enrichedAt: Timestamp;
	/** When this cache entry was first created */
	createdAt: Timestamp;
}
