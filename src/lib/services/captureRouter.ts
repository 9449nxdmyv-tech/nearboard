/**
 * @file captureRouter.ts
 * @description Unified Smart Capture Router — decides which board incoming content
 *              belongs to and what content type it is. Pure functions with no
 *              Firestore reads or store imports. All data is injected.
 *
 * Decision tiers (short-circuit cascade):
 *   T1: Active board context (user is viewing a board) → exact
 *   T2: Single board user → exact
 *   T3: Keyword match on Living Summaries → high/medium
 *   T4: AI classification via /api/route-board → high/medium (async, external)
 *   T5: Fallback to last-used or correction-weighted board → low
 */

import { detectContentType, type ContentDetectionResult } from '$lib/utils/contentDetection';
import type { ContentType } from '$lib/utils/contentDetection';
import { classifyLink, getLinkRoutingBoosts } from '$lib/utils/linkClassifier';
import { typeMatchScore, keywordOverlapScore } from '$lib/utils/boardProfiler';
import type { ContentType as RouterContentType } from '$lib/utils/boardProfiler';
import { scrubPII } from '$lib/utils/piiScrubber';
import type { DetectionSignal } from '$lib/utils/contentDetection';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RouteConfidence = 'exact' | 'high' | 'medium' | 'low';

export interface RouteResult {
	boardId: string;
	confidence: RouteConfidence;
	contentType: ContentType;
	contentDetection?: ContentDetectionResult;
	linkClassification?: import('$lib/utils/linkClassifier').LinkClassification;
	reason: string;
	alternatives: Array<{ boardId: string; reason: string }>;
}

export interface BoardSummary {
	id: string;
	name: string;
	summary: string | null;
	/** Board content profile (dominant types, keywords, domain hints) */
	profile?: import('$lib/utils/boardProfiler').BoardProfile;
}

export interface RouteCaptureInput {
	/** Raw content text (URL, note text, shared text, etc.) */
	content: string;
	/** Board the user is currently viewing (null if on home/global) */
	activeBoardId: string | null;
	/** All boards the user is a member of, with names and Living Summaries */
	boards: BoardSummary[];
	/** Last board the user posted to (from localStorage) */
	lastUsedBoardId: string | null;
	/** Correction history — maps boardId → override count */
	corrections: Record<string, number>;
}

/** Callback for T4 AI classification. Injected by caller. */
export type AIClassifyFn = (
	scrubbedContent: string,
	boards: Array<{ id: string; name: string; summary: string }>
) => Promise<{ boardId: string; confidence: 'high' | 'medium' } | null>;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum keyword score to consider a board a match */
const MIN_KEYWORD_SCORE = 1;

/** Max boards before we skip AI (too expensive / slow) */
const MAX_BOARDS_FOR_AI = 10;

/** Words too common to be useful for matching */
const STOP_WORDS = new Set([
	'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
	'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
	'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
	'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
	'before', 'after', 'above', 'below', 'between', 'out', 'off', 'up',
	'down', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
	'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
	'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
	'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
	'about', 'also', 'and', 'but', 'or', 'if', 'it', 'its', 'this',
	'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
	'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what',
	'which', 'who', 'whom'
]);

// ─── Sync Router (T1–T3, T5) ─────────────────────────────────────────────────

/**
 * Synchronous routing — resolves instantly for most cases.
 * Returns a RouteResult if a decision can be made, or `'needs-ai'` if T4 is warranted.
 */
