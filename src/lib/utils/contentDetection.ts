/**
 * @file contentDetection.ts
 * @description Best-in-class content type detection with confidence scoring,
 *              multi-signal analysis, and explainable results.
 * 
 * Detection Strategy (multi-tier scoring):
 *   Tier 1: Explicit signals (JSON-LD, OG tags, meta products) - 0.9-1.0
 *   Tier 2: Domain matching (known retailers, platforms) - 0.7-0.9
 *   Tier 3: URL patterns (path segments, TLDs) - 0.5-0.7
 *   Tier 4: HTML heuristics (buttons, classes, structures) - 0.3-0.6
 *   Tier 5: Text analysis (keywords, context) - 0.1-0.4
 * 
 * Confidence Levels:
 *   - exact: 0.95-1.0 (explicit type declaration)
 *   - high: 0.8-0.95 (multiple strong signals)
 *   - medium: 0.6-0.8 (single strong or multiple weak signals)
 *   - low: 0.4-0.6 (weak signals)
 *   - unknown: <0.4 (insufficient data)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported content types */
export type ContentType =
	| 'note'
	| 'link'
	| 'product'
	| 'video'
	| 'recipe'
	| 'movie'
	| 'book'
	| 'article'
	| 'music'
	| 'place'
	| 'github'
	| 'list'
	| 'location'
	| 'image';

/** Detection confidence level */
export type ConfidenceLevel = 'exact' | 'high' | 'medium' | 'low' | 'unknown';

/** Individual detection signal */
export interface DetectionSignal {
	/** Signal type (e.g., 'domain_match', 'json_ld', 'og_type') */
	type: string;
	/** Signal strength (0-1) */
	strength: number;
	/** Human-readable description */
	description: string;
	/** Extracted metadata (optional) */
	metadata?: Record<string, unknown>;
}

/** Detection result with confidence scoring */
export interface ContentDetectionResult {
	/** Detected content type */
	type: ContentType;
	/** Confidence score (0-1) */
	confidence: number;
	/** Confidence level */
	level: ConfidenceLevel;
	/** All signals that contributed to detection */
	signals: DetectionSignal[];
	/** Extracted metadata (price, author, etc.) */
	metadata?: Record<string, unknown>;
	/** Alternative types considered */
	alternatives?: Array<{ type: ContentType; confidence: number }>;
}

// ─── Domain Lists (consolidated from domains.ts) ─────────────────────────────

/** Known product retailer domains */
export const PRODUCT_DOMAINS = [
	// Amazon regional
	'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.es', 'amazon.fr',
	'amazon.it', 'amazon.ca', 'amazon.co.jp', 'amazon.com.au',
	// US big-box
	'walmart.com', 'target.com', 'bestbuy.com', 'costco.com',
	'homedepot.com', 'lowes.com', 'macys.com', 'nordstrom.com',
	// Marketplaces
	'ebay.com', 'etsy.com', 'aliexpress.com', 'newegg.com',
	'shopify.com', 'squarespace.com', 'bigcommerce.com',
	// Home & lifestyle
	'wayfair.com', 'ikea.com', 'crateandbarrel.com', 'williams-sonoma.com',
	// Fashion
	'zappos.com', 'asos.com', 'shein.com', 'zara.com', 'hm.com',
	'uniqlo.com', 'gap.com', 'oldnavy.com', 'nordstromrack.com',
	// Electronics
	'bhphotovideo.com', 'adorama.com', 'microcenter.com',
	// Specialty
	'sephora.com', 'ulta.com', 'chewy.com', 'petco.com', 'petsmart.com'
] as const;

/** Known video platform domains */
export const VIDEO_DOMAINS = [
	'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com',
	'dailymotion.com', 'twitch.tv', 'rumble.com', 'bitchute.com',
	'odysee.com', 'streamable.com', 'loom.com', 'wistia.com'
] as const;

