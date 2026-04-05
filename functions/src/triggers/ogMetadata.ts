/**
 * @file ogMetadata.ts
 * @description HTTPS Cloud Function that fetches a URL and extracts OG metadata
 *              for link card enrichment. Uses modular enrichment architecture.
 *
 * Multi-tier fallback strategy:
 *   1. Cache check (1 hour)
 *   2. Enrichment service (open-graph-scraper + oEmbed + optional Microlink/AI)
 *   3. Direct fetch with browser UA → parse OG/JSON-LD
 *   4. Retry with crawler UA (facebookexternalhit)
 *   5. oEmbed for supported providers
 *   6. Domain-specific APIs (IMDB Suggest, GitHub REST)
 *   7. Universal URL slug title extraction
 */

import { onRequest } from 'firebase-functions/v2/https';
import { enrichUrl, type EnrichmentResult } from '../utils/enrichmentService.js';
import { fetchOEmbed } from '../utils/oembedService.js';
import { extractEnrichmentFromJsonLd, str, personName, formatIsoDuration, extractIngredients, extractInstructions } from '../utils/jsonLdParser.js';
import { ENRICHMENT_CONFIG } from '../config/enrichmentConfig.js';
import type { StructuredEnrichment } from '../types/jsonLdTypes.js';

// Use EnrichmentResult from enrichmentService as PageMetadata
type PageMetadata = EnrichmentResult;

// ─── Domain lists ────────────────────────────────────────────────────────────

const RECIPE_DOMAINS = ['allrecipes.com', 'food.com', 'epicurious.com', 'bonappetit.com', 'seriouseats.com', 'tasty.co', 'delish.com', 'foodnetwork.com', 'simplyrecipes.com', 'budgetbytes.com', 'cookieandkate.com', 'minimalistbaker.com', 'halfbakedharvest.com', 'food52.com', 'thekitchn.com', 'smittenkitchen.com', 'kingarthurbaking.com', 'cooking.nytimes.com', 'eatingwell.com', 'tasteofhome.com', 'bbcgoodfood.com', 'jamieoliver.com', 'pinchofyum.com', 'loveandlemons.com', 'damndelicious.net', 'recipetineats.com'];
const MOVIE_DOMAINS = ['imdb.com', 'letterboxd.com', 'rottentomatoes.com', 'themoviedb.org', 'netflix.com', 'tv.apple.com', 'disneyplus.com', 'hbo.com', 'max.com', 'hulu.com', 'primevideo.com', 'crunchyroll.com', 'mubi.com', 'criterion.com', 'paramountplus.com', 'peacocktv.com', 'tubitv.com', 'pluto.tv', 'justwatch.com', 'trakt.tv', 'tvtime.com', 'serializd.com'];
const BOOK_DOMAINS = ['goodreads.com', 'openlibrary.org', 'bookshop.org', 'books.google.com', 'penguin.com', 'harpercollins.com', 'simonandschuster.com', 'barnesandnoble.com', 'libro.fm'];
const PLACE_DOMAINS = ['yelp.com', 'tripadvisor.com', 'foursquare.com', 'opentable.com', 'thefork.com', 'zomato.com', 'happycow.net', 'timeout.com'];
const MUSIC_DOMAINS = ['open.spotify.com', 'spotify.com', 'soundcloud.com', 'music.apple.com', 'tidal.com', 'bandcamp.com', 'deezer.com', 'last.fm'];
const ARTICLE_DOMAINS = ['medium.com', 'substack.com', 'nytimes.com', 'theguardian.com', 'washingtonpost.com', 'bbc.com', 'bbc.co.uk', 'arstechnica.com', 'theverge.com', 'wired.com', 'theatlantic.com', 'newyorker.com', 'reuters.com', 'apnews.com', 'economist.com', 'ft.com', 'bloomberg.com', 'techcrunch.com', 'thenextweb.com', 'dev.to', 'hackernoon.com', 'longform.org', 'nautil.us'];
const SOCIAL_DOMAINS = ['twitter.com', 'x.com', 'instagram.com', 'threads.net', 'reddit.com', 'mastodon.social', 'bsky.app', 'tumblr.com', 'facebook.com', 'linkedin.com', 'tiktok.com', 'pinterest.com'];
const GITHUB_DOMAINS = ['github.com', 'gitlab.com', 'bitbucket.org', 'gist.github.com'];
const VIDEO_PLATFORM_DOMAINS = ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'dailymotion.com', 'twitch.tv', 'rumble.com', 'bitchute.com', 'odysee.com', 'streamable.com', 'loom.com'];
const PRODUCT_DOMAINS = ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.es', 'amazon.fr', 'amazon.it', 'amazon.ca', 'amazon.co.jp', 'amazon.com.au', 'walmart.com', 'target.com', 'bestbuy.com', 'costco.com', 'homedepot.com', 'lowes.com', 'macys.com', 'nordstrom.com', 'ebay.com', 'etsy.com', 'aliexpress.com', 'newegg.com', 'wayfair.com', 'ikea.com', 'zappos.com', 'asos.com', 'shein.com', 'zara.com', 'hm.com'];

