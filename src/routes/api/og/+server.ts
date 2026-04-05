/**
 * @file api/og/+server.ts
 * @description Server endpoint that fetches a URL and extracts OG metadata.
 *              Avoids CORS issues by proxying the fetch server-side.
 *              Uses a multi-tier fallback strategy:
 *                1. Direct fetch with browser UA → parse OG/JSON-LD
 *                2. If WAF/empty → retry with crawler UA (facebookexternalhit)
 *                3. oEmbed for supported providers
 *                4. Domain-specific APIs (IMDB Suggest, GitHub REST)
 *                5. Universal URL slug title extraction
 *              Results are cached in-memory for 1 hour per URL.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseOgTags } from '$lib/utils/ogParser';
import type { PageMetadata } from '$lib/types';
import { createRateLimiter } from '$lib/api/rateLimiter';
import {
	MOVIE_DOMAINS, BOOK_DOMAINS, MUSIC_DOMAINS, ARTICLE_DOMAINS,
	RECIPE_DOMAINS, PLACE_DOMAINS, GITHUB_DOMAINS, SOCIAL_DOMAINS,
	matchesDomain, isAmazonVideoUrl
} from '$lib/config/domains';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 500;

/** Known product retailer domains — if detected, force type to 'product' even without price */
const PRODUCT_DOMAINS = [
	'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.es', 'amazon.fr',
	'amazon.it', 'amazon.ca', 'amazon.co.jp', 'amazon.com.au',
	'walmart.com', 'target.com', 'bestbuy.com', 'costco.com',
	'homedepot.com', 'lowes.com', 'macys.com', 'nordstrom.com',
	'ebay.com', 'etsy.com', 'aliexpress.com', 'newegg.com',
	'wayfair.com', 'ikea.com', 'zappos.com', 'asos.com',
	'shein.com', 'zara.com', 'hm.com'
];

/** Video platform domains for content type detection */
const VIDEO_PLATFORM_DOMAINS = [
	'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com',
	'dailymotion.com', 'twitch.tv', 'rumble.com', 'bitchute.com',
	'odysee.com', 'peertube.social', 'vidyard.com', 'wistia.com',
	'loom.com', 'streamable.com'
];

function isProductDomain(hostname: string): boolean {
	const clean = hostname.replace(/^www\./, '');
	return PRODUCT_DOMAINS.some((d) => clean === d || clean.endsWith('.' + d));
}

function isAmazonDomain(hostname: string): boolean {
	return /(?:^|\.)amazon\.\w+(?:\.\w+)?$/.test(hostname.replace(/^www\./, ''));
}

/**
 * Extracts ASIN from an Amazon URL.
 * Matches: /dp/ASIN, /gp/product/ASIN, /gp/aw/d/ASIN
 */
function extractAsin(url: string): string | null {
	const match = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
	return match?.[1] ?? null;
}

/**
 * Amazon-specific price extraction from HTML patterns that survive bot detection.
 * Tries multiple selectors Amazon uses across different page variants.
 */