/** Known recipe domains */
export const RECIPE_DOMAINS = [
	'allrecipes.com', 'food.com', 'epicurious.com', 'bonappetit.com',
	'seriouseats.com', 'tasty.co', 'delish.com', 'foodnetwork.com',
	'simplyrecipes.com', 'budgetbytes.com', 'cookieandkate.com',
	'minimalistbaker.com', 'halfbakedharvest.com', 'food52.com',
	'thekitchn.com', 'smittenkitchen.com', 'kingarthurbaking.com',
	'cooking.nytimes.com', 'eatingwell.com', 'tasteofhome.com',
	'bbcgoodfood.com', 'jamieoliver.com', 'pinchofyum.com',
	'loveandlemons.com', 'damndelicious.net', 'recipetineats.com'
] as const;

/** Known movie/TV domains */
export const MOVIE_DOMAINS = [
	'imdb.com', 'letterboxd.com', 'rottentomatoes.com', 'themoviedb.org',
	'netflix.com', 'tv.apple.com', 'disneyplus.com', 'hbo.com',
	'max.com', 'hulu.com', 'primevideo.com', 'crunchyroll.com',
	'mubi.com', 'criterion.com', 'paramountplus.com', 'peacocktv.com',
	'tubitv.com', 'pluto.tv', 'justwatch.com', 'trakt.tv',
	'tvtime.com', 'serializd.com'
] as const;

/** Known book domains */
export const BOOK_DOMAINS = [
	'goodreads.com', 'openlibrary.org', 'bookshop.org',
	'books.google.com', 'penguin.com', 'harpercollins.com',
	'simonandschuster.com', 'barnesandnoble.com', 'libro.fm',
	'audible.com', 'bookdepository.com'
] as const;

/** Known place/local business domains */
export const PLACE_DOMAINS = [
	'yelp.com', 'tripadvisor.com', 'foursquare.com',
	'opentable.com', 'thefork.com', 'zomato.com',
	'happycow.net', 'timeout.com', 'resy.com'
] as const;

/** Known music domains */
export const MUSIC_DOMAINS = [
	'open.spotify.com', 'spotify.com', 'soundcloud.com',
	'music.apple.com', 'tidal.com', 'bandcamp.com',
	'deezer.com', 'last.fm', 'qobuz.com'
] as const;

/** Known article/news domains */
export const ARTICLE_DOMAINS = [
	'medium.com', 'substack.com', 'nytimes.com', 'theguardian.com',
	'washingtonpost.com', 'bbc.com', 'bbc.co.uk', 'arstechnica.com',
	'theverge.com', 'wired.com', 'theatlantic.com', 'newyorker.com',
	'reuters.com', 'apnews.com', 'economist.com', 'ft.com',
	'bloomberg.com', 'techcrunch.com', 'thenextweb.com', 'dev.to',
	'hackernoon.com', 'longform.org', 'nautil.us', 'slate.com'
] as const;

/** Known GitHub/code repository domains */
export const GITHUB_DOMAINS = [
	'github.com', 'gitlab.com', 'bitbucket.org', 'gist.github.com',
	'sourcegraph.com', 'codeberg.org'
] as const;

// ─── URL Pattern Matchers ────────────────────────────────────────────────────

/** URL path patterns that strongly suggest product pages */
export const PRODUCT_PATH_PATTERNS = [
	/\/products?\//i,
	/\/shop\//i,
	/\/item\//i,
	/\/p\//i,
	/\/dp\//i, // Amazon
	/\/buy\//i,
	/\/listing\//i,
	/\/catalog\/[^/]+\/[^/]+/i,
	/\/goods\//i,
	/\/artikel\//i, // German
	/\/produit\//i, // French
	/\/producto\//i, // Spanish
	/\/prodotto\//i, // Italian
	/\/-p-\d/i,
	/\/pd\//i,
	/\/sku\//i,
	/\/wishlist\//i,
	/\/cart\//i,
	/\/checkout\//i
] as const;