function matchesDomain(domain: string, list: readonly string[]): boolean {
	return list.some(d => domain === d || domain.endsWith('.' + d));
}

function isAmazonVideoUrl(domain: string, url: string): boolean {
	if (!/(?:^|\.)amazon\.\w+(?:\.\w+)?$/.test(domain)) return false;
	return /\/gp\/video\/|\/dp\/[A-Z0-9]+.*video|\/Amazon-Video/i.test(url);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
	USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', KRW: '₩',
	INR: '₹', RUB: '₽', BRL: 'R$', CAD: 'CA$', AUD: 'A$'
};
function currencySymbol(code: string): string { return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code; }

function isProductDomain(hostname: string): boolean {
	const clean = hostname.replace(/^www\./, '');
	return PRODUCT_DOMAINS.some(d => clean === d || clean.endsWith('.' + d));
}

function isAmazonDomain(hostname: string): boolean {
	return /(?:^|\.)amazon\.\w+(?:\.\w+)?$/.test(hostname.replace(/^www\./, ''));
}

function isPrivateHost(hostname: string): boolean {
	const clean = hostname.replace(/^\[|\]$/g, '').split('%')[0];
	if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/.test(clean)) return true;
	if (clean === 'localhost') return true;
	if (/^(::1|::$|fc00:|fd00:|fe80:)/i.test(clean)) return true;
	const v4mapped = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	if (v4mapped) return isPrivateHost(v4mapped[1]);
	return false;
}

function isUrlSafe(targetUrl: string): { ok: boolean; error?: string } {
	let parsed: URL;
	try { parsed = new URL(targetUrl); } catch { return { ok: false, error: 'Invalid URL' }; }
	if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'Only http/https URLs are allowed' };
	if (isPrivateHost(parsed.hostname)) return { ok: false, error: 'Internal/private URLs are not allowed' };
	return { ok: true };
}

// ─── Rate limiter ────────────────────────────────────────────────────────────

const rateLimiter = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const entry = rateLimiter.get(ip);
	if (!entry || entry.resetAt < now) {
		rateLimiter.set(ip, { count: 1, resetAt: now + ENRICHMENT_CONFIG.rateLimit.windowMs });
		return false;
	}
	entry.count++;
	return entry.count > ENRICHMENT_CONFIG.rateLimit.maxRequests;
}

// ─── Response quality detection ──────────────────────────────────────────────

function isLowQualityResponse(html: string, targetUrl: string): boolean {
	if (html.length < 200) return true;
	if (html.length < 5000) {
		if (html.includes('AwsWafIntegration') || html.includes('challenge.js')) return true;
		if (html.includes('cf-browser-verification') || html.includes('cf_clearance')) return true;
		if (html.includes('Checking your browser') || (html.includes('Just a moment') && html.includes('cloudflare'))) return true;
	}
	if (!html.includes('og:title') && !html.includes('og:description')) {
		if (html.length < 10000 && (html.includes('captcha') || html.includes('robot'))) return true;
	}
	const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
	if (titleMatch?.[1]) {
		const title = titleMatch[1].trim().toLowerCase();
		const generic = ['just a moment', 'attention required', 'access denied', 'please wait', 'checking your browser', 'security check', 'verify you are a robot', 'are you a robot', 'visit tiktok to discover videos', 'tiktok - make your day'];
		if (generic.some(g => title.includes(g))) return true;
		try {
			const domain = new URL(targetUrl).hostname.replace(/^www\./, '').split('.')[0];
			if (title === domain && !html.includes('og:title')) return true;
		} catch { /* */ }
	}
	return false;
}

// ─── JSON-LD Price Extraction ────────────────────────────────────────────────

function extractJsonLdPrice(offers: unknown): string | null {
	if (!offers || typeof offers !== 'object') return null;
	const list = Array.isArray(offers) ? offers : [offers];
	for (const offer of list) {
		if (typeof offer !== 'object' || offer === null) continue;
		const o = offer as Record<string, unknown>;
		if (o['@type'] === 'AggregateOffer' && o.lowPrice) return `${currencySymbol(String(o.priceCurrency || 'USD'))}${o.lowPrice}`;
		if (o.price != null && String(o.price) !== '0') return `${currencySymbol(String(o.priceCurrency || 'USD'))}${o.price}`;
		if (o.offers) { const n = extractJsonLdPrice(o.offers); if (n) return n; }
	}
	return null;
}