export function routeCapture(input: RouteCaptureInput): RouteResult | 'needs-ai' | null {
	const detectionResult = detectContentType(input.content.trim());
	const contentType = detectionResult.type;
	
	// Classify link content for better routing (works for link/article types)
	let linkClassification: import('$lib/utils/linkClassifier').LinkClassification | undefined;
	if (contentType === 'link' || contentType === 'article') {
		linkClassification = classifyLink(input.content.trim());
	}

	// T1: User is inside a board — that board wins
	if (input.activeBoardId) {
		const board = input.boards.find((b) => b.id === input.activeBoardId);
		if (board) {
			return {
				boardId: board.id,
				confidence: 'exact',
				contentType,
				contentDetection: detectionResult,
				linkClassification,
				reason: "You're on this board",
				alternatives: []
			};
		}
	}

	// T2: User has only one board
	if (input.boards.length === 1) {
		return {
			boardId: input.boards[0].id,
			confidence: 'exact',
			contentType,
			contentDetection: detectionResult,
			linkClassification,
			reason: 'Your only board',
			alternatives: []
		};
	}

	// No boards at all — nothing to route to
	if (input.boards.length === 0) {
		return null;
	}

	// T3: Keyword match on Living Summaries + board names
	const trimmed = input.content.trim();
	if (trimmed) {
		const keywordResult = matchByKeywords(
			trimmed,
			input.boards,
			contentType,
			input.corrections,
			detectionResult.signals,
			linkClassification
		);
		if (keywordResult) {
			keywordResult.contentDetection = detectionResult;
			keywordResult.linkClassification = linkClassification;
			return keywordResult;
		}
	}

	// Check if AI is warranted
	const boardsWithSummaries = input.boards.filter((b) => b.summary);
	if (
		trimmed.length > 0 &&
		input.boards.length >= 2 &&
		input.boards.length <= MAX_BOARDS_FOR_AI &&
		boardsWithSummaries.length > 0
	) {
		return 'needs-ai';
	}

	// T5: Fallback — correction-weighted, then last-used, then first board
	return fallback(input, contentType, detectionResult, linkClassification);
}

/**
 * Async routing — calls T4 AI classification when sync routing is inconclusive.
 * Falls back to T5 if AI fails or returns null.
 */
export async function routeCaptureWithAI(
	input: RouteCaptureInput,
	aiClassify: AIClassifyFn
): Promise<RouteResult> {
	const detectionResult = detectContentType(input.content.trim());
	const contentType = detectionResult.type;
	
	// Classify link content for better routing
	let linkClassification: import('$lib/utils/linkClassifier').LinkClassification | undefined;
	if (contentType === 'link' || contentType === 'article') {
		linkClassification = classifyLink(input.content.trim());
	}

	// Prepare boards with summaries for AI
	const boardsForAI = input.boards
		.filter((b) => b.summary)
		.map((b) => ({ id: b.id, name: b.name, summary: b.summary! }));

	if (boardsForAI.length === 0) {
		return fallback(input, contentType, detectionResult, linkClassification);
	}

	try {
		const scrubbedContent = scrubPII(input.content.trim());
		const aiResult = await aiClassify(scrubbedContent, boardsForAI);

		if (aiResult && input.boards.some((b) => b.id === aiResult.boardId)) {
			const board = input.boards.find((b) => b.id === aiResult.boardId)!;
			const alternatives = input.boards
				.filter((b) => b.id !== aiResult.boardId)
				.slice(0, 2)
				.map((b) => ({ boardId: b.id, reason: b.name }));

			return {
				boardId: aiResult.boardId,
				confidence: aiResult.confidence,
				contentType,
				contentDetection: detectionResult,
				linkClassification,
				reason: `Matches "${board.name}" topic`,
				alternatives
			};
		}
	} catch {
		// AI failed — fall through to T5
	}

	return fallback(input, contentType, detectionResult, linkClassification);
}

// ─── Keyword Matching (T3) ───────────────────────────────────────────────────

interface ScoredBoard {
	board: BoardSummary;
	score: number;
}

/**
 * Get keywords associated with a content type for board matching.
 * These help route content to type-appropriate boards.
 */
function getTypeKeywords(contentType: ContentType): string[] {
	switch (contentType) {
		case 'recipe':
			return ['recipe', 'cooking', 'food', 'cook', 'kitchen', 'meal', 'dish'];
		case 'movie':
			return ['movie', 'film', 'cinema', 'watch', 'netflix', 'imdb', 'tv', 'series', 'show'];
		case 'book':
			return ['book', 'read', 'reading', 'author', 'novel', 'goodreads', 'library'];
		case 'place':
			return ['place', 'restaurant', 'location', 'visit', 'travel', 'yelp', 'hotel', 'cafe'];
		case 'music':
			return ['music', 'song', 'album', 'artist', 'spotify', 'listen', 'track'];
		case 'article':
			return ['article', 'news', 'blog', 'post', 'read', 'story', 'medium', 'substack'];
		case 'github':
			return ['github', 'code', 'repo', 'repository', 'git', 'programming', 'developer', 'dev'];
		case 'product':
			return [
				'product', 'shop', 'shopping', 'buy', 'store', 'price', 'deal', 'deals',
				'wishlist', 'gift', 'gifts', 'wants', 'purchase', 'wardrobe', 'closet',
				'amazon', 'etsy', 'ebay'
			];
		case 'video':
			return ['video', 'youtube', 'watch', 'vimeo', 'tiktok', 'clip'];
		case 'image':
			return ['image', 'photo', 'picture', 'img', 'gallery'];
		case 'list':
			return ['list', 'todo', 'tasks', 'checklist'];
		case 'location':
			return ['location', 'map', 'place', 'address', 'coordinates'];
		case 'note':
		case 'link':
		default:
			return [];
	}
}

