/**
 * @file urlHash.ts
 * @description URL normalization and hashing for the global content cache.
 *              Produces deterministic SHA-256 hashes for URL deduplication.
 */

import { createHash } from 'node:crypto';

/** Tracking parameters to strip before hashing. */
const TRACKING_PARAMS = [
	'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
	'ref', 'fbclid', 'gclid', 'msclkid', 'dclid', 'twclid',
	'mc_cid', 'mc_eid', '_ga', '_gl', 'yclid', 'wickedid',
	'si', 'feature', 'spm', 'share_source'
];

/**
 * Normalizes a URL for cache deduplication:
 * - Lowercase scheme and host
 * - Remove fragment
 * - Remove common tracking parameters
 * - Sort remaining query parameters
 * - Strip trailing slash (unless path is root)
 */
export function normalizeUrl(raw: string): string {
	try {
		const url = new URL(raw);

		// Remove fragment
		url.hash = '';

		// Remove tracking params
		for (const param of TRACKING_PARAMS) {
			url.searchParams.delete(param);
		}

		// Sort remaining params for deterministic hashing
		url.searchParams.sort();

		// Build normalized string (URL constructor lowercases scheme + host)
		let normalized = url.toString();

		// Strip trailing slash unless it's the root path
		if (url.pathname !== '/' && normalized.endsWith('/')) {
			normalized = normalized.slice(0, -1);
		}

		return normalized;
	} catch {
		// Fallback for malformed URLs
		return raw.toLowerCase().trim();
	}
}

/**
 * Returns SHA-256 hex hash of the normalized URL.
 * This becomes the document ID in /globalContent/{contentHash}.
 */
export function hashUrl(raw: string): string {
	const normalized = normalizeUrl(raw);
	return createHash('sha256').update(normalized).digest('hex');
}