function walkJsonLdProduct(data: unknown, out: { title: string | null; image: string | null; price: string | null; isProduct: boolean }): void {
	if (!data || typeof data !== 'object') return;
	if (Array.isArray(data)) { for (const item of data) walkJsonLdProduct(item, out); return; }
	const obj = data as Record<string, unknown>;
	if (Array.isArray(obj['@graph'])) { for (const item of obj['@graph']) walkJsonLdProduct(item, out); return; }
	const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
	const productTypes = ['Product', 'IndividualProduct', 'ProductGroup', 'ProductModel'];
	const isProduct = types.some(t => typeof t === 'string' && productTypes.some(pt => t === pt || t.endsWith('/' + pt)));
	if (isProduct) {
		out.isProduct = true;
		if (obj.name && typeof obj.name === 'string') out.title = obj.name;
		if (obj.image) {
			if (typeof obj.image === 'string') out.image = obj.image;
			else if (Array.isArray(obj.image)) out.image = typeof obj.image[0] === 'string' ? obj.image[0] : (obj.image[0] as Record<string, unknown>)?.url as string ?? null;
			else if (typeof obj.image === 'object') out.image = (obj.image as Record<string, unknown>).url as string ?? null;
		}
		const price = extractJsonLdPrice(obj.offers);
		if (price) out.price = price;
		if (!out.price && obj.price != null && String(obj.price) !== '0') out.price = `${currencySymbol(String((obj as Record<string, unknown>).priceCurrency || 'USD'))}${obj.price}`;
	}
	if (obj.mainEntity) walkJsonLdProduct(obj.mainEntity, out);
	if (obj.mainEntityOfPage) walkJsonLdProduct(obj.mainEntityOfPage, out);
}

// ─── OG Tag Parser ───────────────────────────────────────────────────────────

