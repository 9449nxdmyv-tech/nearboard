/**
 * @file enrichmentConfig.ts
 * @description Centralized configuration for enrichment services.
 */

export const ENRICHMENT_CONFIG = {
	timeouts: {
		microlink: 15000,
		ogs: 8000,
		oembed: 5000,
		ai: 10000,
		socialMetrics: 5000,
		fullText: 10000,
		fetchHtml: 8000,
		imdbApi: 4000,
		githubApi: 4000,
	},
	cache: {
		ttlMs: 60 * 60 * 1000, // 1 hour
		maxSize: 500,
	},
	retries: {
		maxAttempts: 3,
		initialDelay: 1000,
		maxDelay: 10000,
	},
	rateLimit: {
		windowMs: 60_000,
		maxRequests: 30,
	},
	response: {
		maxBytes: 2 * 1024 * 1024, // 2MB
	},
	microlinkEndpoint: 'https://api.microlink.io',
} as const;

export const API_KEYS = {
	microlink: process.env.MICROLINK_API_KEY || '',
	gemini: process.env.GEMINI_API_KEY || '',
	sharedCount: process.env.SHARED_COUNT_API_KEY || '',
} as const;

export const MICROLINK_ENDPOINT = 'https://api.microlink.io';

export const OEMBED_PROVIDERS: Record<string, string> = {
	'twitter.com': 'https://publish.twitter.com/oembed',
	'x.com': 'https://publish.twitter.com/oembed',
	'instagram.com': 'https://graph.instagram.com/oembed',
	'tiktok.com': 'https://www.tiktok.com/oembed',
	'reddit.com': 'https://www.reddit.com/oembed',
	'soundcloud.com': 'https://soundcloud.com/oembed',
	'spotify.com': 'https://open.spotify.com/oembed',
	'vimeo.com': 'https://vimeo.com/api/oembed.json',
	'youtube.com': 'https://www.youtube.com/oembed',
	'youtu.be': 'https://www.youtube.com/oembed',
};
