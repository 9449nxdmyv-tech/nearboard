/**
 * @file enrichmentService.ts
 * @description Enhanced link enrichment service with modular architecture.
 *              Works without Microlink API key using open-graph-scraper as primary.
 *
 * Enrichment Strategy (no API key required):
 *   1. open-graph-scraper (primary - works without API keys)
 *   2. oEmbed for social platforms
 *   3. JSON-LD parsing for structured data
 *   4. AI classification (optional, requires GEMINI_API_KEY)
 *   5. Social metrics (optional, requires SHARED_COUNT_API_KEY)
 *
 * With Microlink API key:
 *   - Adds: screenshots, logos, color palettes, technology detection
 */

import ogs from 'open-graph-scraper';
import { fetchOEmbed } from './oembedService.js';
import { extractEnrichmentFromJsonLd } from './jsonLdParser.js';
import { withDeduplication } from './requestDeduplication.js';
import { ENRICHMENT_CONFIG, API_KEYS } from '../config/enrichmentConfig.js';
import type { StructuredEnrichment } from '../types/jsonLdTypes.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContentClassification {
	category: 'recipe' | 'product' | 'article' | 'video' | 'music' | 'book' | 'movie' | 'place' | 'github' | 'other';
	tags: string[];
	summary: string;
	sentiment?: 'positive' | 'neutral' | 'negative';
}

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

export interface EnrichmentResult {
	title: string;
	image: string | null;
	description: string | null;
	url: string;
	price: string | null;
	type: 'article' | 'product' | 'video' | 'link';
	youtubeId?: string | null;
	enrichment?: StructuredEnrichment | null;
	screenshotUrl?: string | null;
	logoUrl?: string | null;
	classification?: ContentClassification | null;
	socialMetrics?: SocialMetrics | null;
	videoDuration?: string | null;
	siteName?: string | null;
	fullText?: string | null;
}

// ─── Main Enrichment Function ────────────────────────────────────────────────

/**
 * Enhanced URL enrichment with multiple data sources.
 * Works without any API keys - Microlink is optional enhancement.
 * 
 * Priority: 
 *   1. open-graph-scraper (primary, no API key needed)
 *   2. oEmbed (social platforms)
 *   3. Microlink (optional, adds screenshots/logos if API key available)
 *   4. AI classification (optional)
 *   5. Social metrics (optional)
 */
export async function enrichUrl(targetUrl: string): Promise<EnrichmentResult> {
	return withDeduplication(`enrich:${targetUrl}`, async () => {
		const fallback = createFallback(targetUrl);

		try {
			// 1. open-graph-scraper (PRIMARY - works without API keys)
			const ogsResult = await tryOpenGraphScraper(targetUrl);

			// 2. oEmbed for social platforms
			const oembedResult = await fetchOEmbed(targetUrl);

			// 3. Microlink (OPTIONAL - only if API key available)
			let microlinkResult: Partial<EnrichmentResult> | null = null;
			if (API_KEYS.microlink) {
				microlinkResult = await fetchFromMicrolink(targetUrl);
			}

			// Combine metadata for classification
			const combinedMetadata: Partial<EnrichmentResult> = {
				...microlinkResult,
				...ogsResult,
				url: targetUrl
			};

			// 4. AI classification (OPTIONAL)
			const classification = API_KEYS.gemini
				? await classifyContent(combinedMetadata)
				: null;

			// 5. Social metrics (OPTIONAL)
			const socialMetrics = API_KEYS.sharedCount
				? await getSocialMetrics(targetUrl)
				: null;

			// Merge all data sources (prefer Microlink for images, ogs for text)
			return {
				...fallback,
				...ogsResult,
				// Microlink overrides for specific fields if available
				image: microlinkResult?.image ?? ogsResult?.image ?? fallback.image,
				screenshotUrl: microlinkResult?.screenshotUrl,
				logoUrl: microlinkResult?.logoUrl,
				// oEmbed overrides
				...(oembedResult && {
					title: oembedResult.title ?? ogsResult?.title,
					image: oembedResult.image ?? microlinkResult?.image ?? ogsResult?.image,
					description: oembedResult.description ?? ogsResult?.description,
					type: oembedResult.type as 'link' | 'video',
					videoDuration: oembedResult.videoDuration,
					siteName: oembedResult.providerName ?? ogsResult?.siteName,
				}),
				classification,
				socialMetrics,
			};
		} catch (error) {
			console.error('Enrichment error:', error);
			return fallback;
		}
	});
}

// ─── open-graph-scraper Integration ──────────────────────────────────────────

async function tryOpenGraphScraper(url: string): Promise<Partial<EnrichmentResult> | null> {
	try {
		const { result } = await ogs({
			url,
			timeout: ENRICHMENT_CONFIG.timeouts.ogs,
			onlyGetOpenGraphInfo: false,
			fetchOptions: {
				headers: {
					'user-agent': 'Mozilla/5.0 (compatible; Nearboard/1.0; +https://nearboard.app)'
				},
				signal: AbortSignal.timeout(ENRICHMENT_CONFIG.timeouts.ogs)
			}
		});

		// Extract JSON-LD if available
		let enrichment: StructuredEnrichment | null = null;
		if (result.jsonLD && Array.isArray(result.jsonLD)) {
			for (const item of result.jsonLD) {
				enrichment = extractEnrichmentFromJsonLd(item);
				if (enrichment) break;
			}
		}

		return {
			title: (result.ogTitle || result.twitterTitle || result.customMetaTags?.title || '') as string,
			image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || null,
			description: (Array.isArray(result.ogDescription)
				? result.ogDescription[0]
				: result.ogDescription) ||
				(Array.isArray(result.twitterDescription)
					? result.twitterDescription[0]
					: result.twitterDescription) ||
				(Array.isArray(result.customMetaTags?.description)
					? result.customMetaTags.description[0]
					: result.customMetaTags?.description) || null,
			siteName: result.ogSiteName || null,
			type: result.ogType === 'product' || result.ogType === 'og:product' ? 'product' :
				result.ogType === 'video' || result.ogType === 'video.other' ? 'video' :
					result.ogType === 'article' ? 'article' : 'link',
			enrichment: enrichment ?? null,
			youtubeId: extractYouTubeId(url),
		};
	} catch (error) {
		console.error('open-graph-scraper failed:', error);
		return null;
	}
}

