/**
 * @file oembedService.ts
 * @description Shared oEmbed service for fetching embed data from supported providers.
 *              Eliminates duplication between enrichmentService and ogMetadata.
 */

import { OEMBED_PROVIDERS } from '../config/enrichmentConfig.js';
import { ENRICHMENT_CONFIG } from '../config/enrichmentConfig.js';

export interface OEmbedResult {
	title: string | null;
	image: string | null;
	description: string | null;
	type: 'link' | 'video' | 'photo' | 'rich';
	videoDuration?: string | null;
	authorName?: string | null;
	providerName?: string | null;
	html?: string | null;
}

interface OEmbedResponse {
	title?: string;
	thumbnail_url?: string;
	thumbnailUrl?: string;
	author_name?: string;
	type?: string;
	duration?: number;
	provider_name?: string;
	html?: string;
}

/**
 * Fetch oEmbed data for a URL from supported providers.
 * @param url - Target URL to fetch oEmbed data for
 * @returns OEmbed result or null if not supported/failed
 */
export async function fetchOEmbed(url: string): Promise<OEmbedResult | null> {
	try {
		const urlObj = new URL(url);
		const domain = urlObj.hostname.replace(/^www\./, '');

		// Find matching provider
		let provider = OEMBED_PROVIDERS[domain];
		if (!provider) {
			for (const [key, value] of Object.entries(OEMBED_PROVIDERS)) {
				if (domain.endsWith(key)) {
					provider = value;
					break;
				}
			}
		}

		if (!provider) return null;

		const oembedUrl = `${provider}?url=${encodeURIComponent(url)}&format=json&maxwidth=1200&maxheight=630`;

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), ENRICHMENT_CONFIG.timeouts.oembed);
		const res = await fetch(oembedUrl, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!res.ok) return null;

		const data: OEmbedResponse = await res.json();

		return {
			title: data.title || null,
			image: data.thumbnail_url || data.thumbnailUrl || null,
			description: null, 
			type: data.type === 'video' ? 'video' : data.type === 'photo' ? 'photo' : 'link',
			videoDuration: data.duration ? formatDuration(data.duration) : null,
			authorName: data.author_name || null,
			providerName: data.provider_name || null,
			html: data.html || null,
		};
	} catch (error) {
		console.error('oEmbed failed:', error);
		return null;
	}
}

/**
 * Get list of supported oEmbed domains.
 */
export function getSupportedOEmbedDomains(): string[] {
	return Object.keys(OEMBED_PROVIDERS);
}

/**
 * Check if a URL is supported by oEmbed.
 */
export function isOEmbedSupported(url: string): boolean {
	try {
		const urlObj = new URL(url);
		const domain = urlObj.hostname.replace(/^www\./, '');
		
		if (OEMBED_PROVIDERS[domain]) return true;
		
		for (const key of Object.keys(OEMBED_PROVIDERS)) {
			if (domain.endsWith(key)) return true;
		}
		
		return false;
	} catch {
		return false;
	}
}

function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;

	if (h > 0) {
		return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	}
	return `${m}:${s.toString().padStart(2, '0')}`;
}
