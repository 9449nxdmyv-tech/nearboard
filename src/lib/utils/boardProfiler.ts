/**
 * @file boardProfiler.ts
 * @description Lightweight board content profiler — analyzes a board's
 *              existing content to build a profile that helps the capture
 *              router make better routing decisions.
 *
 * The profile includes:
 *   - dominantTypes: most common content types on the board
 *   - recentKeywords: frequently occurring meaningful words in recent content
 *   - domainHints: domains frequently associated with the board's links/products
 *   - typeRecency: when each content type was last added (decay-weighted)
 */

import type { ContentDoc } from '$lib/types';

/** All content types as a union matching both firestore and detection */
export type ContentType =
	| 'note' | 'link' | 'product' | 'video' | 'recipe'
	| 'movie' | 'book' | 'article' | 'music' | 'place'
	| 'github' | 'list' | 'location' | 'image';

/** Content profile for a single board */
export interface BoardProfile {
	/** Content types present on this board, sorted by frequency */
	dominantTypes: ContentType[];
	/** Most common non-stop-words across titles, descriptions, and text */
	recentKeywords: Set<string>;
	/** Domains seen on this board's link/product content */
	domainHints: string[];
	/** Score for each content type (higher = more recent + more frequent) */
	typeScores: Record<ContentType, number>;
}

/** Minimal content doc shape needed for profiling */
interface ProfileDoc {
	id: string;
	type: ContentType;
	title?: string | null;
	description?: string | null;
	text?: string | null;
	url?: string | null;
	domain?: string | null;
	caption?: string | null;
	question?: string | null;
	name?: string | null;
	address?: string | null;
	price?: string | null;
	createdAt: { toMillis: () => number } | number | Date;
	enrichment?: { kind?: string | null } | null;
}

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

/** Half-life in milliseconds for recency decay (7 days) */
const HALF_LIFE = 7 * 24 * 60 * 60 * 1000;

/**
 * Build a content profile from a board's documents.
 * @param docs - Content documents from the board
 * @param maxAge - Only consider docs newer than this (default: 90 days)
 */
export function buildBoardProfile(
	docs: ProfileDoc[],
	maxAge: number = 90 * 24 * 60 * 60 * 1000
): BoardProfile {
	const now = Date.now();
	const cutoff = now - maxAge;

	// Filter to recent docs
	const recent = docs.filter((d) => {
		const ts = typeof d.createdAt === 'number'
			? d.createdAt
			: d.createdAt instanceof Date
				? d.createdAt.getTime()
				: d.createdAt.toMillis?.() ?? 0;
		return ts >= cutoff;
	});

	// Type frequency with recency-weighted scoring
	const typeCounts: Record<string, number> = {};
	const typeScores: Record<ContentType, number> = {} as Record<ContentType, number>;

	const keywordFreq = new Map<string, number>();
	const domainSet = new Set<string>();

	for (const doc of recent) {
		// Type counting with recency decay
		const age = now - (
			typeof doc.createdAt === 'number'
				? doc.createdAt
				: doc.createdAt instanceof Date
					? doc.createdAt.getTime()
					: doc.createdAt.toMillis?.() ?? 0
		);
		const decay = Math.pow(0.5, age / HALF_LIFE);

		const type = doc.type;
		typeCounts[type] = (typeCounts[type] || 0) + 1;
		typeScores[type as ContentType] = (typeScores[type as ContentType] || 0) + decay;

		// Extract text fields for keyword analysis
		const textParts: string[] = [];
		if (doc.title) textParts.push(doc.title);
		if (doc.description) textParts.push(doc.description);
		if (doc.text) textParts.push(doc.text);
		if (doc.caption) textParts.push(doc.caption);
		if (doc.question) textParts.push(doc.question);
		if (doc.name) textParts.push(doc.name);
		if (doc.address) textParts.push(doc.address);

		const text = textParts.join(' ').toLowerCase();
		const words = text.split(/[^a-z0-9áéíóúüñ]+/);

		for (const word of words) {
			if (word.length >= 3 && !STOP_WORDS.has(word) && /^\d/.test(word) === false) {
				keywordFreq.set(word, (keywordFreq.get(word) || 0) + 1);
			}
		}

		// Track domains
		if (doc.domain) {
			domainSet.add(doc.domain);
		}
		if (doc.url) {
			try {
				const hostname = new URL(doc.url).hostname.replace(/^www\./, '').toLowerCase();
				domainSet.add(hostname);
			} catch { /* skip */ }
		}
	}

	// Sort types by frequency
	const dominantTypes = Object.entries(typeCounts)
		.sort((a, b) => b[1] - a[1])
		.map(([type]) => type as ContentType);

	// Top keywords (sorted by frequency, take top 30)
	const topKeywords = [...keywordFreq.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 30)
		.map(([word]) => word);

	return {
		dominantTypes,
		recentKeywords: new Set(topKeywords),
		domainHints: [...domainSet],
		typeScores
	};
}

/**
 * Check if a content type matches this board's profile.
 * Returns a boost score (0-3) based on how well the type aligns.
 */
export function typeMatchScore(profile: BoardProfile, contentType: ContentType): number {
	let score = 0;

	// Dominant type match
	if (profile.dominantTypes.length > 0 && profile.dominantTypes[0] === contentType) {
		score += 2; // Most common type — strong signal
	} else if (profile.dominantTypes.includes(contentType)) {
		score += 1; // Present on board — moderate signal
	}

	// Recency-weighted type score
	const typeScore = profile.typeScores[contentType] ?? 0;
	if (typeScore > 2) score += 1; // Very active with this type recently

	return Math.min(score, 3);
}

/**
 * Check if content keywords overlap with the board's profile.
 * Returns the number of matching keywords.
 */
export function keywordOverlapScore(profile: BoardProfile, content: string): number {
	const words = content.toLowerCase().split(/[^a-z0-9áéíóúüñ]+/);
	let overlap = 0;

	for (const word of words) {
		if (word.length >= 3 && profile.recentKeywords.has(word)) {
			overlap++;
		}
	}

	return overlap;
}
