/**
 * @file globalContentService.ts
 * @description Upserts the /globalContent/{contentHash} shared enrichment cache.
 *              Called by onBoardContentWrite for link and product content types.
 *              Reads enrichment from the just-written ContentDoc — no separate API calls.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { hashUrl, normalizeUrl } from './urlHash.js';

/** Staleness threshold: 30 days in milliseconds */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/** Fields extracted from the ContentDoc for cache population. */
export interface CacheableContent {
	type: 'link' | 'product';
	url: string;
	originalUrl?: string;
	title?: string;
	description?: string | null;
	image?: string | null;
	domain?: string;
	favicon?: string | null;
	enrichment?: unknown | null;
	price?: string | null;
	originalPrice?: string | null;
}

export interface CacheResult {
	contentHash: string;
	isStale: boolean;
}

/**
 * Upserts the global content cache for a URL-based content item.
 *
 * - On MISS: creates cache doc from ContentDoc enrichment data.
 * - On HIT: increments saveCount, upgrades sparse entries with richer data.
 * - Always writes contentHash back to the ContentDoc.
 */
export async function upsertGlobalContent(
	boardId: string,
	contentId: string,
	data: CacheableContent
): Promise<CacheResult> {
	const db = getFirestore();
	// Prefer original URL for affiliate-wrapped links
	const rawUrl = data.originalUrl || data.url;
	const contentHash = hashUrl(rawUrl);
	const cacheRef = db.doc(`globalContent/${contentHash}`);
	const contentRef = db.doc(`boards/${boardId}/content/${contentId}`);

	const cacheSnap = await cacheRef.get();

	if (cacheSnap.exists) {
		// ─── CACHE HIT ──────────────────────────────────────────────────
		const cached = cacheSnap.data()!;

		// Upgrade sparse entries (e.g., MCP created minimal, client has full enrichment)
		const upgrades: Record<string, unknown> = {
			saveCount: FieldValue.increment(1)
		};

		if (data.title && !cached.title) upgrades.title = data.title;
		if (data.description && !cached.description) upgrades.description = data.description;
		if (data.image && !cached.image) upgrades.image = data.image;
		if (data.domain && !cached.domain) upgrades.domain = data.domain;
		if (data.favicon && !cached.favicon) upgrades.favicon = data.favicon;
		if (data.enrichment && !cached.enrichment) upgrades.enrichment = data.enrichment;
		if (data.type === 'product' && data.price && !cached.price) {
			upgrades.price = data.price;
		}

		await cacheRef.update(upgrades);

		// Check staleness
		const enrichedAt = cached.enrichedAt?.toMillis() ?? 0;
		const isStale = Date.now() - enrichedAt > STALE_THRESHOLD_MS;

		// Write contentHash back to ContentDoc
		await contentRef.update({ contentHash });

		return { contentHash, isStale };
	}

	// ─── CACHE MISS ─────────────────────────────────────────────────────
	const cacheDoc: Record<string, unknown> = {
		contentHash,
		url: normalizeUrl(rawUrl),
		type: data.type,
		title: data.title || '',
		description: data.description ?? null,
		image: data.image ?? null,
		domain: data.domain || '',
		favicon: data.favicon ?? null,
		saveCount: 1,
		enrichedAt: FieldValue.serverTimestamp(),
		createdAt: FieldValue.serverTimestamp()
	};

	// Link-specific: structured enrichment
	if (data.type === 'link' && data.enrichment) {
		cacheDoc.enrichment = data.enrichment;
	}

	// Product-specific: pricing
	if (data.type === 'product') {
		cacheDoc.price = data.price ?? null;
		cacheDoc.originalPrice = data.originalPrice ?? null;
	}

	// Use merge to handle race conditions (two users saving same URL simultaneously)
	await cacheRef.set(cacheDoc, { merge: true });

	// Write contentHash back to ContentDoc
	await contentRef.update({ contentHash });

	return { contentHash, isStale: false };
}