// ─── Microlink API Integration (Optional) ────────────────────────────────────

interface MicrolinkResponse {
	status: 'success' | 'error';
	data: {
		title?: string | null;
		description?: string | null;
		image?: { url: string } | null;
		logo?: { url: string } | null;
		screenshot?: { url: string } | null;
	};
}

/**
 * Fetch enhanced metadata from Microlink API.
 * Only called if MICROLINK_API_KEY is set.
 * Adds: screenshots, logos, better image extraction
 */
async function fetchFromMicrolink(url: string): Promise<Partial<EnrichmentResult> | null> {
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			ENRICHMENT_CONFIG.timeouts.microlink
		);

		const params = new URLSearchParams({
			url,
			meta: 'true',
			logo: 'true',
			screenshot: 'true',
		});

		const headers: Record<string, string> = { 'Accept': 'application/json' };
		if (API_KEYS.microlink) {
			headers['Authorization'] = `Bearer ${API_KEYS.microlink}`;
		}

		const res = await fetch(
			`${ENRICHMENT_CONFIG.microlinkEndpoint}?${params.toString()}`,
			{ headers, signal: controller.signal }
		);
		clearTimeout(timeoutId);

		if (!res.ok) {
			console.warn('Microlink API error:', res.status, res.statusText);
			return null;
		}

		const response: MicrolinkResponse = await res.json();

		if (response.status !== 'success' || !response.data) {
			return null;
		}

		const data = response.data;

		return {
			title: data.title || undefined,
			description: data.description || undefined,
			image: data.image?.url || null,
			logoUrl: data.logo?.url || undefined,
			screenshotUrl: data.screenshot?.url || undefined,
		};
	} catch (error) {
		console.error('Microlink API failed:', error);
		return null;
	}
}

// ─── AI Classification (Optional - requires GEMINI_API_KEY) ─────────────────

async function classifyContent(metadata: Partial<EnrichmentResult>): Promise<ContentClassification | null> {
	if (!API_KEYS.gemini) return null;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			ENRICHMENT_CONFIG.timeouts.ai
		);

		const prompt = `
Classify this web content and return ONLY valid JSON (no markdown):

Title: ${metadata.title || 'N/A'}
Description: ${metadata.description || 'N/A'}
URL: ${metadata.url || 'N/A'}

Return exactly this JSON format:
{
  "category": "recipe|product|article|video|music|book|movie|place|github|other",
  "tags": ["tag1", "tag2", "tag3"],
  "summary": "One sentence summary (max 20 words)",
  "sentiment": "positive|neutral|negative"
}
`.trim();

		const res = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEYS.gemini}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: 0.3,
						maxOutputTokens: 256,
						responseMimeType: 'application/json'
					}
				}),
				signal: controller.signal
			}
		);
		clearTimeout(timeoutId);

		if (!res.ok) return null;

		const data = await res.json();
		const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!text) return null;

		return JSON.parse(text);
	} catch (error) {
		console.error('AI classification failed:', error);
		return null;
	}
}

// ─── Social Metrics (Optional - requires SHARED_COUNT_API_KEY) ──────────────

async function getSocialMetrics(url: string): Promise<SocialMetrics | null> {
	if (!API_KEYS.sharedCount) return null;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			ENRICHMENT_CONFIG.timeouts.socialMetrics
		);

		const res = await fetch(
			`https://api.sharedcount.com/?url=${encodeURIComponent(url)}`,
			{
				headers: {
					'Authorization': `Bearer ${API_KEYS.sharedCount}`,
					'Accept': 'application/json'
				},
				signal: controller.signal
			}
		);
		clearTimeout(timeoutId);

		if (!res.ok) return null;

		const data = await res.json();

		return {
			shares: {
				facebook: data.Facebook?.share_count || undefined,
				twitter: data.Twitter?.count || undefined,
				linkedin: data.LinkedIn?.count || undefined,
				pinterest: data.Pinterest?.count || undefined,
			},
			comments: data.Facebook?.comment_count || undefined,
			likes: data.Facebook?.reaction_count || undefined,
		};
	} catch {
		return null;
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createFallback(url: string): EnrichmentResult {
	return {
		title: url,
		image: null,
		description: null,
		url,
		price: null,
		type: 'link',
		youtubeId: extractYouTubeId(url),
		enrichment: null,
		screenshotUrl: null,
		logoUrl: null,
		classification: null,
		socialMetrics: null,
		videoDuration: null,
		siteName: null,
		fullText: null,
	};
}

/**
 * Extracts a YouTube video ID from a URL.
 * Supports youtube.com/watch, youtu.be, youtube.com/embed, youtube.com/shorts, youtube.com/live, etc.
 * 
 * Note: This function is duplicated in src/lib/utils/ogParser.ts.
 * Keep both implementations in sync. Consider moving to a shared package in the future.
 */
function extractYouTubeId(url: string): string | null {
	const patterns = [
		/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
		/youtu\.be\/([a-zA-Z0-9_-]+)/,
		/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
		/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/,
		/youtube\.com\/live\/([a-zA-Z0-9_-]+)/,
		/youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) return match[1];
	}

	return null;
}
