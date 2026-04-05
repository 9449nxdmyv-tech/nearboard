/**
 * @file ogExtractor.ts
 * @description Client-side OG metadata extractor. Calls the Firebase Cloud Function
 *              for enriched metadata with Microlink API, screenshots, and AI classification.
 *              Falls back to local /api/og if Firebase is unavailable.
 */

import type { PageMetadata } from '$lib/types';

const cache = new Map<string, { data: PageMetadata; expiry: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const FALLBACK = (url: string): PageMetadata => ({
	title: url,
	image: null,
	description: null,
	url,
	price: null,
	type: 'link'
});

/**
 * Fetches OG metadata for a URL.
 * In production: Firebase Hosting routes to Cloud Function (with Microlink + AI)
 * In development: Falls back to local /api/og endpoint
 */
export async function extractMetadata(url: string, { skipCache = false } = {}): Promise<PageMetadata> {
	if (!skipCache) {
		const cached = cache.get(url);
		if (cached && cached.expiry > Date.now()) {
			return cached.data;
		}
	}

	// Always use /api/og - Firebase Hosting will route to Cloud Function in production
	const response = await fetch(`/api/og?url=${encodeURIComponent(url)}`);

	if (!response.ok) {
		// Don't cache errors — let user retry
		return FALLBACK(url);
	}

	const data = await response.json();

	// Server may return an error object instead of PageMetadata
	if (data.error || !data.url) {
		return FALLBACK(url);
	}

	const metadata: PageMetadata = data;

	// Don't cache product-type results with no price — allows retry to pick up price later
	if (metadata.type === 'product' && !metadata.price) {
		return metadata;
	}

	cache.set(url, { data: metadata, expiry: Date.now() + CACHE_TTL_MS });
	return metadata;
}