function extractAmazonPrice(html: string): string | null {
	// 1. corePriceDisplay (new Amazon layout)
	const corePrice = html.match(/class="a-price-whole"[^>]*>([^<]+)</i);
	const coreFraction = html.match(/class="a-price-fraction"[^>]*>([^<]+)</i);
	if (corePrice?.[1]) {
		const whole = corePrice[1].replace(/[^\d]/g, '');
		const frac = coreFraction?.[1]?.replace(/[^\d]/g, '') ?? '00';
		return `$${whole}.${frac}`;
	}

	// 2. priceblock_ourprice / priceblock_dealprice (older layout)
	const priceBlock = html.match(/id="priceblock_(?:ourprice|dealprice|saleprice)"[^>]*>\s*([^<]+)/i);
	if (priceBlock?.[1]?.trim()) return priceBlock[1].trim();

	// 3. data-asin-price attribute
	const asinPrice = html.match(/data-asin-price="([^"]+)"/i);
	if (asinPrice?.[1]) return `$${asinPrice[1]}`;

	// 4. "a-price" span with aria-hidden (consolidated price display)
	const ariaPrice = html.match(/<span[^>]*class="a-offscreen"[^>]*>\s*([£$€¥₹][\d.,]+)/i);
	if (ariaPrice?.[1]) return ariaPrice[1];

	// 5. Generic price pattern near "price" keyword
	const genericPrice = html.match(/"price"[^>]*>\s*([£$€¥₹]\s*[\d.,]+)/i);
	if (genericPrice?.[1]?.trim()) return genericPrice[1].trim();

	// 6. JSON-LD price in the HTML (Amazon sometimes includes structured data)
	const jsonLdPrice = html.match(/"price"\s*:\s*"?([\d.,]+)"?/i);
	if (jsonLdPrice?.[1] && parseFloat(jsonLdPrice[1]) > 0) {
		// Determine currency from page context
		const currSymbol = html.match(/["']priceCurrency["']\s*:\s*["'](\w+)["']/i);
		const symbol = currSymbol?.[1] === 'GBP' ? '£' : currSymbol?.[1] === 'EUR' ? '€' : '$';
		return `${symbol}${jsonLdPrice[1]}`;
	}

	// 7. twister-plus-price-data-price (Amazon app/mobile variant)
	const twisterPrice = html.match(/data-a-color="price"[^>]*>[^<]*<[^>]*>([£$€¥₹][\d.,]+)/i);
	if (twisterPrice?.[1]) return twisterPrice[1];

	return null;
}

/**
 * Try Amazon's mobile endpoint which is less aggressive about WAF blocking.
 * Uses the ASIN to construct a mobile product URL.
 */
async function tryAmazonMobile(asin: string, hostname: string): Promise<{ title: string | null; price: string | null; image: string | null }> {
	const mobileUrl = `https://${hostname}/dp/${asin}`;
	try {
		const res = await fetch(mobileUrl, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9'
			},
			redirect: 'follow',
			signal: AbortSignal.timeout(10000)
		});
		if (!res.ok) return { title: null, price: null, image: null };

		const html = await res.text();
		if (html.length < 500) return { title: null, price: null, image: null };

		const price = extractAmazonPrice(html);

		const titleMatch = html.match(/<title[^>]*>([^<]+)/i);
		const title = titleMatch?.[1]?.replace(/\s*:\s*Amazon\.\w+.*$/, '')?.trim() ?? null;

		const imageMatch = html.match(/data-old-hires="([^"]+)"/i)
			?? html.match(/id="landingImage"[^>]*src="([^"]+)"/i)
			?? html.match(/class="a-dynamic-image"[^>]*src="([^"]+)"/i);
		const image = imageMatch?.[1] ?? null;

		return { title, price, image };
	} catch {
		return { title: null, price: null, image: null };
	}
}

/**
 * Generic product price extraction for non-Amazon sites.
 * Tries common e-commerce HTML patterns from various platforms.
 */
function extractGenericPrice(html: string): string | null {
	const patterns = [
		// Shopify price displays
		/<span[^>]*class="[^"]*price[^"]*"[^>]*>\s*([£$€¥₹₩₽R][\s\d.,]+)/i,
		// WooCommerce
		/<(?:span|ins|bdi)[^>]*class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>[^<]*?([£$€¥₹₩₽R][\s\d.,]+)/i,
		// data-product-price attribute (Shopify, BigCommerce)
		/data-product-price="(\d+)"/i,
		// Generic price container
		/<[^>]*(?:class|id)="[^"]*(?:product-price|sale-price|current-price|price-current|special-price|final-price)[^"]*"[^>]*>\s*(?:<[^>]*>)*\s*([£$€¥₹₩₽R][\s\d.,]+)/i,
		// itemprop price value
		/itemprop="price"[^>]*content="([\d.,]+)"/i,
		// Schema price in data attribute
		/data-price="([\d.,]+)"/i
	];

	for (const p of patterns) {
		const m = html.match(p);
		if (m?.[1]) {
			const raw = m[1].trim();
			// If it's just a number (from data attr), prefix with $
			if (/^\d/.test(raw)) return `$${raw}`;
			return raw;
		}
	}

	return null;
}