/** URL patterns for video content */
export const VIDEO_PATH_PATTERNS = [
	/\/watch\?/i,
	/\/video\//i,
	/\/shorts\//i,
	/\/live\//i,
	/\/embed\//i,
	/\/v\//i,
	/\/clip\//i
] as const;

/** URL patterns for article content */
export const ARTICLE_PATH_PATTERNS = [
	/\/article\//i,
	/\/blog\//i,
	/\/news\//i,
	/\/story\//i,
	/\/post\//i,
	/\/p\//i
] as const;

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Extract domain from URL string.
 */
export function extractDomain(url: string): string | null {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Check if domain matches any in a list (including subdomains).
 */
export function matchesDomainList(domain: string, list: readonly string[]): boolean {
	return list.some(d => domain === d || domain.endsWith('.' + d));
}

/**
 * Check if URL path matches any pattern.
 */
export function matchesPathPattern(pathname: string, patterns: readonly RegExp[]): boolean {
	return patterns.some(p => p.test(pathname));
}

/**
 * Convert confidence score to level.
 */
export function confidenceToLevel(confidence: number): ConfidenceLevel {
	if (confidence >= 0.95) return 'exact';
	if (confidence >= 0.8) return 'high';
	if (confidence >= 0.6) return 'medium';
	if (confidence >= 0.4) return 'low';
	return 'unknown';
}

/**
 * Validate URL string.
 */
export function isValidUrl(input: string): boolean {
	try {
		const u = new URL(input);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

// ─── Detection Functions ─────────────────────────────────────────────────────

/**
 * Detect content type from URL with confidence scoring.
 * Uses domain matching, URL patterns, and multi-signal analysis.
 * 
 * @param url - URL to analyze
 * @returns Detection result with confidence and signals
 */
export function detectFromUrl(url: string): ContentDetectionResult {
	const signals: DetectionSignal[] = [];
	const alternatives: Array<{ type: ContentType; confidence: number }> = [];
	
	const domain = extractDomain(url);
	let pathname = '';
	let confidence = 0;
	let detectedType: ContentType = 'link';
	
	try {
		pathname = new URL(url).pathname;
	} catch {
		// Invalid URL
	}
	
	// ── Tier 1: Domain Matching (0.7-0.9 confidence) ─────────────────────
	
	if (domain) {
		// Product domains
		if (matchesDomainList(domain, PRODUCT_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.85,
				description: `Known product domain: ${domain}`,
				metadata: { domain }
			});
			detectedType = 'product';
			confidence = Math.max(confidence, 0.85);
		}
		
		// Video domains
		if (matchesDomainList(domain, VIDEO_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.9,
				description: `Known video platform: ${domain}`,
				metadata: { domain }
			});
			alternatives.push({ type: detectedType, confidence });
			detectedType = 'video';
			confidence = Math.max(confidence, 0.9);
		}
		
		// Recipe domains
		if (matchesDomainList(domain, RECIPE_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.85,
				description: `Known recipe site: ${domain}`,
				metadata: { domain }
			});
			alternatives.push({ type: detectedType, confidence });
			detectedType = 'recipe';
			confidence = Math.max(confidence, 0.85);
		}
		
		// Movie domains
		if (matchesDomainList(domain, MOVIE_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.9,
				description: `Known movie/TV platform: ${domain}`,
				metadata: { domain }
			});
			alternatives.push({ type: detectedType, confidence });
			detectedType = 'movie';
			confidence = Math.max(confidence, 0.9);
		}
		
		// Book domains
		if (matchesDomainList(domain, BOOK_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.85,
				description: `Known book site: ${domain}`,
				metadata: { domain }
			});
			alternatives.push({ type: detectedType, confidence });
			detectedType = 'book';
			confidence = Math.max(confidence, 0.85);
		}
		
		// Place domains
		if (matchesDomainList(domain, PLACE_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.85,
				description: `Known place/local business: ${domain}`,
				metadata: { domain }
			});
			alternatives.push({ type: detectedType, confidence });
			detectedType = 'place';
			confidence = Math.max(confidence, 0.85);
		}
		
		// Music domains
		if (matchesDomainList(domain, MUSIC_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.85,
				description: `Known music platform: ${domain}`,
				metadata: { domain }
			});
			alternatives.push({ type: detectedType, confidence });
			detectedType = 'music';
			confidence = Math.max(confidence, 0.85);
		}
		
		// Article domains
		if (matchesDomainList(domain, ARTICLE_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.8,
				description: `Known article/news site: ${domain}`,
				metadata: { domain }
			});
			alternatives.push({ type: detectedType, confidence });
			detectedType = 'article';
			confidence = Math.max(confidence, 0.8);
		}
		
		// GitHub domains
		if (matchesDomainList(domain, GITHUB_DOMAINS)) {
			signals.push({
				type: 'domain_match',
				strength: 0.9,
				description: `Known code repository: ${domain}`,
				metadata: { domain }
			});
			alternatives.push({ type: detectedType, confidence });
			detectedType = 'github';
			confidence = Math.max(confidence, 0.9);
		}
	}
	
	// ── Tier 2: URL Path Patterns (0.5-0.7 confidence) ────────────────────
	
	if (pathname) {
		// Product path patterns
		if (matchesPathPattern(pathname, PRODUCT_PATH_PATTERNS)) {
			const patternSignal: DetectionSignal = {
				type: 'url_pattern',
				strength: 0.65,
				description: `Product-like URL path: ${pathname}`,
				metadata: { pathname }
			};
			
			// Boost if domain already suggested product
			if (detectedType === 'product') {
				patternSignal.strength = 0.8;
				confidence = Math.min(1, confidence + 0.1);
			} else if (detectedType === 'link') {
				detectedType = 'product';
				confidence = 0.65;
			}
			
			signals.push(patternSignal);
		}
		
		// Video path patterns
		if (matchesPathPattern(pathname, VIDEO_PATH_PATTERNS)) {
			signals.push({
				type: 'url_pattern',
				strength: 0.7,
				description: `Video-like URL path: ${pathname}`,
				metadata: { pathname }
			});
			
			if (detectedType === 'link') {
				detectedType = 'video';
				confidence = Math.max(confidence, 0.7);
			}
		}
	}
	
	// ── Build Result ──────────────────────────────────────────────────────
	
	const level = confidenceToLevel(confidence);
	
	// Sort alternatives by confidence
	alternatives.sort((a, b) => b.confidence - a.confidence);
	
	return {
		type: detectedType,
		confidence,
		level,
		signals,
		alternatives: alternatives.slice(0, 3), // Top 3 alternatives
		metadata: { domain, pathname }
	};
}