function parseOgTags(html: string, url: string): PageMetadata {
	const get = (pattern: RegExp): string | null => {
		const m = html.match(pattern);
		return m?.[1]?.trim() ?? null;
	};

	// JSON-LD extraction
	const jsonLd = { title: null as string | null, image: null as string | null, price: null as string | null, isProduct: false };
	let enrichment: StructuredEnrichment | null = null;
	try {
		const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
		if (jsonLdMatch) {
			for (const scriptTag of jsonLdMatch) {
				try {
					const content = scriptTag.replace(/<script[^>]*>|<\/script>/gi, '');
					const data = JSON.parse(content);
					walkJsonLdProduct(data, jsonLd);
					if (!enrichment) enrichment = extractEnrichmentFromJsonLd(data);
				} catch { /* skip */ }
			}
		}
	} catch { /* */ }

	const ogTitle = get(/<meta[^>]+(?:property|name)="og:title"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="og:title"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:title"[^>]+content="([^"]*)"/i) ??
		get(/<title[^>]*>([^<]*)<\/title>/i) ??
		jsonLd.title;

	const ogImage = get(/<meta[^>]+(?:property|name)="og:image"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="og:image"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:image"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:image:src"[^>]+content="([^"]*)"/i) ??
		jsonLd.image;

	const ogDescription = get(/<meta[^>]+(?:property|name)="og:description"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="og:description"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:description"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);

	const ogType = get(/<meta[^>]+property="og:type"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+property="og:type"/i);

	const siteName = get(/<meta[^>]+(?:property|name)="og:site_name"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="og:site_name"/i);

	// Price extraction
	const metaPrice = get(/<meta[^>]+(?:property|name)="(?:product:price:amount|og:price:amount)"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:product:price:amount|og:price:amount)"/i);
	const metaCurrency = get(/<meta[^>]+(?:property|name)="(?:product:price:currency|og:price:currency)"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:product:price:currency|og:price:currency)"/i);
	let price = metaPrice ? (metaCurrency ? `${currencySymbol(metaCurrency)}${metaPrice}` : metaPrice) : jsonLd.price;

	// Type detection
	const isExplicitProduct = !!price || ogType === 'product' || ogType === 'product.item' || jsonLd.isProduct;
	let type: string = 'link';
	if (isExplicitProduct) type = 'product';
	else if (ogType === 'video' || ogType === 'video.other') type = 'video';
	else if (ogType === 'article') type = 'article';

	// Image URL resolution
	let finalImage = ogImage;
	if (finalImage && !finalImage.startsWith('http')) {
		try { finalImage = new URL(finalImage, new URL(url).origin).toString(); } catch { /* */ }
	}

	// YouTube detection
	const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
	const youtubeId = ytMatch?.[1] ?? null;
	if (youtubeId) {
		type = 'video';
		if (!finalImage) finalImage = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
	}

	// Domain-based enrichment fallbacks
	let urlDomain = '';
	try { urlDomain = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { /* */ }

	// Article fallback
	if (!enrichment && (type === 'article' || ogType === 'article')) {
		const articleAuthor = get(/<meta[^>]+(?:property|name)="(?:article:author|author)"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:article:author|author)"/i);
		const articleDate = get(/<meta[^>]+(?:property|name)="(?:article:published_time|date)"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="article:published_time"/i);
		if (articleAuthor || articleDate) {
			enrichment = { kind: 'article', author: articleAuthor, publishedDate: articleDate ? articleDate.slice(0, 10) : null, readingTime: null, siteName };
		}
	}

	if (!enrichment && matchesDomain(urlDomain, RECIPE_DOMAINS)) {
		enrichment = { kind: 'recipe', cookTime: null, prepTime: null, totalTime: null, servings: null, ingredients: [], instructions: [], cuisine: null, calories: null };
	}

	// Music fallback
	const existingMusicNoArtist = enrichment && enrichment.kind === 'music' && !(enrichment as any).artist;
	if (matchesDomain(urlDomain, MUSIC_DOMAINS) && (!enrichment || existingMusicNoArtist)) {
		let artist: string | null = null;
		let album: string | null = null;
		if (ogTitle) {
			const m = ogTitle.match(/^(.+?)\s+(?:by|[-–—·])\s+(.+?)(?:\s+\||\s+on\s+|$)/i);
			if (m) artist = m[2].trim();
		}
		if (!artist && ogDescription) {
			const parts = ogDescription.split(/\s*·\s*/);
			const skip = ['song', 'album', 'single', 'ep', 'podcast', 'episode'];
			const cands = parts.filter((p: string) => {
				const t = p.trim().toLowerCase();
				return t && !/^\d{4}$/.test(t) && !/^\d+\s+songs?$/.test(t) && !skip.includes(t);
			});
			if (cands.length > 0) artist = cands[0].trim() || null;
			if (parts.length >= 3) {
				const ac = parts.find((p: string) => {
					const t = p.trim().toLowerCase();
					return t && t !== artist?.toLowerCase() && !/^\d{4}$/.test(t) && !/^\d+\s+songs?$/.test(t) && !skip.includes(t);
				});
				if (ac) album = ac.trim();
			}
		}
		const metaArtist = get(/<meta[^>]+(?:property|name)="(?:music:musician|og:audio:artist)"[^>]+content="([^"]*)"/i);
		if (metaArtist) artist = metaArtist;
		enrichment = { kind: 'music', artist, album, duration: null, genre: null } as StructuredEnrichment;
	}

	// Place fallback
	if (!enrichment && (matchesDomain(urlDomain, PLACE_DOMAINS) || urlDomain.startsWith('maps.'))) {
		let rating: string | null = null;
		let category: string | null = null;
		if (ogDescription) {
			const rm = ogDescription.match(/(\d+\.?\d?)\s*(?:star|★|\/5)/i);
			if (rm) rating = rm[1];
			const cm = ogDescription.match(/^([^.·\-—]+?)(?:\s*[.·\-—])/);
			if (cm && cm[1].length < 40) category = cm[1].trim();
		}
		enrichment = { kind: 'place', address: null, phone: null, priceRange: null, category, rating, ratingCount: null, latitude: null, longitude: null, hours: null };
	}

	// Movie fallback
	if (!enrichment && (matchesDomain(urlDomain, MOVIE_DOMAINS) || isAmazonVideoUrl(urlDomain, url))) {
		let director: string | null = null;
		let year: number | null = null;
		let rating: string | null = null;
		let ratingSource: string | null = null;
		let cast: string[] = [];
		if (ogTitle) {
			const ym = ogTitle.match(/\((\d{4})\)/);
			if (ym) year = parseInt(ym[1], 10);
			const dm = ogTitle.match(/directed by\s+(.+?)$/i);
			if (dm) director = dm[1].replace(/\s*[|–—-]\s*.*$/, '').trim();
		}
		if (ogDescription) {
			const idm = ogDescription.match(/^Directed by\s+(.+?)\.\s+With\s+/i);
			if (idm) director = idm[1].trim();
			const icm = ogDescription.match(/With\s+(.+?)\.\s/i);
			if (icm) cast = icm[1].split(/,\s*/).map(s => s.trim()).filter(Boolean).slice(0, 6);
			const irm = ogDescription.match(/(\d+\.?\d?)\/10/);
			if (irm) { rating = irm[1]; ratingSource = '/10'; }
			if (!rating) {
				const rt = ogDescription.match(/(\d+)%/);
				if (rt) { rating = rt[1]; ratingSource = '%'; }
			}
		}
		enrichment = { kind: 'movie', director, year, runtime: null, genre: null, rating, ratingSource, cast, contentRating: null };
	}

	// Book fallback
	if (!enrichment && matchesDomain(urlDomain, BOOK_DOMAINS)) {
		let author: string | null = null;
		let averageRating: string | null = null;
		const metaAuthor = get(/<meta[^>]+(?:property|name)="book:author"[^>]+content="([^"]*)"/i);
		if (metaAuthor) author = metaAuthor;
		if (!author && ogTitle) {
			const bm = ogTitle.match(/^(.+?)\s+by\s+(.+?)(?:\s+\||\s+on\s+|$)/i);
			if (bm) author = bm[2].trim();
		}
		if (ogDescription) {
			const grm = ogDescription.match(/(\d+\.?\d{1,2})\s*(?:avg\s+)?rating/i);
			if (grm) averageRating = grm[1];
		}
		enrichment = { kind: 'book', author, genre: null, pageCount: null, isbn: null, publisher: null, publishDate: null, averageRating };
	}

	// GitHub fallback
	if (!enrichment && matchesDomain(urlDomain, GITHUB_DOMAINS)) {
		let owner: string | null = null;
		let repo: string | null = null;
		if (ogTitle) {
			const rm = ogTitle.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
			if (rm) { owner = rm[1]; repo = rm[2]; }
		}
		if (!owner) {
			try {
				const parts = new URL(url).pathname.split('/').filter(Boolean);
				if (parts.length >= 2) { owner = parts[0]; repo = parts[1]; }
			} catch { /* */ }
		}
		enrichment = { kind: 'github', owner, repo, description: ogDescription, language: null, stars: null, forks: null };
	}

	// Article domain fallback
	if (!enrichment && matchesDomain(urlDomain, ARTICLE_DOMAINS)) {
		const articleAuthor = get(/<meta[^>]+(?:property|name)="(?:article:author|author)"[^>]+content="([^"]*)"/i);
		const articleDate = get(/<meta[^>]+(?:property|name)="(?:article:published_time|date)"[^>]+content="([^"]*)"/i);
		enrichment = { kind: 'article', author: articleAuthor, publishedDate: articleDate ? articleDate.slice(0, 10) : null, readingTime: null, siteName };
	}

	return {
		title: ogTitle ?? url,
		image: finalImage ?? null,
		description: ogDescription ?? null,
		url,
		price: price ?? null,
		type: type as 'link' | 'product' | 'video' | 'article',
		youtubeId,
		enrichment: enrichment ?? null
	};
}

