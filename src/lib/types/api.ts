/**
 * @file api.ts
 * @description Types for external API request/response shapes.
 *              Used by claudeService, ttsService, ogExtractor, priceWatcher.
 */

// Import enrichment types from functions (shared types)
// These are duplicated here for client-side use since we can't import from functions
// ─── Smart card enrichment data ──────────────────────────────────────────────

/** Structured recipe data extracted from JSON-LD / page markup */
export interface RecipeEnrichment {
	kind: 'recipe';
	cookTime: string | null;
	prepTime: string | null;
	totalTime: string | null;
	servings: string | null;
	ingredients: string[];
	instructions: string[];
	cuisine: string | null;
	calories: string | null;
}

/** Structured movie/TV data extracted from JSON-LD / page markup */
export interface MovieEnrichment {
	kind: 'movie';
	director: string | null;
	year: number | null;
	runtime: string | null;
	genre: string | null;
	rating: string | null;
	ratingSource: string | null;
	cast: string[];
	contentRating: string | null;
}

/** Structured book data extracted from JSON-LD / page markup */
export interface BookEnrichment {
	kind: 'book';
	author: string | null;
	genre: string | null;
	pageCount: number | null;
	isbn: string | null;
	publisher: string | null;
	publishDate: string | null;
	averageRating: string | null;
}

/** Structured place/restaurant data extracted from JSON-LD / page markup */
export interface PlaceEnrichment {
	kind: 'place';
	address: string | null;
	phone: string | null;
	priceRange: string | null;
	category: string | null;
	rating: string | null;
	ratingCount: number | null;
	latitude: number | null;
	longitude: number | null;
	hours: string | null;
}

/** Structured music/audio data */
export interface MusicEnrichment {
	kind: 'music';
	artist: string | null;
	album: string | null;
	duration: string | null;
	genre: string | null;
}

/** Structured article data */
export interface ArticleEnrichment {
	kind: 'article';
	author: string | null;
	publishedDate: string | null;
	readingTime: string | null;
	siteName: string | null;
	/** Full article body text extracted from JSON-LD articleBody */
	bodyText?: string | null;
	/** Structured article content HTML extracted via Readability */
	contentHtml?: string | null;
}

/** Structured GitHub/GitLab repository data */
export interface GithubEnrichment {
	kind: 'github';
	owner: string | null;
	repo: string | null;
	description: string | null;
	language: string | null;
	stars: string | null;
	forks: string | null;
}

/** Structured video data (YouTube, Vimeo, etc.) */
export interface VideoEnrichment {
	kind: 'video';
	author: string | null;
	publishedDate: string | null;
	duration: string | null;
	views: string | null;
	siteName: string | null;
}

/** Union of all enrichment types */
export type LinkEnrichment =
	| RecipeEnrichment
	| MovieEnrichment
	| BookEnrichment
	| PlaceEnrichment
	| MusicEnrichment
	| ArticleEnrichment
	| GithubEnrichment
	| VideoEnrichment;

/** AI-powered content classification */
export interface ContentClassification {
	category: 'recipe' | 'product' | 'article' | 'video' | 'music' | 'book' | 'movie' | 'place' | 'github' | 'other';
	tags: string[];
	summary: string;
	sentiment?: 'positive' | 'neutral' | 'negative';
}

/** Social proof metrics */
export interface SocialMetrics {
	shares?: {
		facebook?: number;
		twitter?: number;
		linkedin?: number;
		pinterest?: number;
	};
	comments?: number;
	likes?: number;
}

/** Page metadata extracted by the browser extension content script and ogExtractor */
export interface PageMetadata {
	title: string;
	image: string | null;
	description: string | null;
	url: string;
	price: string | null;
	type: 'article' | 'product' | 'video' | 'link';
	youtubeId?: string | null;
	enrichment?: LinkEnrichment | null;
	// New enrichment fields
	screenshotUrl?: string | null;
	logoUrl?: string | null;
	classification?: ContentClassification | null;
	socialMetrics?: SocialMetrics | null;
	videoDuration?: string | null;
	siteName?: string | null;
}

/** Input for generating an AI briefing from board changes */
export interface BriefingRequest {
	boardName: string;
	memberNames: string;
	changesDiff: string;
}

/** Output from the AI briefing generation */
export interface BriefingResponse {
	text: string;
	audioUrl: string | null;
}

/** Input for ElevenLabs text-to-speech */
export interface ElevenLabsRequest {
	text: string;
	voiceId?: string;
}

/** Result from a price check on a tracked product */
export interface PriceWatchResult {
	productUrl: string;
	currentPrice: string | null;
	previousPrice: string;
	priceDrop: boolean;
}

/** Request body for /api/route-board */
export interface RouteBoardRequest {
	content: string;
	boards: Array<{ id: string; name: string; summary: string }>;
}

/** Response from /api/route-board */
export interface RouteBoardResponse {
	boardId: string;
	confidence: 'high' | 'medium';
}