/**
 * Detect content type from plain text input.
 * Returns 'note' for non-URL text, 'link' for URLs without strong signals.
 * 
 * @param text - Text input to analyze
 * @returns Detection result
 */
export function detectFromText(text: string): ContentDetectionResult {
	const trimmed = text.trim();
	
	// Check if it's a URL
	if (isValidUrl(trimmed)) {
		return detectFromUrl(trimmed);
	}
	
	// Check for URL-like patterns in text
	const urlPattern = /https?:\/\/[^\s]+/g;
	const urlMatches = trimmed.match(urlPattern);
	
	if (urlMatches && urlMatches.length > 0) {
		// Analyze first URL found
		const result = detectFromUrl(urlMatches[0]);
		
		// Add signal that this was extracted from text
		result.signals.push({
			type: 'text_extraction',
			strength: 0.5,
			description: 'URL extracted from text content',
			metadata: { urlCount: urlMatches.length }
		});
		
		return result;
	}
	
	// Check for list-like content
	if (trimmed.includes('\n') && (trimmed.includes('- ') || trimmed.includes('• ') || trimmed.match(/^\d+\./m))) {
		return {
			type: 'list',
			confidence: 0.6,
			level: 'medium',
			signals: [{
				type: 'text_pattern',
				strength: 0.6,
				description: 'List-like text structure detected'
			}],
			metadata: { lineCount: trimmed.split('\n').length }
		};
	}
	
	// Check for location-like content
	if (trimmed.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/) || 
	    trimmed.match(/^\d+\s+[A-Z][a-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard)/i)) {
		return {
			type: 'location',
			confidence: 0.7,
			level: 'medium',
			signals: [{
				type: 'text_pattern',
				strength: 0.7,
				description: 'Location/address pattern detected'
			}]
		};
	}
	
	// Default: note
	return {
		type: 'note',
		confidence: 0.5,
		level: 'medium',
		signals: [{
			type: 'text_only',
			strength: 0.5,
			description: 'Plain text content (no URLs)'
		}]
	};
}

