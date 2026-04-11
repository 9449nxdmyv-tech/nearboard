/**
 * @file urlUtils.ts
 * @description Lightweight URL and domain utilities for browser and extension.
 */

/**
 * Extracts the domain from a URL string.
 */
export function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/**
 * Builds a favicon URL from a domain using Google's favicon service.
 */
export function faviconUrl(domain: string): string {
	return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

/**
 * Extracts a YouTube video ID from a URL.
 * Supports youtube.com/watch, youtu.be, youtube.com/embed, youtube.com/shorts, youtube.com/live, etc.
 */
export function extractYouTubeId(url: string): string | null {
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