/** Build fetch headers with browser-like User-Agent */
function buildBrowserHeaders(targetUrl: string): Record<string, string> {
	const headers: Record<string, string> = {
		'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
		'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		'Accept-Encoding': 'gzip, deflate, br',
		'Cache-Control': 'no-cache',
		'Pragma': 'no-cache',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
		'Upgrade-Insecure-Requests': '1'
	};

	// Amazon: set session cookies to bypass initial CAPTCHA
	try {
		const host = new URL(targetUrl).hostname;
		if (isAmazonDomain(host)) {
			headers['Cookie'] = 'session-id=000-0000000-0000000; i18n-prefs=USD';
		}
	} catch { /* ignore */ }

	return headers;
}

/** Build crawler headers — many sites serve OG tags to social crawlers even when they block browsers */
function buildCrawlerHeaders(): Record<string, string> {
	return {
		'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
		'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9'
	};
}

const { isRateLimited } = createRateLimiter({ max: 30 });

/**
 * Checks if a hostname resolves to a private/internal IP.
 * Blocks IPv4 private ranges, IPv6 loopback/private, and IPv4-mapped IPv6 addresses.
 */
function isPrivateHost(hostname: string): boolean {
	// Normalize hostname: strip brackets (IPv6), zone IDs
	const clean = hostname.replace(/^\[|\]$/g, '').split('%')[0];

	// IPv4 private ranges
	if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/.test(clean)) return true;
	if (clean === 'localhost') return true;

	// IPv6 loopback and private ranges
	if (/^(::1|::$|fc00:|fd00:|fe80:)/i.test(clean)) return true;

	// IPv4-mapped IPv6 (::ffff:192.168.x.x, ::ffff:10.x.x.x, etc.)
	const v4mapped = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	if (v4mapped) {
		return isPrivateHost(v4mapped[1]);
	}

	// IPv4-compatible IPv6
	const v4compat = clean.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
	if (v4compat) {
		return isPrivateHost(v4compat[1]);
	}

	return false;
}

function isUrlSafe(targetUrl: string): { ok: boolean; error?: string } {
	let parsed: URL;
	try {
		parsed = new URL(targetUrl);
	} catch {
		return { ok: false, error: 'Invalid URL' };
	}
	if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
		return { ok: false, error: 'Only http/https URLs are allowed' };
	}
	if (isPrivateHost(parsed.hostname)) {
		return { ok: false, error: 'Internal/private URLs are not allowed' };
	}
	return { ok: true };
}

const ogCache = new Map<string, { data: PageMetadata; expiry: number }>();

/**
 * Detect WAF challenge / bot block / empty / generic pages that contain no real content.
 * These return 200 OK but contain JavaScript challenges or generic text instead of real metadata.
 */
function isLowQualityResponse(html: string, targetUrl: string): boolean {
	// Empty or near-empty response
	if (html.length < 200) return true;

	// WAF challenge scripts
	if (html.length < 5000) {
		if (html.includes('AwsWafIntegration') || html.includes('challenge.js')) return true;
		if (html.includes('cf-browser-verification') || html.includes('cf_clearance')) return true;
		if (html.includes('Checking your browser')) return true;
		if (html.includes('Just a moment') && html.includes('cloudflare')) return true;
	}

	// No OG tags and no real <title> content — likely blocked
	if (!html.includes('og:title') && !html.includes('og:description')) {
		if (html.length < 10000 && (html.includes('captcha') || html.includes('robot'))) return true;
	}

	// Generic placeholder titles that indicate the page didn't render real content
	const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
	if (titleMatch?.[1]) {
		const title = titleMatch[1].trim().toLowerCase();
		const genericTitles = [
			'just a moment', 'attention required', 'access denied',
			'please wait', 'checking your browser', 'security check',
			'verify you are human', 'are you a robot',
			'visit tiktok to discover videos', 'tiktok - make your day'
		];
		if (genericTitles.some(g => title.includes(g))) return true;

		// Title is just the bare domain name with no real content
		try {
			const domain = new URL(targetUrl).hostname.replace(/^www\./, '').split('.')[0];
			if (title === domain && !html.includes('og:title')) return true;
		} catch { /* ignore */ }
	}

	return false;
}