// ─── Price extraction ────────────────────────────────────────────────────────

function extractAmazonPrice(html: string): string | null {
	const cp = html.match(/class="a-price-whole"[^>]*>([^<]+)</i);
	const cf = html.match(/class="a-price-fraction"[^>]*>([^<]+)</i);
	if (cp?.[1]) { return `$${cp[1].replace(/[^\d]/g, '')}.${cf?.[1]?.replace(/[^\d]/g, '') ?? '00'}`; }
	const pb = html.match(/id="priceblock_(?:ourprice|dealprice|saleprice)"[^>]*>\s*([^<]+)/i);
	if (pb?.[1]?.trim()) return pb[1].trim();
	const ap = html.match(/<span[^>]*class="a-offscreen"[^>]*>\s*([£$€¥₹][\d.,]+)/i);
	if (ap?.[1]) return ap[1];
	return null;
}

function extractGenericPrice(html: string): string | null {
	const patterns = [
		/<span[^>]*class="[^"]*price[^"]*"[^>]*>\s*([£$€¥₹₩₽R][\s\d.,]+)/i,
		/itemprop="price"[^>]*content="([\d.,]+)"/i,
		/data-price="([\d.,]+)"/i
	];
	for (const p of patterns) {
		const m = html.match(p);
		if (m?.[1]) {
			const raw = m[1].trim();
			return /^\d/.test(raw) ? `$${raw}` : raw;
		}
	}
	return null;
}

// ─── IMDB Suggest API ────────────────────────────────────────────────────────

async function tryImdbSuggest(imdbId: string): Promise<PageMetadata | null> {
	try {
		const res = await fetch(`https://v2.sg.media-imdb.com/suggestion/t/${imdbId}.json`, {
			signal: AbortSignal.timeout(ENRICHMENT_CONFIG.timeouts.imdbApi),
			headers: { 'User-Agent': 'Nearboard/1.0' }
		});
		if (!res.ok) return null;
		const data = await res.json();
		const entry = data.d?.find((d: Record<string, unknown>) => d.id === imdbId);
		if (!entry) return null;
		const cast = entry.s ? entry.s.split(', ').slice(0, 6) : [];
		const posterUrl = entry.i?.imageUrl ? entry.i.imageUrl.replace(/\._V1_\./, '._V1_SX600_.') : null;
		return {
			title: entry.l || `IMDB ${imdbId}`,
			image: posterUrl,
			description: cast.length > 0 ? `Starring ${cast.join(', ')}` : null,
			url: `https://www.imdb.com/title/${imdbId}/`,
			price: null,
			type: 'link',
			enrichment: { kind: 'movie', director: null, year: entry.y ?? null, runtime: null, genre: null, rating: null, ratingSource: null, cast, contentRating: null }
		};
	} catch { return null; }
}