function matchByKeywords(
	content: string,
	boards: BoardSummary[],
	contentType: ContentType,
	corrections: Record<string, number>,
	detectionSignals?: DetectionSignal[],
	linkClassification?: import('$lib/utils/linkClassifier').LinkClassification
): RouteResult | null {
	const contentWords = extractKeywords(content);
	if (contentWords.length === 0 && !detectionSignals && !linkClassification) return null;

	// Type-specific keywords to boost matching
	const typeKeywords = getTypeKeywords(contentType);

	// Link classification routing boosts
	const linkBoosts = linkClassification ? getLinkRoutingBoosts(linkClassification) : null;

	const scored: ScoredBoard[] = boards.map((board) => {
		const target = `${board.name} ${board.summary ?? ''}`.toLowerCase();
		let score = 0;

		// ── Board content profile signal ────────────────────────────────
		if (board.profile) {
			// Type match: does this board typically receive this content type?
			const typeBoost = typeMatchScore(board.profile, contentType as RouterContentType);
			score += typeBoost; // 0-3 points

			// Keyword overlap: do the content words appear in the board's profile?
			const keywordOverlap = keywordOverlapScore(board.profile, content);
			score += Math.min(keywordOverlap * 0.5, 4); // Up to 4 points

			// Domain match: does the board have links from this domain?
			if (detectionSignals) {
				for (const signal of detectionSignals) {
					if (signal.type === 'domain_match' && signal.metadata?.domain) {
						const domain = String(signal.metadata.domain);
						const domainBase = domain.split('.')[0];
						if (board.profile.domainHints.some(d => d.includes(domainBase) || domain.includes(d))) {
							score += 3; // Strong signal: board has received content from this domain
						}
					}
				}
			}
		}

		// Boost if board summary/name mentions the content type
		for (const typeKeyword of typeKeywords) {
			if (target.includes(typeKeyword.toLowerCase())) {
				score += 3; // Strong boost for type matching
			}
		}

		// Boost from link classification (tutorial → learning boards, etc.)
		if (linkBoosts) {
			for (const hint of linkBoosts.boardTypeHints) {
				if (target.includes(hint.toLowerCase())) {
					score += 4; // Very strong boost for purpose matching
				}
			}
			for (const keyword of linkBoosts.keywords) {
				if (target.includes(keyword.toLowerCase())) {
					score += 2;
				}
			}
		}

		// Standard keyword matching
		for (const word of contentWords) {
			// Exact word boundary match scores higher
			const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
			if (wordRe.test(target)) {
				score += 2;
			} else if (target.includes(word)) {
				score += 1;
			}
		}

		// Boost from detection signals (domain matches, etc.)
		if (detectionSignals) {
			for (const signal of detectionSignals) {
				if (signal.type === 'domain_match' && signal.metadata?.domain) {
					const domain = String(signal.metadata.domain);
					if (target.includes(domain.split('.')[0])) {
						score += 2; // Boost if board mentions the domain
					}
				}
			}
		}

		// Boost from correction history (user tends to pick this board)
		const correctionBoost = corrections[board.id] ?? 0;
		score += Math.min(correctionBoost, 3); // Cap boost at 3

		return { board, score };
	});

	scored.sort((a, b) => b.score - a.score);

	const best = scored[0];
	const second = scored[1];

	if (best.score < MIN_KEYWORD_SCORE) return null;

	const gap = best.score - (second?.score ?? 0);
	const confidence: RouteConfidence = gap >= 3 ? 'high' : 'medium';

	const alternatives = scored
		.slice(1, 3)
		.filter((s) => s.score > 0)
		.map((s) => ({ boardId: s.board.id, reason: s.board.name }));

	return {
		boardId: best.board.id,
		confidence,
		contentType,
		reason: `Matches "${best.board.name}" topic`,
		alternatives
	};
}

