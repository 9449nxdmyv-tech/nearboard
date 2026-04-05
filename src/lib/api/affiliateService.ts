/**
 * @file affiliateService.ts
 * @description Affiliate link wrapping service. Resolves commercial URLs
 *              into monetized affiliate links via Skimlinks, Amazon Associates,
 *              or Sovrn depending on configuration and URL domain.
 *
 * Provider priority: Amazon (for amazon domains) > Skimlinks > Sovrn.
 * All wrapping is best-effort — missing env vars or errors return the
 * original URL unchanged so content creation is never blocked.
 *
 * Includes in-memory caching to avoid redundant API calls for the same URL.
 */

import {
	AFFILIATE_ENABLED,
	AFFILIATE_ENABLED_DOMAINS,
	AFFILIATE_PROVIDER
} from '$lib/config/affiliate.constants';

export interface AffiliateResult {
	originalUrl: string;
	resolvedUrl: string;
	isAffiliate: boolean;
	affiliateProvider: 'skimlinks' | 'sovrn' | 'amazon' | null;
	affiliateStatus: 'wrapped' | 'not-eligible' | 'fallback-original' | 'error';
}

/** In-memory cache for wrapped URLs (session lifetime) */
const affiliateCache = new Map<string, AffiliateResult>();

/** Cache TTL: 24 hours */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cacheTimestamps = new Map<string, number>();

/**
 * Gets cached affiliate result if available and not expired.
 */
function getCachedAffiliate(url: string): AffiliateResult | null {
	const cached = affiliateCache.get(url);
	const timestamp = cacheTimestamps.get(url);
	
	if (cached && timestamp && Date.now() - timestamp < CACHE_TTL_MS) {
		return cached;
	}
	
	// Expired - remove from cache
	if (timestamp) {
		affiliateCache.delete(url);
		cacheTimestamps.delete(url);
	}
	
	return null;
}

/**
 * Stores affiliate result in cache.
 */