// ─── URL fallback ────────────────────────────────────────────────────────────

function titleFromUrlSlug(pathname: string): string | null {
	const segments = pathname.split('/').filter(Boolean);
	const slug = segments
		.filter(s => !/^[a-f0-9]{8,}$/i.test(s))
		.filter(s => !/^\d+$/.test(s))
		.filter(s => s.length > 2)
		.pop();
	if (!slug) return null;
	return slug
		.replace(/[-_+]/g, ' ')
		.replace(/\.\w+$/, '')
		.replace(/\b\w/g, c => c.toUpperCase())
		.trim() || null;
}

function buildMinimalEnrichment(kind: string): StructuredEnrichment | null {
	switch (kind) {
		case 'movie': return { kind: 'movie', director: null, year: null, runtime: null, genre: null, rating: null, ratingSource: null, cast: [], contentRating: null };
		case 'recipe': return { kind: 'recipe', cookTime: null, prepTime: null, totalTime: null, servings: null, ingredients: [], instructions: [], cuisine: null, calories: null };
		case 'book': return { kind: 'book', author: null, genre: null, pageCount: null, isbn: null, publisher: null, publishDate: null, averageRating: null };
		case 'music': return { kind: 'music', artist: null, album: null, duration: null, genre: null };
		case 'place': return { kind: 'place', address: null, phone: null, priceRange: null, category: null, rating: null, ratingCount: null, latitude: null, longitude: null, hours: null };
		case 'article': return { kind: 'article', author: null, publishedDate: null, readingTime: null, siteName: null };
		case 'github': return { kind: 'github', owner: null, repo: null, description: null, language: null, stars: null, forks: null };
		default: return null;
	}
}

async function buildFallbackFromUrl(targetUrl: string): Promise<PageMetadata | null> {
	let parsed: URL;
	try { parsed = new URL(targetUrl); } catch { return null; }
	const domain = parsed.hostname.replace(/^www\./, '');

	if (matchesDomain(domain, MOVIE_DOMAINS)) {
		const imdbMatch = parsed.pathname.match(/\/title\/(tt\d+)/);
		if (imdbMatch) {
			const d = await tryImdbSuggest(imdbMatch[1]);
			if (d) return { ...d, url: targetUrl };
		}
		return {
			title: titleFromUrlSlug(parsed.pathname) ?? `Movie on ${domain}`,
			image: null,
			description: null,
			url: targetUrl,
			price: null,
			type: 'link',
			enrichment: buildMinimalEnrichment('movie')
		};
	}

	if (matchesDomain(domain, GITHUB_DOMAINS) && domain.includes('github')) {
		const parts = parsed.pathname.split('/').filter(Boolean);
		if (parts.length >= 2 && !['settings', 'pulls', 'issues', 'actions', 'wiki'].includes(parts[1])) {
			try {
				const ghRes = await fetch(`https://api.github.com/repos/${parts[0]}/${parts[1]}`, {
					headers: {
						'Accept': 'application/vnd.github.v3+json',
						'User-Agent': 'Nearboard/1.0'
					},
					signal: AbortSignal.timeout(ENRICHMENT_CONFIG.timeouts.githubApi)
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
							kind: 'github',
							owner: parts[0],
							repo: parts[1],
							description: gh.description || null,
							language: gh.language || null,
							stars: gh.stargazers_count ? String(gh.stargazers_count) : null,
							forks: gh.forks_count ? String(gh.forks_count) : null
						}
					};
				}
			} catch { /* */ }
			return {
				title: `${parts[0]}/${parts[1]}`,
				image: null,
				description: null,
				url: targetUrl,
				price: null,
				type: 'link',
				enrichment: { kind: 'github', owner: parts[0], repo: parts[1], description: null, language: null, stars: null, forks: null }
			};
		}
	}

	// Known content domains
	const allContent = [...RECIPE_DOMAINS, ...BOOK_DOMAINS, ...MUSIC_DOMAINS, ...ARTICLE_DOMAINS, ...PLACE_DOMAINS];
	if (matchesDomain(domain, allContent)) {
		const kinds: [readonly string[], string][] = [
			[RECIPE_DOMAINS, 'recipe'],
			[BOOK_DOMAINS, 'book'],
			[MUSIC_DOMAINS, 'music'],
			[ARTICLE_DOMAINS, 'article'],
			[PLACE_DOMAINS, 'place']
		];
		const kind = kinds.find(([list]) => matchesDomain(domain, list))?.[1] ?? null;
		return {
			title: titleFromUrlSlug(parsed.pathname) ?? `${kind ?? 'Content'} on ${domain}`,
			image: null,
			description: null,
			url: targetUrl,
			price: null,
			type: 'link',
			enrichment: kind ? buildMinimalEnrichment(kind) : null
		};
	}

	if (VIDEO_PLATFORM_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
		return {
			title: titleFromUrlSlug(parsed.pathname) ?? `Video on ${domain}`,
			image: null,
			description: null,
			url: targetUrl,
			price: null,
			type: 'video'
		};
	}

	if (matchesDomain(domain, SOCIAL_DOMAINS)) {
		const um = parsed.pathname.match(/^\/@?([a-zA-Z0-9_.]+)/);
		return {
			title: titleFromUrlSlug(parsed.pathname) ?? (um ? `@${um[1]} on ${domain}` : `Post on ${domain}`),
			image: null,
			description: um ? `@${um[1]}` : null,
			url: targetUrl,
			price: null,
			type: 'link'
		};
	}

	const slugTitle = titleFromUrlSlug(parsed.pathname);
	if (slugTitle && slugTitle.length > 3) {
		return { title: slugTitle, image: null, description: null, url: targetUrl, price: null, type: 'link' };
	}
	return null;
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