/**
 * Try oEmbed to get metadata. Many sites support it (YouTube, Spotify, etc.).
 * Returns null if not available. Enriches with domain-aware metadata.
 */
async function tryOEmbed(targetUrl: string): Promise<PageMetadata | null> {
	const oembedProviders: Array<{ pattern: RegExp; endpoint: string; kind?: string }> = [
		{ pattern: /youtube\.com|youtu\.be/, endpoint: 'https://www.youtube.com/oembed' },
		{ pattern: /vimeo\.com/, endpoint: 'https://vimeo.com/api/oembed.json' },
		{ pattern: /spotify\.com/, endpoint: 'https://open.spotify.com/oembed', kind: 'music' },
		{ pattern: /soundcloud\.com/, endpoint: 'https://soundcloud.com/oembed', kind: 'music' },
		{ pattern: /twitter\.com|x\.com/, endpoint: 'https://publish.twitter.com/oembed' },
		{ pattern: /reddit\.com/, endpoint: 'https://www.reddit.com/oembed' },
		{ pattern: /tiktok\.com/, endpoint: 'https://www.tiktok.com/oembed' },
		{ pattern: /dailymotion\.com/, endpoint: 'https://www.dailymotion.com/services/oembed' },
		{ pattern: /flickr\.com|flic\.kr/, endpoint: 'https://www.flickr.com/services/oembed' },
	];

	const provider = oembedProviders.find(p => p.pattern.test(targetUrl));
	if (!provider) return null;

	try {
		const res = await fetch(
			`${provider.endpoint}?url=${encodeURIComponent(targetUrl)}&format=json`,
			{ signal: AbortSignal.timeout(5000) }
		);
		if (!res.ok) return null;
		const data = await res.json();

		const result: PageMetadata = {
			title: data.title || targetUrl,
			image: data.thumbnail_url || null,
			description: data.author_name ? `By ${data.author_name}` : null,
			url: targetUrl,
			price: null,
			type: data.type === 'video' ? 'video' : 'link'
		};

		// Enrich music oEmbed results with artist info
		if (provider.kind === 'music' && data.author_name) {
			result.enrichment = {
				kind: 'music',
				artist: data.author_name,
				album: null,
				duration: null,
				genre: null
			};
		}

		return result;
	} catch {
		return null;
	}
}

/**
 * Try IMDB Suggest API for IMDB title IDs. Public, no key needed.
 * Returns title, poster image, cast, year, and type.
 */
async function tryImdbSuggest(imdbId: string): Promise<PageMetadata | null> {
	try {
		const res = await fetch(
			`https://v2.sg.media-imdb.com/suggestion/t/${imdbId}.json`,
			{
				signal: AbortSignal.timeout(4000),
				headers: { 'User-Agent': 'Nearboard/1.0' }
			}
		);
		if (!res.ok) return null;
		const data = await res.json();
		const entry = data.d?.find((d: Record<string, unknown>) => d.id === imdbId);
		if (!entry) return null;

		const cast = entry.s ? entry.s.split(', ').slice(0, 6) : [];
		const posterUrl = entry.i?.imageUrl
			? entry.i.imageUrl.replace(/\._V1_\./, '._V1_SX600_.')
			: null;

		return {
			title: entry.l || `IMDB ${imdbId}`,
			image: posterUrl,
			description: cast.length > 0 ? `Starring ${cast.join(', ')}` : null,
			url: `https://www.imdb.com/title/${imdbId}/`,
			price: null,
			type: 'link',
			enrichment: {
				kind: 'movie',
				director: null,
				year: entry.y ?? null,
				runtime: null,
				genre: null,
				rating: null,
				ratingSource: null,
				cast,
				contentRating: null
			}
		};
	} catch {
		return null;
	}
}