/**
 * Main detection function - auto-detects from URL or text.
 * 
 * @param input - URL or text to analyze
 * @returns Detection result with confidence and signals
 */
export function detectContentType(input: string): ContentDetectionResult {
	const trimmed = input.trim();
	
	// Quick URL check
	if (isValidUrl(trimmed)) {
		return detectFromUrl(trimmed);
	}
	
	// Text analysis
	return detectFromText(trimmed);
}

/**
 * Refine detection result with metadata from page extraction.
 * Upgrades confidence when metadata confirms initial detection.
 * 
 * @param result - Initial detection result
 * @param metadata - Page metadata (OG tags, JSON-LD, price, etc.)
 * @returns Refined detection result
 */
export function refineDetection(
	result: ContentDetectionResult,
	metadata: {
		price?: string | null;
		type?: string | null;
		youtubeId?: string | null;
		enrichment?: { kind?: string | null } | null;
	}
): ContentDetectionResult {
	const signals = [...result.signals];
	let confidence = result.confidence;
	let detectedType = result.type;
	
	// Price signal (strong product indicator)
	if (metadata.price) {
		signals.push({
			type: 'price_found',
			strength: 0.95,
			description: `Price detected: ${metadata.price}`,
			metadata: { price: metadata.price }
		});
		
		if (detectedType === 'product' || detectedType === 'link') {
			detectedType = 'product';
			confidence = Math.max(confidence, 0.95);
		}
	}
	
	// Explicit type from OG tags
	if (metadata.type) {
		const ogTypeStrength: Record<string, number> = {
			product: 0.95,
			video: 0.9,
		 article: 0.85
		};
		
		const strength = ogTypeStrength[metadata.type] ?? 0.7;
		signals.push({
			type: 'og_type',
			strength,
			description: `Open Graph type: ${metadata.type}`,
			metadata: { ogType: metadata.type }
		});
		
		if (metadata.type === 'product' || metadata.type === 'video') {
			detectedType = metadata.type as ContentType;
			confidence = Math.max(confidence, strength);
		}
	}
	
	// YouTube ID (definitive video signal)
	if (metadata.youtubeId) {
		signals.push({
			type: 'youtube_id',
			strength: 1.0,
			description: 'YouTube video ID detected',
			metadata: { youtubeId: metadata.youtubeId }
		});
		detectedType = 'video';
		confidence = 1.0;
	}
	
	// Enrichment kind (very strong signal)
	if (metadata.enrichment?.kind) {
		const enrichmentType = metadata.enrichment.kind as ContentType;
		signals.push({
			type: 'enrichment_kind',
			strength: 0.95,
			description: `Structured enrichment: ${enrichmentType}`,
			metadata: { kind: enrichmentType }
		});
		
		// Enrichment usually trumps URL-based detection
		if (['recipe', 'movie', 'book', 'place', 'music', 'article', 'github'].includes(enrichmentType)) {
			detectedType = enrichmentType;
			confidence = Math.max(confidence, 0.95);
		}
	}
	
	return {
		...result,
		type: detectedType,
		confidence,
		level: confidenceToLevel(confidence),
		signals
	};
}