function extractKeywords(text: string): string[] {
	// Extract meaningful words from URLs (domain segments, path segments)
	const urlKeywords: string[] = [];
	const urlRe = /https?:\/\/([^\s]+)/g;
	let urlMatch: RegExpExecArray | null;
	while ((urlMatch = urlRe.exec(text)) !== null) {
		const raw = urlMatch[1];
		const urlPart = raw
			.replace(/^www\./, '')
			.replace(/\.[a-z]{2,6}(\/|$)/, ' ') // strip TLD
			.replace(/[/?&#=_\-+.]+/g, ' ');
		for (const seg of urlPart.split(/\s+/)) {
			const cleaned = seg.toLowerCase();
			// Skip common URL noise and very short segments
			if (seg.length >= 3 && !STOP_WORDS.has(cleaned) && !isUrlNoise(cleaned)) {
				urlKeywords.push(cleaned);
			}
		}
	}

	// Also extract from plain text (strip full URLs first to avoid duplication)
	const cleaned = text.replace(/https?:\/\/[^\s]+/g, '');
	const textKeywords = cleaned
		.toLowerCase()
		.split(/[^a-z0-9áéíóúüñ]+/)
		.filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !isUrlNoise(w));

	return [...textKeywords, ...urlKeywords];
}

/** Filter out common URL noise that isn't useful for matching */
function isUrlNoise(word: string): boolean {
	const noise = new Set([
		'http', 'https', 'www', 'com', 'org', 'net', 'io', 'co', 'uk', 'de',
		'fr', 'es', 'it', 'ca', 'jp', 'au', 'br', 'mx', 'nl', 'se', 'pl',
		'html', 'htm', 'php', 'aspx', 'jsp', 'cgi', 'index', 'home',
		'dp', 'gp', 'ref', 'utm', 'source', 'medium', 'campaign', 'fbclid',
		'share', 'shared', 'share-target', 'product', 'products', 'item',
		'watch', 'video', 'photo', 'image', 'link', 'url'
	]);
	return noise.has(word) || /^\d{3,}$/.test(word); // Skip pure numbers 3+ digits
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Fallback (T5) ──────────────────────────────────────────────────────────

function fallback(
	input: RouteCaptureInput,
	contentType: ContentType,
	detectionResult?: ContentDetectionResult,
	linkClassification?: import('$lib/utils/linkClassifier').LinkClassification
): RouteResult {
	// Pick the board with the most corrections (user preference signal)
	const correctionEntries = Object.entries(input.corrections)
		.filter(([id]) => input.boards.some((b) => b.id === id))
		.sort((a, b) => b[1] - a[1]);

	let boardId: string;
	let reason: string;

	if (correctionEntries.length > 0 && correctionEntries[0][1] >= 2) {
		boardId = correctionEntries[0][0];
		reason = 'Your most-used board';
	} else if (input.lastUsedBoardId && input.boards.some((b) => b.id === input.lastUsedBoardId)) {
		boardId = input.lastUsedBoardId;
		reason = 'Last used';
	} else {
		boardId = input.boards[0].id;
		reason = 'Most recent board';
	}

	const alternatives = input.boards
		.filter((b) => b.id !== boardId)
		.slice(0, 2)
		.map((b) => ({ boardId: b.id, reason: b.name }));

	return {
		boardId,
		confidence: 'low',
		contentType,
		contentDetection: detectionResult,
		linkClassification,
		reason,
		alternatives
	};
}

// ─── Correction Tracking ─────────────────────────────────────────────────────

const CORRECTIONS_KEY = 'nearboard_route_corrections';

/** Load correction history from localStorage */
export function loadCorrections(): Record<string, number> {
	if (typeof localStorage === 'undefined') return {};
	try {
		return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) ?? '{}');
	} catch {
		return {};
	}
}

/** Record a user override: they were suggested boardA but picked boardB */
export function recordCorrection(chosenBoardId: string): void {
	if (typeof localStorage === 'undefined') return;
	const corrections = loadCorrections();
	corrections[chosenBoardId] = (corrections[chosenBoardId] ?? 0) + 1;
	localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(corrections));
}