/**
 * Extract a human-readable title from a URL path slug.
 * Converts "worlds-best-lasagna" → "Worlds Best Lasagna"
 */
function titleFromUrlSlug(pathname: string): string | null {
	const segments = pathname.split('/').filter(Boolean);
	// Find the most descriptive segment (longest, excluding IDs/hashes)
	const slug = segments
		.filter(s => !/^[a-f0-9]{8,}$/i.test(s)) // skip hex IDs
		.filter(s => !/^\d+$/.test(s)) // skip numeric IDs
		.filter(s => s.length > 2) // skip tiny segments
		.pop();
	if (!slug) return null;

	return slug
		.replace(/[-_+]/g, ' ')
		.replace(/\.\w+$/, '') // strip file extension
		.replace(/\b\w/g, c => c.toUpperCase()) // title case
		.trim() || null;
}

/**
 * Detect content enrichment kind from URL domain.
 */
function detectKindFromDomain(domain: string, url: string): string | null {
	if (matchesDomain(domain, MOVIE_DOMAINS) || isAmazonVideoUrl(domain, url)) return 'movie';
	if (matchesDomain(domain, RECIPE_DOMAINS)) return 'recipe';
	if (matchesDomain(domain, BOOK_DOMAINS)) return 'book';
	if (matchesDomain(domain, MUSIC_DOMAINS)) return 'music';
	if (matchesDomain(domain, PLACE_DOMAINS)) return 'place';
	if (matchesDomain(domain, ARTICLE_DOMAINS)) return 'article';
	if (matchesDomain(domain, GITHUB_DOMAINS)) return 'github';
	return null;
}

/**
 * Build a minimal enrichment object from the content kind.
 */
function buildMinimalEnrichment(kind: string): PageMetadata['enrichment'] {
	switch (kind) {
		case 'movie': return { kind: 'movie', director: null, year: null, runtime: null, genre: null, rating: null, ratingSource: null, cast: [], contentRating: null };
		case 'recipe': return { kind: 'recipe', cookTime: null, prepTime: null, totalTime: null, servings: null, ingredients: [], instructions: [], cuisine: null, calories: null };
		case 'book': return { kind: 'book', author: null, genre: null, pageCount: null, isbn: null, publisher: null, publishDate: null, averageRating: null };
		case 'music': return { kind: 'music', artist: null, album: null, duration: null, genre: null };
		case 'place': return { kind: 'place', address: null, phone: null, priceRange: null, category: null, rating: null, ratingCount: null, latitude: null, longitude: null, hours: null };
		case 'article': return { kind: 'article', author: null, publishedDate: null, readingTime: null, siteName: null, bodyText: null };
		case 'github': return { kind: 'github', owner: null, repo: null, description: null, language: null, stars: null, forks: null };
		default: return null;
	}
}

/**
 * Construct metadata from URL patterns and domain-specific APIs.
 * Works for known domains with rich fallbacks and ANY URL with slug parsing.
 */