function cacheAffiliate(url: string, result: AffiliateResult): void {
	affiliateCache.set(url, result);
	cacheTimestamps.set(url, Date.now());
	
	// Prune old entries if cache gets too large
	if (affiliateCache.size > 1000) {
		const now = Date.now();
		for (const [key, ts] of cacheTimestamps.entries()) {
			if (now - ts > CACHE_TTL_MS) {
				affiliateCache.delete(key);
				cacheTimestamps.delete(key);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Environment helpers (Vite injects these at build time)
// ---------------------------------------------------------------------------

function getSkimlinksPublisherId(): string | undefined {
	try {
		return import.meta.env.VITE_SKIMLINKS_PUBLISHER_ID || undefined;
	} catch {
		return undefined;
	}
}

function getAmazonAssociateTag(): string | undefined {
	try {
		return import.meta.env.VITE_AMAZON_ASSOCIATE_TAG || undefined;
	} catch {
		return undefined;
	}
}

function getSovrnApiKey(): string | undefined {
	try {
		return import.meta.env.VITE_SOVRN_API_KEY || undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Amazon domain detection
// ---------------------------------------------------------------------------

const AMAZON_DOMAIN_RE = /^(www\.)?amazon\.(com|co\.uk|ca|de|fr|it|es|co\.jp|com\.au|in|com\.br|com\.mx|nl|sg|ae|sa|pl|se|eg|com\.tr|com\.be)$/i;

function isAmazonDomain(hostname: string): boolean {
	return AMAZON_DOMAIN_RE.test(hostname);
}

// ---------------------------------------------------------------------------
// Provider-specific wrapping
// ---------------------------------------------------------------------------

function wrapWithAmazon(url: string, urlObj: URL, tag: string): AffiliateResult {
	// Clone so we don't mutate the caller's object
	const wrapped = new URL(urlObj.href);

	// Remove any existing tag to avoid duplicates
	wrapped.searchParams.delete('tag');
	wrapped.searchParams.set('tag', tag);

	return {
		originalUrl: url,
		resolvedUrl: wrapped.toString(),
		isAffiliate: true,
		affiliateProvider: 'amazon',
		affiliateStatus: 'wrapped'
	};
}

function wrapWithSkimlinks(url: string, publisherId: string): AffiliateResult {
	const resolvedUrl = `https://go.skimresources.com/?id=${encodeURIComponent(publisherId)}&url=${encodeURIComponent(url)}`;

	return {
		originalUrl: url,
		resolvedUrl,
		isAffiliate: true,
		affiliateProvider: 'skimlinks',
		affiliateStatus: 'wrapped'
	};
}

function wrapWithSovrn(url: string, apiKey: string): AffiliateResult {
	const resolvedUrl = `https://redirect.viglink.com/?key=${encodeURIComponent(apiKey)}&u=${encodeURIComponent(url)}`;

	return {
		originalUrl: url,
		resolvedUrl,
		isAffiliate: true,
		affiliateProvider: 'sovrn',
		affiliateStatus: 'wrapped'
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates a URL and wraps it with affiliate tracking if eligible.
 * Uses in-memory caching to avoid redundant API calls.
 *
 * Strategy:
 *  1. If the URL is an Amazon domain and VITE_AMAZON_ASSOCIATE_TAG is set,
 *     append the Associates tag directly (best conversion).
 *  2. Otherwise, fall through to the configured AFFILIATE_PROVIDER
 *     (skimlinks or sovrn) if the corresponding env var is present.
 *  3. If no provider is configured, return the original URL (graceful degradation).
 */
export async function wrapUrl(url: string): Promise<AffiliateResult> {
	// Check cache first
	const cached = getCachedAffiliate(url);
	if (cached) {
		return cached;
	}

	const defaultResult: AffiliateResult = {
		originalUrl: url,
		resolvedUrl: url,
		isAffiliate: false,
		affiliateProvider: null,
		affiliateStatus: 'not-eligible'
	};

	if (!AFFILIATE_ENABLED) {
		return defaultResult;
	}

	try {
		const urlObj = new URL(url);
		const domain = urlObj.hostname.replace(/^www\./, '');

		// Check if domain is in our enabled list
		const isEligible = AFFILIATE_ENABLED_DOMAINS.some(
			(d) => domain === d || domain.endsWith('.' + d)
		);

		if (!isEligible) {
			cacheAffiliate(url, defaultResult);
			return defaultResult;
		}

		// --- Amazon-specific: use Associates tag directly ---
		if (isAmazonDomain(urlObj.hostname)) {
			const tag = getAmazonAssociateTag();
			if (tag) {
				const result = wrapWithAmazon(url, urlObj, tag);
				cacheAffiliate(url, result);
				return result;
			}
			// Fall through to generic provider if no Amazon tag configured
		}

		// --- Generic provider wrapping ---
		// Cast to string so TypeScript doesn't narrow the literal type from the constant
		const provider = AFFILIATE_PROVIDER as string;

		if (provider === 'skimlinks' || !provider) {
			const publisherId = getSkimlinksPublisherId();
			if (publisherId) {
				const result = wrapWithSkimlinks(url, publisherId);
				cacheAffiliate(url, result);
				return result;
			}
		}

		if (provider === 'sovrn') {
			const apiKey = getSovrnApiKey();
			if (apiKey) {
				const result = wrapWithSovrn(url, apiKey);
				cacheAffiliate(url, result);
				return result;
			}
		}

		// No provider credentials available — return original URL
		const fallbackResult: AffiliateResult = {
			originalUrl: url,
			resolvedUrl: url,
			isAffiliate: false,
			affiliateProvider: null,
			affiliateStatus: 'fallback-original'
		};
		cacheAffiliate(url, fallbackResult);
		return fallbackResult;
	} catch (err) {
		console.error('Affiliate resolution failed:', err);
		const errorResult: AffiliateResult = {
			originalUrl: url,
			resolvedUrl: url,
			isAffiliate: false,
			affiliateProvider: null,
			affiliateStatus: 'error'
		};
		cacheAffiliate(url, errorResult);
		return errorResult;
	}
}