function buildBrowserHeaders(targetUrl: string): Record<string, string> {
	const headers: Record<string, string> = {
		'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
		'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9'
	};
	try {
		if (isAmazonDomain(new URL(targetUrl).hostname)) {
			headers['Cookie'] = 'session-id=000-0000000-0000000; i18n-prefs=USD';
		}
	} catch { /* */ }
	return headers;
}

function buildCrawlerHeaders(): Record<string, string> {
	return {
		'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
		'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9'
	};
}

function buildGooglebotHeaders(): Record<string, string> {
	return {
		'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
		'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9'
	};
}

async function fetchHtml(targetUrl: string, headers: Record<string, string>): Promise<{ html: string; ok: boolean } | null> {
	try {
		const response = await fetch(targetUrl, {
			headers,
			redirect: 'follow',
			signal: AbortSignal.timeout(ENRICHMENT_CONFIG.timeouts.fetchHtml)
		});
		if (!response.ok) return { html: '', ok: false };
		const contentLength = Number(response.headers.get('content-length') ?? 0);
		if (contentLength > ENRICHMENT_CONFIG.response.maxBytes) return null;
		const html = await response.text();
		if (html.length > ENRICHMENT_CONFIG.response.maxBytes) return null;
		return { html, ok: true };
	} catch { return null; }
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const ogCache = new Map<string, { data: PageMetadata; expiry: number }>();

// ─── Cloud Function ──────────────────────────────────────────────────────────

export const ogMetadata = onRequest(
	{
		region: 'us-central1',
		cors: true,
		timeoutSeconds: 30,
		memory: '512MiB'
	},
	async (req, res) => {
		const ip = req.ip ?? req.headers['x-forwarded-for'] as string ?? 'unknown';
		if (isRateLimited(ip)) {
			res.status(429).json({ error: 'Too many requests' });
			return;
		}

		const targetUrl = req.query.url as string;
		if (!targetUrl) {
			res.status(400).json({ error: 'Missing url parameter' });
			return;
		}

		const check = isUrlSafe(targetUrl);
		if (!check.ok) {
			res.status(400).json({ error: check.error });
			return;
		}

		// Cache check
		const cached = ogCache.get(targetUrl);
		if (cached && cached.expiry > Date.now()) {
			res.set('Cache-Control', 'public, max-age=3600');
			res.json(cached.data);
			return;
		}

		const cacheAndSend = (data: PageMetadata) => {
			if (ogCache.size >= ENRICHMENT_CONFIG.cache.maxSize) {
				const oldest = ogCache.keys().next().value;
				if (oldest) ogCache.delete(oldest);
			}
			ogCache.set(targetUrl, { data, expiry: Date.now() + ENRICHMENT_CONFIG.cache.ttlMs });
			res.set('Cache-Control', 'public, max-age=3600');
			res.json(data);
		};

		// PRIMARY: Use enhanced enrichment service
		try {
			const enriched = await enrichUrl(targetUrl);

			// Convert enrichmentService result to PageMetadata format
			const result: PageMetadata = {
				title: enriched.title,
				image: enriched.image,
				description: enriched.description,
				url: enriched.url,
				price: enriched.price,
				type: enriched.type,
				youtubeId: enriched.youtubeId,
				enrichment: enriched.enrichment,
				screenshotUrl: enriched.screenshotUrl,
				logoUrl: enriched.logoUrl,
				classification: enriched.classification,
				socialMetrics: enriched.socialMetrics,
				videoDuration: enriched.videoDuration,
				siteName: enriched.siteName
			};

			// If we got good data, return it
			if (result.title !== targetUrl || result.image || result.description) {
				cacheAndSend(result);
				return;
			}
		} catch (error) {
			console.error('Enrichment service failed, falling back to legacy:', error);
			// Fall through to legacy parsing
		}

		// FALLBACK: Legacy oEmbed + direct parsing
		const oembedResult = await fetchOEmbed(targetUrl);
		if (oembedResult && oembedResult.title !== targetUrl) {
			cacheAndSend({
				title: oembedResult.title ?? targetUrl,
				image: oembedResult.image,
				description: oembedResult.description,
				url: targetUrl,
				price: null,
				type: oembedResult.type as 'link' | 'video',
				youtubeId: null,
				enrichment: null,
				videoDuration: oembedResult.videoDuration
			});
			return;
		}

		// Tier 1: Browser UA
		let browserMetadata: PageMetadata | null = null;
		const browserResult = await fetchHtml(targetUrl, buildBrowserHeaders(targetUrl));
		if (browserResult?.ok && browserResult.html && !isLowQualityResponse(browserResult.html, targetUrl)) {
			browserMetadata = parseOgTags(browserResult.html, targetUrl);
			const hostname = new URL(targetUrl).hostname;
			if (!browserMetadata.price) {
				if (isAmazonDomain(hostname)) browserMetadata.price = extractAmazonPrice(browserResult.html);
				else browserMetadata.price = extractGenericPrice(browserResult.html);
				if (browserMetadata.price) browserMetadata.type = 'product';
			}
			if (isProductDomain(hostname) && browserMetadata.type !== 'product') browserMetadata.type = 'product';
			// If we got rich metadata (image OR description), return immediately
			if (browserMetadata.image || browserMetadata.description) {
				cacheAndSend(browserMetadata);
				return;
			}
		}

		// Tier 2: Crawler UA
		const crawlerResult = await fetchHtml(targetUrl, buildCrawlerHeaders());
		if (crawlerResult?.ok && crawlerResult.html && !isLowQualityResponse(crawlerResult.html, targetUrl)) {
			const crawlerMetadata = parseOgTags(crawlerResult.html, targetUrl);
			// Merge: prefer crawler metadata but keep browser-only fields (e.g. price)
			if (browserMetadata) {
				if (!crawlerMetadata.price && browserMetadata.price) crawlerMetadata.price = browserMetadata.price;
				if (!crawlerMetadata.enrichment && browserMetadata.enrichment) crawlerMetadata.enrichment = browserMetadata.enrichment;
				if (crawlerMetadata.type === 'link' && browserMetadata.type !== 'link') crawlerMetadata.type = browserMetadata.type;
			}
			if (crawlerMetadata.image || crawlerMetadata.description || crawlerMetadata.enrichment) {
				cacheAndSend(crawlerMetadata);
				return;
			}
			if (browserMetadata && browserMetadata.title !== targetUrl) {
				cacheAndSend(browserMetadata);
				return;
			}
		} else if (browserMetadata && browserMetadata.title !== targetUrl) {
			cacheAndSend(browserMetadata);
			return;
		}

		// Tier 2b: Googlebot UA
		const googlebotResult = await fetchHtml(targetUrl, buildGooglebotHeaders());
		if (googlebotResult?.ok && googlebotResult.html && !isLowQualityResponse(googlebotResult.html, targetUrl)) {
			const gbMetadata = parseOgTags(googlebotResult.html, targetUrl);
			if (browserMetadata) {
				if (!gbMetadata.price && browserMetadata.price) gbMetadata.price = browserMetadata.price;
				if (!gbMetadata.enrichment && browserMetadata.enrichment) gbMetadata.enrichment = browserMetadata.enrichment;
				if (gbMetadata.type === 'link' && browserMetadata.type !== 'link') gbMetadata.type = browserMetadata.type;
			}
			if (gbMetadata.image || gbMetadata.description || gbMetadata.enrichment) {
				cacheAndSend(gbMetadata);
				return;
			}
		}

		// Tier 3: domain APIs → URL slug
		const urlFallback = await buildFallbackFromUrl(targetUrl);
		if (urlFallback) { cacheAndSend(urlFallback); return; }

		// Tier 4: Parse whatever HTML we got
		if (browserResult?.ok && browserResult.html) {
			const metadata = parseOgTags(browserResult.html, targetUrl);
			if (metadata.title && metadata.title !== targetUrl) {
				cacheAndSend(metadata);
				return;
			}
		}

		// Last resort
		try {
			const slugTitle = titleFromUrlSlug(new URL(targetUrl).pathname);
			cacheAndSend({ title: slugTitle ?? targetUrl, image: null, description: null, url: targetUrl, price: null, type: 'link' });
		} catch {
			res.status(502).json({ error: 'Failed to fetch URL' });
		}
	}
);