async function buildFallbackFromUrl(targetUrl: string): Promise<PageMetadata | null> {
	let parsed: URL;
	try { parsed = new URL(targetUrl); } catch { return null; }
	const domain = parsed.hostname.replace(/^www\./, '');

	// ── IMDB: /title/ttXXXXXXX/ — use Suggest API for rich metadata ──
	if (matchesDomain(domain, MOVIE_DOMAINS)) {
		const imdbMatch = parsed.pathname.match(/\/title\/(tt\d+)/);
		if (imdbMatch) {
			const imdbData = await tryImdbSuggest(imdbMatch[1]);
			if (imdbData) return { ...imdbData, url: targetUrl };
		}
		// Generic movie fallback from URL slug
		const slugTitle = titleFromUrlSlug(parsed.pathname);
		return {
			title: slugTitle ?? `Movie on ${domain}`,
			image: null,
			description: null,
			url: targetUrl,
			price: null,
			type: 'link',
			enrichment: buildMinimalEnrichment('movie')
		};
	}

	// ── GitHub: /owner/repo — use GitHub REST API ──
	if (matchesDomain(domain, GITHUB_DOMAINS) && domain.includes('github')) {
		const parts = parsed.pathname.split('/').filter(Boolean);
		if (parts.length >= 2 && !['settings', 'pulls', 'issues', 'actions', 'wiki'].includes(parts[1])) {
			try {
				const ghRes = await fetch(`https://api.github.com/repos/${parts[0]}/${parts[1]}`, {
					headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Nearboard/1.0' },
					signal: AbortSignal.timeout(4000)
				});
				if (ghRes.ok) {
					const gh = await ghRes.json();
					return {
						title: gh.full_name || `${parts[0]}/${parts[1]}`,
						image: gh.owner?.avatar_url || null,
						description: gh.description || null,
						url: targetUrl,
						price: null,
						type: 'link',
						enrichment: {
							kind: 'github', owner: parts[0], repo: parts[1],
							description: gh.description || null,
							language: gh.language || null,
							stars: gh.stargazers_count ? String(gh.stargazers_count) : null,
							forks: gh.forks_count ? String(gh.forks_count) : null
						}
					};
				}
			} catch { /* fall through */ }
			return {
				title: `${parts[0]}/${parts[1]}`,
				image: null, description: null, url: targetUrl,
				price: null, type: 'link',
				enrichment: { kind: 'github', owner: parts[0], repo: parts[1], description: null, language: null, stars: null, forks: null }
			};
		}
	}

	// ── Known content domains — extract title from URL slug + enrich ──
	const kind = detectKindFromDomain(domain, targetUrl);
	if (kind) {
		const slugTitle = titleFromUrlSlug(parsed.pathname);
		return {
			title: slugTitle ?? `${kind.charAt(0).toUpperCase() + kind.slice(1)} on ${domain}`,
			image: null,
			description: null,
			url: targetUrl,
			price: null,
			type: kind === 'movie' ? 'video' : 'link',
			enrichment: buildMinimalEnrichment(kind)
		};
	}

	// ── Video platforms — detect as video type ──
	if (VIDEO_PLATFORM_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
		const slugTitle = titleFromUrlSlug(parsed.pathname);
		return {
			title: slugTitle ?? `Video on ${domain}`,
			image: null,
			description: null,
			url: targetUrl,
			price: null,
			type: 'video'
		};
	}

	// ── Social platforms — extract what we can from the URL ──
	if (matchesDomain(domain, SOCIAL_DOMAINS)) {
		const slugTitle = titleFromUrlSlug(parsed.pathname);
		// Extract username from common path patterns like /@user or /user
		const userMatch = parsed.pathname.match(/^\/@?([a-zA-Z0-9_.]+)/);
		const username = userMatch?.[1];
		return {
			title: slugTitle ?? (username ? `@${username} on ${domain}` : `Post on ${domain}`),
			image: null,
			description: username ? `@${username}` : null,
			url: targetUrl,
			price: null,
			type: 'link'
		};
	}

	// ── Universal fallback — any URL gets a readable title from its slug ──
	const slugTitle = titleFromUrlSlug(parsed.pathname);
	if (slugTitle && slugTitle.length > 3) {
		return {
			title: slugTitle,
			image: null,
			description: null,
			url: targetUrl,
			price: null,
			type: 'link'
		};
	}

	return null;
}

/**
 * Fetches a URL and returns the HTML body, or null on failure.
 */
async function fetchHtml(targetUrl: string, headers: Record<string, string>): Promise<{ html: string; ok: boolean } | null> {
	try {
		const response = await fetch(targetUrl, {
			headers,
			redirect: 'follow',
			signal: AbortSignal.timeout(8000)
		});
		if (!response.ok) return { html: '', ok: false };

		const contentLength = Number(response.headers.get('content-length') ?? 0);
		if (contentLength > MAX_RESPONSE_BYTES) return null;

		const html = await response.text();
		if (html.length > MAX_RESPONSE_BYTES) return null;

		return { html, ok: true };
	} catch {
		return null;
	}
}

/**
 * The full fallback cascade: oEmbed → domain-specific API → URL slug parsing.
 */
async function runFallbackCascade(targetUrl: string): Promise<PageMetadata | null> {
	// 1. oEmbed
	const oembedResult = await tryOEmbed(targetUrl);
	if (oembedResult) return oembedResult;

	// 2. Domain-specific APIs + URL slug parsing
	const urlFallback = await buildFallbackFromUrl(targetUrl);
	if (urlFallback) return urlFallback;

	return null;
}

/** Cache a result and return a JSON response */
function cacheAndReturn(targetUrl: string, data: PageMetadata) {
	if (ogCache.size >= MAX_CACHE_SIZE) {
		const oldest = ogCache.keys().next().value;
		if (oldest) ogCache.delete(oldest);
	}
	ogCache.set(targetUrl, { data, expiry: Date.now() + CACHE_TTL_MS });
	return json(data, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}

export const GET: RequestHandler = async ({ url, getClientAddress }) => {
	const ip = getClientAddress();
	if (isRateLimited(ip)) {
		return json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
	}

	const targetUrl = url.searchParams.get('url');
	if (!targetUrl) {
		return json({ error: 'Missing url parameter' }, { status: 400 });
	}

	const check = isUrlSafe(targetUrl);
	if (!check.ok) {
		return json({ error: check.error }, { status: 400 });
	}

	// Check server-side cache
	const cached = ogCache.get(targetUrl);
	if (cached && cached.expiry > Date.now()) {
		return json(cached.data, {
			headers: { 'Cache-Control': 'public, max-age=3600' }
		});
	}

	// ── Tier 0: oEmbed for known providers (most reliable, no IP blocking) ──
	const oembedResult = await tryOEmbed(targetUrl);
	if (oembedResult && oembedResult.title !== targetUrl) {
		return cacheAndReturn(targetUrl, oembedResult);
	}

	// ── Tier 1: Direct fetch with browser UA ──
	let browserMetadata: PageMetadata | null = null;
	const browserResult = await fetchHtml(targetUrl, buildBrowserHeaders(targetUrl));

	if (browserResult?.ok && browserResult.html && !isLowQualityResponse(browserResult.html, targetUrl)) {
		browserMetadata = parseOgTags(browserResult.html, targetUrl);

		// Server-side price enrichment
		const hostname = new URL(targetUrl).hostname;
		if (!browserMetadata.price) {
			if (isAmazonDomain(hostname)) {
				browserMetadata.price = extractAmazonPrice(browserResult.html);

				// Amazon WAF often strips price data — try mobile endpoint as fallback
				if (!browserMetadata.price) {
					const asin = extractAsin(targetUrl);
					if (asin) {
						const mobile = await tryAmazonMobile(asin, hostname.replace(/^www\./, ''));
						if (mobile.price) browserMetadata.price = mobile.price;
						if (mobile.image && !browserMetadata.image) browserMetadata.image = mobile.image;
						if (mobile.title && (!browserMetadata.title || browserMetadata.title === targetUrl)) {
							browserMetadata.title = mobile.title;
						}
					}
				}
			} else {
				browserMetadata.price = extractGenericPrice(browserResult.html);
			}
			if (browserMetadata.price) browserMetadata.type = 'product';
		}
		if (isProductDomain(hostname) && browserMetadata.type !== 'product') {
			browserMetadata.type = 'product';
		}

		// If we got an image, return immediately — we have what we need.
		// If only description (no image), fall through to crawler UA which
		// often gets og:image from social crawler headers that browser UA misses.
		if (browserMetadata.image && browserMetadata.description) {
			return cacheAndReturn(targetUrl, browserMetadata);
		}
		// Otherwise fall through to try crawler UA for better metadata
	}

	// ── Tier 2: Retry with crawler UA (sites serve OG to social crawlers) ──
	const crawlerResult = await fetchHtml(targetUrl, buildCrawlerHeaders());

	if (crawlerResult?.ok && crawlerResult.html && !isLowQualityResponse(crawlerResult.html, targetUrl)) {
		const crawlerMetadata = parseOgTags(crawlerResult.html, targetUrl);
		// Merge: prefer crawler but backfill missing fields from browser
		if (browserMetadata) {
			if (!crawlerMetadata.image && browserMetadata.image) crawlerMetadata.image = browserMetadata.image;
			if (!crawlerMetadata.price && browserMetadata.price) crawlerMetadata.price = browserMetadata.price;
			if (!crawlerMetadata.enrichment && browserMetadata.enrichment) crawlerMetadata.enrichment = browserMetadata.enrichment;
			if (!crawlerMetadata.description && browserMetadata.description) crawlerMetadata.description = browserMetadata.description;
			if (crawlerMetadata.type === 'link' && browserMetadata.type !== 'link') crawlerMetadata.type = browserMetadata.type;
		}
		if (crawlerMetadata.image || crawlerMetadata.description || crawlerMetadata.enrichment) {
			return cacheAndReturn(targetUrl, crawlerMetadata);
		}
		// Crawler also had no metadata — use browser result if available
		if (browserMetadata && browserMetadata.title !== targetUrl) {
			return cacheAndReturn(targetUrl, browserMetadata);
		}
	} else if (browserMetadata && browserMetadata.title !== targetUrl) {
		// Crawler failed entirely but browser had something
		return cacheAndReturn(targetUrl, browserMetadata);
	}

	// ── Tier 3: Fallback cascade (oEmbed → domain APIs → URL slug) ──
	const fallback = await runFallbackCascade(targetUrl);
	if (fallback) {
		return cacheAndReturn(targetUrl, fallback);
	}

	// ── Tier 4: If browser fetch got SOME HTML, parse it anyway (better than nothing) ──
	if (browserResult?.ok && browserResult.html) {
		const metadata = parseOgTags(browserResult.html, targetUrl);
		// Only use if we got a real title (not just the URL)
		if (metadata.title && metadata.title !== targetUrl) {
			return cacheAndReturn(targetUrl, metadata);
		}
	}

	// ── Last resort: return the URL as a link with domain info ──
	try {
		const domain = new URL(targetUrl).hostname.replace(/^www\./, '');
		const slugTitle = titleFromUrlSlug(new URL(targetUrl).pathname);
		const lastResort: PageMetadata = {
			title: slugTitle ?? targetUrl,
			image: null,
			description: null,
			url: targetUrl,
			price: null,
			type: 'link'
		};

		// For Amazon URLs, make one last attempt via mobile endpoint
		if (isAmazonDomain(domain)) {
			const asin = extractAsin(targetUrl);
			if (asin) {
				const mobile = await tryAmazonMobile(asin, domain);
				if (mobile.price) lastResort.price = mobile.price;
				if (mobile.image) lastResort.image = mobile.image;
				if (mobile.title) lastResort.title = mobile.title;
			}
			lastResort.type = 'product';
		} else if (isProductDomain(domain)) {
			lastResort.type = 'product';
		}

		return cacheAndReturn(targetUrl, lastResort);
	} catch {
		return json({ error: 'Failed to fetch URL' }, { status: 502 });
	}
};
