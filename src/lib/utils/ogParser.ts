/**
 * @file ogParser.ts
 * @description Open Graph metadata parser. Pure function — works on raw HTML.
 *              Uses multi-signal scoring to detect products from any domain.
 *              Includes Readability for article content extraction.
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import DOMPurify from 'isomorphic-dompurify';

import type { PageMetadata, LinkEnrichment, RecipeEnrichment, MovieEnrichment, BookEnrichment, PlaceEnrichment, ArticleEnrichment, MusicEnrichment, GithubEnrichment } from '$lib/types';
import {
	RECIPE_DOMAINS, MOVIE_DOMAINS, BOOK_DOMAINS, PLACE_DOMAINS,
	MUSIC_DOMAINS, ARTICLE_DOMAINS, GITHUB_DOMAINS,
	matchesDomain, isMapsUrl, isAmazonVideoUrl
} from '$lib/config/domains';
import { extractYouTubeId, extractDomain, faviconUrl } from './urlUtils';

/** Currency symbols used for price formatting */
const CURRENCY_SYMBOLS: Record<string, string> = {
	USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', KRW: '₩',
	INR: '₹', RUB: '₽', BRL: 'R$', TRY: '₺', PLN: 'zł', SEK: 'kr',
	NOK: 'kr', DKK: 'kr', CHF: 'CHF', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$',
	MXN: 'MX$', SGD: 'S$', HKD: 'HK$', THB: '฿', ZAR: 'R', AED: 'AED',
	SAR: 'SAR', CLP: 'CLP$', COP: 'COP$', PEN: 'S/'
};

function currencySymbol(code: string): string {
	return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code;
}

/**
 * Extracts price from a JSON-LD offers structure.
 * Handles Offer, AggregateOffer, and arrays of offers.
 */
function extractJsonLdPrice(offers: unknown): string | null {
	if (!offers || typeof offers !== 'object') return null;

	const offerList = Array.isArray(offers) ? offers : [offers];
	for (const offer of offerList) {
		if (typeof offer !== 'object' || offer === null) continue;
		const o = offer as Record<string, unknown>;

		// AggregateOffer: use lowPrice
		if (o['@type'] === 'AggregateOffer' && o.lowPrice) {
			const sym = currencySymbol(String(o.priceCurrency || 'USD'));
			return `${sym}${o.lowPrice}`;
		}

		// Direct price field
		if (o.price != null && String(o.price) !== '0') {
			const sym = currencySymbol(String(o.priceCurrency || 'USD'));
			return `${sym}${o.price}`;
		}

		// Nested offers (e.g. AggregateOffer with child offers)
		if (o.offers) {
			const nested = extractJsonLdPrice(o.offers);
			if (nested) return nested;
		}
	}
	return null;
}

/**
 * Walks a JSON-LD object graph to find Product-type entities.
 * Handles @graph arrays, nested items, and multiple Product type strings.
 */
function walkJsonLd(
	data: unknown,
	out: { title: string | null; image: string | null; price: string | null; isProduct: boolean }
): void {
	if (!data || typeof data !== 'object') return;

	if (Array.isArray(data)) {
		for (const item of data) walkJsonLd(item, out);
		return;
	}

	const obj = data as Record<string, unknown>;

	// Handle @graph container (used by Shopify, WooCommerce, many CMS)
	if (Array.isArray(obj['@graph'])) {
		for (const item of obj['@graph']) walkJsonLd(item, out);
		return;
	}

	// Normalize @type to array for checking
	const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
	const productTypes = [
		'Product', 'IndividualProduct', 'ProductGroup', 'ProductModel',
		'http://schema.org/Product', 'https://schema.org/Product',
		'http://schema.org/IndividualProduct', 'https://schema.org/IndividualProduct'
	];

	const isProduct = types.some((t) => typeof t === 'string' && productTypes.includes(t));
	if (isProduct) {
		out.isProduct = true;
		if (obj.name && typeof obj.name === 'string') out.title = obj.name;

		// Image: string, array, or {url: ...} object
		if (obj.image) {
			if (typeof obj.image === 'string') out.image = obj.image;
			else if (Array.isArray(obj.image)) out.image = typeof obj.image[0] === 'string' ? obj.image[0] : (obj.image[0] as Record<string, unknown>)?.url as string ?? null;
			else if (typeof obj.image === 'object') out.image = (obj.image as Record<string, unknown>).url as string ?? null;
		}

		// Price from offers
		const price = extractJsonLdPrice(obj.offers);
		if (price) out.price = price;

		// Some sites put price directly on the Product
		if (!out.price && obj.price != null && String(obj.price) !== '0') {
			const sym = currencySymbol(String((obj as Record<string, unknown>).priceCurrency || 'USD'));
			out.price = `${sym}${obj.price}`;
		}
	}

	// Recurse into mainEntity / mainEntityOfPage (common on product pages)
	if (obj.mainEntity) walkJsonLd(obj.mainEntity, out);
	if (obj.mainEntityOfPage) walkJsonLd(obj.mainEntityOfPage, out);
}

// ─── Enrichment extraction from JSON-LD ──────────────────────────────────────

/** Helper: extract a string value from a JSON-LD object */
function str(v: unknown): string | null {
	if (typeof v === 'string' && v.trim()) return v.trim();
	if (typeof v === 'number') return String(v);
	return null;
}

/** Helper: extract image URL from various JSON-LD image formats */
function extractImage(v: unknown): string | null {
	if (typeof v === 'string') return v;
	if (Array.isArray(v)) return extractImage(v[0]);
	if (v && typeof v === 'object') return str((v as Record<string, unknown>).url);
	return null;
}

/** Convert ISO 8601 duration (PT1H30M) to human-readable */
function formatIsoDuration(iso: unknown): string | null {
	if (typeof iso !== 'string') return null;
	const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
	if (!m) return iso;
	const parts: string[] = [];
	if (m[1]) parts.push(`${m[1]}h`);
	if (m[2]) parts.push(`${m[2]}m`);
	if (m[3] && !m[1] && !m[2]) parts.push(`${m[3]}s`);
	return parts.join(' ') || null;
}

/** Extract person name from string or { name: "..." } object */
function personName(v: unknown): string | null {
	if (typeof v === 'string') return v.trim() || null;
	if (Array.isArray(v)) return v.map(personName).filter(Boolean).join(', ') || null;
	if (v && typeof v === 'object') return str((v as Record<string, unknown>).name);
	return null;
}

/** Extract text from HowToStep / HowToSection instructions */
function extractInstructions(v: unknown): string[] {
	if (!v) return [];
	if (typeof v === 'string') return v.split(/\n+/).map(s => s.trim()).filter(Boolean);
	if (Array.isArray(v)) {
		return v.flatMap(item => {
			if (typeof item === 'string') return [item.trim()];
			if (item && typeof item === 'object') {
				const obj = item as Record<string, unknown>;
				// HowToStep
				if (obj.text) return [String(obj.text).trim()];
				// HowToSection with itemListElement
				if (Array.isArray(obj.itemListElement)) return extractInstructions(obj.itemListElement);
			}
			return [];
		}).filter(Boolean);
	}
	return [];
}

/** Extract ingredient strings */
function extractIngredients(v: unknown): string[] {
	if (!v) return [];
	if (Array.isArray(v)) return v.filter(i => typeof i === 'string' && i.trim()).map(i => String(i).trim());
	if (typeof v === 'string') return v.split(/\n+/).map(s => s.trim()).filter(Boolean);
	return [];
}

/**
 * Walks JSON-LD to extract enrichment data for supported content types.
 * Supports: Recipe, Movie, TVSeries, Book, Restaurant, LocalBusiness, Article, MusicRecording.
 */
function extractEnrichmentFromJsonLd(data: unknown): LinkEnrichment | null {
	if (!data || typeof data !== 'object') return null;

	if (Array.isArray(data)) {
		for (const item of data) {
			const result = extractEnrichmentFromJsonLd(item);
			if (result) return result;
		}
		return null;
	}

	const obj = data as Record<string, unknown>;

	// Handle @graph
	if (Array.isArray(obj['@graph'])) {
		for (const item of obj['@graph']) {
			const result = extractEnrichmentFromJsonLd(item);
			if (result) return result;
		}
		return null;
	}

	const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
	const hasType = (t: string) => types.some(
		(v) => typeof v === 'string' && (v === t || v.endsWith('/' + t))
	);

	// ── Recipe ──
	if (hasType('Recipe')) {
		const recipe: RecipeEnrichment = {
			kind: 'recipe',
			cookTime: formatIsoDuration(obj.cookTime),
			prepTime: formatIsoDuration(obj.prepTime),
			totalTime: formatIsoDuration(obj.totalTime),
			servings: str(obj.recipeYield) ?? str(obj.yield),
			ingredients: extractIngredients(obj.recipeIngredient),
			instructions: extractInstructions(obj.recipeInstructions),
			cuisine: str(obj.recipeCuisine),
			calories: null
		};
		// Nutrition
		if (obj.nutrition && typeof obj.nutrition === 'object') {
			recipe.calories = str((obj.nutrition as Record<string, unknown>).calories);
		}
		return recipe;
	}

	// ── Movie / TVSeries ──
	if (hasType('Movie') || hasType('TVSeries') || hasType('TVEpisode')) {
		const rating = obj.aggregateRating as Record<string, unknown> | undefined;
		return {
			kind: 'movie',
			director: personName(obj.director),
			year: obj.datePublished ? parseInt(String(obj.datePublished).slice(0, 4), 10) || null : null,
			runtime: formatIsoDuration(obj.duration),
			genre: Array.isArray(obj.genre) ? obj.genre.join(', ') : str(obj.genre),
			rating: rating ? str(rating.ratingValue) : null,
			ratingSource: rating ? (str(rating.bestRating) ? `/${rating.bestRating}` : '/10') : null,
			cast: Array.isArray(obj.actor) ? obj.actor.map(personName).filter(Boolean) as string[] : [],
			contentRating: str(obj.contentRating)
		} satisfies MovieEnrichment;
	}

	// ── Book ──
	if (hasType('Book')) {
		const rating = obj.aggregateRating as Record<string, unknown> | undefined;
		return {
			kind: 'book',
			author: personName(obj.author),
			genre: Array.isArray(obj.genre) ? obj.genre.join(', ') : str(obj.genre),
			pageCount: obj.numberOfPages ? parseInt(String(obj.numberOfPages), 10) || null : null,
			isbn: str(obj.isbn),
			publisher: personName(obj.publisher),
			publishDate: str(obj.datePublished),
			averageRating: rating ? str(rating.ratingValue) : null
		} satisfies BookEnrichment;
	}

	// ── Place / Restaurant / LocalBusiness ──
	if (hasType('Restaurant') || hasType('LocalBusiness') || hasType('FoodEstablishment')
		|| hasType('CafeOrCoffeeShop') || hasType('BarOrPub') || hasType('Hotel')) {
		const rating = obj.aggregateRating as Record<string, unknown> | undefined;
		const addr = obj.address as Record<string, unknown> | undefined;
		const geo = obj.geo as Record<string, unknown> | undefined;
		return {
			kind: 'place',
			address: addr ? [str(addr.streetAddress), str(addr.addressLocality), str(addr.addressRegion)].filter(Boolean).join(', ') : null,
			phone: str(obj.telephone),
			priceRange: str(obj.priceRange),
			category: types.find(t => typeof t === 'string' && t !== 'LocalBusiness') as string ?? null,
			rating: rating ? str(rating.ratingValue) : null,
			ratingCount: rating?.reviewCount ? parseInt(String(rating.reviewCount), 10) || null : null,
			latitude: geo?.latitude ? parseFloat(String(geo.latitude)) || null : null,
			longitude: geo?.longitude ? parseFloat(String(geo.longitude)) || null : null,
			hours: Array.isArray(obj.openingHours) ? (obj.openingHours as string[]).join(', ') : str(obj.openingHours)
		} satisfies PlaceEnrichment;
	}

	// ── Article / NewsArticle / BlogPosting ──
	if (hasType('Article') || hasType('NewsArticle') || hasType('BlogPosting') || hasType('WebPage')) {
		// Only extract if there's meaningful author/date data (WebPage alone is too generic)
		const author = personName(obj.author);
		const publishedDate = str(obj.datePublished);
		if (!author && !publishedDate && hasType('WebPage')) return null;

		const wordCount = obj.wordCount ? parseInt(String(obj.wordCount), 10) : null;
		const readingTime = wordCount ? `${Math.max(1, Math.round(wordCount / 200))} min read` : null;
		const publisher = obj.publisher as Record<string, unknown> | undefined;

		// Extract article body text from JSON-LD (many news sites include it)
		let bodyText: string | null = null;
		const rawBody = str(obj.articleBody) ?? str(obj.text);
		if (rawBody && rawBody.length > 50) {
			// Cap at ~10k chars to avoid storing massive articles
			bodyText = rawBody.length > 10000 ? rawBody.slice(0, 10000) + '…' : rawBody;
		}

		// Compute reading time from body text if not already available
		const effectiveReadingTime = readingTime
			?? (bodyText ? `${Math.max(1, Math.round(bodyText.split(/\s+/).length / 200))} min read` : null);

		return {
			kind: 'article',
			author,
			publishedDate,
			readingTime: effectiveReadingTime,
			siteName: publisher ? str(publisher.name) : null,
			bodyText
		} satisfies ArticleEnrichment;
	}

	// ── Music ──
	if (hasType('MusicRecording') || hasType('MusicAlbum')) {
		let artist = personName(obj.byArtist);
		// Spotify JSON-LD: description = "Listen to X on Spotify. Song · Artist · Year"
		if (!artist && typeof obj.description === 'string') {
			const descParts = obj.description.split(/\s*·\s*/);
			if (descParts.length >= 2) {
				// Find the artist part (not "Song"/"album", not a year, not "Listen to...", not "N songs")
				const skipWords = ['song', 'album', 'single', 'ep', 'podcast', 'episode'];
				const candidates = descParts.filter(p => {
					const t = p.trim().toLowerCase();
					return t && !/^\d{4}$/.test(t) && !/^\d+\s+songs?$/.test(t) &&
						!skipWords.includes(t) && !t.includes('listen to');
				});
				if (candidates.length > 0) artist = candidates[0].trim();
			}
		}
		return {
			kind: 'music',
			artist,
			album: hasType('MusicRecording') ? str(obj.inAlbum ? (obj.inAlbum as Record<string, unknown>).name : null) : str(obj.name),
			duration: formatIsoDuration(obj.duration),
			genre: Array.isArray(obj.genre) ? obj.genre.join(', ') : str(obj.genre)
		} satisfies MusicEnrichment;
	}

	// ── SoftwareSourceCode (GitHub, GitLab) ──
	if (hasType('SoftwareSourceCode') || hasType('SoftwareApplication')) {
		return {
			kind: 'github',
			owner: null,
			repo: str(obj.name),
			description: str(obj.description),
			language: str(obj.programmingLanguage) ?? (obj.programmingLanguage && typeof obj.programmingLanguage === 'object'
				? str((obj.programmingLanguage as Record<string, unknown>).name)
				: null),
			stars: null,
			forks: null
		} satisfies GithubEnrichment;
	}

	// Recurse into mainEntity
	if (obj.mainEntity) return extractEnrichmentFromJsonLd(obj.mainEntity);
	if (obj.mainEntityOfPage) return extractEnrichmentFromJsonLd(obj.mainEntityOfPage);

	return null;
}

/**
 * Detects product signals from HTML using heuristics.
 * Returns a confidence score (0–1) and an optional extracted price.
 */
function detectProductSignals(html: string): { score: number; price: string | null } {
	let score = 0;
	let price: string | null = null;

	// --- Schema.org microdata (itemprop/itemtype) ---
	if (/itemtype=["'][^"']*schema\.org\/Product/i.test(html)) score += 0.35;
	const microprice = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)
		?? html.match(/itemprop=["']price["'][^>]*>\s*([£$€¥₹₩₽][\s\d.,]+)/i);
	if (microprice?.[1]) {
		score += 0.25;
		const raw = microprice[1].trim();
		price = /^[£$€¥₹₩₽]/.test(raw) ? raw : `$${raw}`;
	}

	// --- "Add to cart" / "Buy now" buttons (very strong product signal) ---
	const addToCartPattern = /(?:add[- _]?to[- _]?(?:cart|bag|basket)|buy[- _]?(?:now|it)|purchase|add[- _]?to[- _]?wishlist|in[- _]den[- _]warenkorb|ajouter[- _]au[- _]panier|añadir[- _]al[- _]carrito|adicionar[- _]ao[- _]carrinho)/i;
	if (addToCartPattern.test(html)) score += 0.3;

	// --- Product-specific CSS classes / IDs ---
	const productCssPattern = /(?:class|id)=["'][^"']*(?:product-price|price-tag|product-detail|pdp-|product-page|product-info|shopify-section-product|woocommerce-Price|product__price|price-box|price-wrapper)/i;
	if (productCssPattern.test(html)) score += 0.2;

	// --- Common e-commerce platform markers ---
	if (/Shopify\.theme/i.test(html)) score += 0.25;
	if (/woocommerce/i.test(html)) score += 0.25;
	if (/BigCommerce/i.test(html)) score += 0.2;
	if (/Magento/i.test(html)) score += 0.2;
	if (/PrestaShop/i.test(html)) score += 0.2;
	if (/data-product-id/i.test(html)) score += 0.15;
	if (/data-variant-id/i.test(html)) score += 0.15;

	// --- Product availability meta tags ---
	if (/(?:property|name)=["']product:availability["']/i.test(html)) score += 0.2;
	if (/(?:property|name)=["']product:condition["']/i.test(html)) score += 0.15;
	if (/(?:property|name)=["']product:retailer_item_id["']/i.test(html)) score += 0.2;
	if (/(?:property|name)=["']product:brand["']/i.test(html)) score += 0.1;

	// --- Generic price extraction if not found yet ---
	if (!price) {
		// Common price display patterns in HTML
		const pricePatterns = [
			// class="price" > $X.XX
			/class=["'][^"']*price[^"']*["'][^>]*>\s*([£$€¥₹₩₽]\s*[\d.,]+(?:\.\d{2})?)/i,
			// data-price="X.XX"
			/data-price=["']([^"']+)["']/i,
			// itemprop="priceCurrency" nearby itemprop="price"
			/itemprop=["']price["'][^>]*>\s*([\d.,]+)/i
		];

		for (const p of pricePatterns) {
			const m = html.match(p);
			if (m?.[1]) {
				const raw = m[1].trim();
				price = /^[£$€¥₹₩₽]/.test(raw) ? raw : `$${raw}`;
				break;
			}
		}
	}

	return { score: Math.min(score, 1), price };
}

/**
 * Parses OG/meta tags and JSON-LD from a raw HTML string into PageMetadata.
 * Uses multi-signal scoring to detect products even from unknown domains.
 */
export function parseOgTags(html: string, url: string): PageMetadata {
	const get = (pattern: RegExp): string | null => {
		const match = html.match(pattern);
		return match?.[1]?.trim() ?? null;
	};

	// --- 1. JSON-LD Extraction (High priority for products + enrichment) ---
	const jsonLd = { title: null as string | null, image: null as string | null, price: null as string | null, isProduct: false };
	let enrichment: LinkEnrichment | null = null;

	try {
		const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
		if (jsonLdMatch) {
			for (const scriptTag of jsonLdMatch) {
				try {
					const content = scriptTag.replace(/<script[^>]*>|<\/script>/gi, '');
					const data = JSON.parse(content);
					walkJsonLd(data, jsonLd);
					if (!enrichment) enrichment = extractEnrichmentFromJsonLd(data);
				} catch {
					// Skip malformed JSON-LD
				}
			}
		}
	} catch {
		// Global JSON-LD parsing failure
	}

	// --- 2. Meta Tag Extraction (OG, Twitter, etc.) ---

	// Title fallbacks
	const ogTitle =
		get(/<meta[^>]+(?:property|name)="og:title"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="og:title"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:title"[^>]+content="([^"]*)"/i) ??
		get(/<title[^>]*>([^<]*)<\/title>/i) ??
		jsonLd.title;

	// Image fallbacks
	const ogImage =
		get(/<meta[^>]+(?:property|name)="og:image"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="og:image"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:image"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:image:src"[^>]+content="([^"]*)"/i) ??
		get(/<link[^>]+rel="(?:image_src|shortcut icon|icon)"[^>]+href="([^"]*)"/i) ??
		jsonLd.image;

	// Description fallbacks
	const ogDescription =
		get(/<meta[^>]+(?:property|name)="og:description"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="og:description"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:description"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);

	const ogType =
		get(/<meta[^>]+property="og:type"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+property="og:type"/i);

	// --- 3. Price extraction (meta tags → JSON-LD → heuristics) ---
	const metaPrice =
		get(/<meta[^>]+(?:property|name)="(?:product:price:amount|og:price:amount)"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:product:price:amount|og:price:amount)"/i);

	// Currency from meta tags for formatting
	const metaCurrency =
		get(/<meta[^>]+(?:property|name)="(?:product:price:currency|og:price:currency)"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:product:price:currency|og:price:currency)"/i);

	let price = metaPrice
		? (metaCurrency ? `${currencySymbol(metaCurrency)}${metaPrice}` : metaPrice)
		: jsonLd.price;

	// --- 4. HTML heuristic product detection ---
	const signals = detectProductSignals(html);
	if (!price && signals.price) price = signals.price;

	// --- 5. URL path pattern scoring ---
	let urlScore = 0;
	try {
		const pathname = new URL(url).pathname.toLowerCase();
		const productPathPatterns = [
			/\/products?\//,          // /product/ or /products/
			/\/shop\//,               // /shop/
			/\/item\//,               // /item/
			/\/p\//,                  // /p/ (short product path)
			/\/dp\//,                 // /dp/ (Amazon-style)
			/\/buy\//,               // /buy/
			/\/listing\//,            // /listing/ (Etsy-style)
			/\/catalog\//,            // /catalog/
			/\/goods\//,             // /goods/
			/\/artikel\//,            // /artikel/ (German)
			/\/produit\//,            // /produit/ (French)
			/\/producto\//,           // /producto/ (Spanish)
			/\/prodotto\//,           // /prodotto/ (Italian)
			/\/-p-\d/,               // -p-12345 (common in Turkish/Asian e-commerce)
			/\/pd\//,                // /pd/ (various retailers)
			/\/sku\//,               // /sku/
		];
		if (productPathPatterns.some((p) => p.test(pathname))) urlScore = 0.15;
	} catch { /* ignore */ }

	// --- 6. Determine type using combined signals ---
	const isExplicitProduct =
		!!price ||
		ogType === 'product' ||
		ogType === 'product.item' ||
		ogType === 'og:product' ||
		jsonLd.isProduct;

	const combinedScore = signals.score + urlScore + (jsonLd.isProduct ? 0.4 : 0);

	let type: PageMetadata['type'] = 'link';
	if (isExplicitProduct) {
		type = 'product';
	} else if (combinedScore >= 0.4) {
		// Enough heuristic signals to classify as product even without explicit price/type
		type = 'product';
	} else if (ogType === 'video' || ogType === 'video.other') {
		type = 'video';
	} else if (ogType === 'article') {
		type = 'article';
	}

	// Clean up image URL (absolute vs relative)
	let finalImage = ogImage;
	if (finalImage && !finalImage.startsWith('http')) {
		try {
			const baseUrl = new URL(url);
			finalImage = new URL(finalImage, baseUrl.origin).toString();
		} catch {
			// ignore
		}
	}

	// --- 7. YouTube ID extraction ---
	const youtubeId = extractYouTubeId(url);
	if (youtubeId) {
		type = 'video';
		// Use high-quality YouTube thumbnail if no image found
		if (!finalImage) finalImage = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
	}

	// --- 8. Enrichment fallbacks from meta tags + domain heuristics ---
	const siteName =
		get(/<meta[^>]+(?:property|name)="og:site_name"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="og:site_name"/i);

	// Extract generic author for videos (YouTube channel, Vimeo user, etc.)
	const videoAuthor = 
		get(/<meta[^>]+name="author"[^>]+content="([^"]*)"/i) ??
		get(/<link[^>]+itemprop="name"[^>]+content="([^"]*)"/i) ??
		get(/<meta[^>]+(?:property|name)="twitter:creator"[^>]+content="([^"]*)"/i);

	// Video enrichment fallback
	if (!enrichment && (type === 'video' || urlDomain.includes('youtube.com') || urlDomain.includes('youtu.be') || urlDomain.includes('vimeo.com'))) {
		enrichment = {
			kind: 'video',
			author: videoAuthor,
			publishedDate: get(/<meta[^>]+(?:property|name)="article:published_time"[^>]+content="([^"]*)"/i)?.slice(0, 10) ?? null,
			duration: null,
			views: null,
			siteName: siteName ?? (urlDomain.includes('youtube') ? 'YouTube' : urlDomain.includes('vimeo') ? 'Vimeo' : null)
		};
	}

	let urlDomain = '';
	try { urlDomain = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { /* */ }

	// Article fallback
	if (!enrichment && (type === 'article' || ogType === 'article')) {
		const articleAuthor =
			get(/<meta[^>]+(?:property|name)="(?:article:author|author)"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:article:author|author)"/i);
		const articleDate =
			get(/<meta[^>]+(?:property|name)="(?:article:published_time|date)"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="article:published_time"/i);

		if (articleAuthor || articleDate) {
			enrichment = {
				kind: 'article',
				author: articleAuthor,
				publishedDate: articleDate ? articleDate.slice(0, 10) : null,
				readingTime: ogDescription && ogDescription.length > 80
					? `${Math.max(1, Math.round((ogDescription.split(/\s+/).length * 20) / 200))} min read`
					: null,
				siteName,
				bodyText: null
			};
		}
	}

	// Recipe fallback: known recipe domains without JSON-LD Recipe
	if (!enrichment && matchesDomain(urlDomain, RECIPE_DOMAINS)) {
		enrichment = {
			kind: 'recipe',
			cookTime: null, prepTime: null, totalTime: null,
			servings: null, ingredients: [], instructions: [],
			cuisine: null, calories: null
		};
	}

	// Music fallback: extract artist/album from Spotify/Apple Music/Bandcamp OG titles & descriptions
	// Also upgrades existing music enrichment if artist is missing
	const existingMusicNoArtist = enrichment?.kind === 'music' && !(enrichment as MusicEnrichment).artist;
	if (matchesDomain(urlDomain, MUSIC_DOMAINS) && (!enrichment || existingMusicNoArtist)) {
		let artist: string | null = null;
		let album: string | null = null;

		// Title patterns: "Song by Artist", "Song - Artist", "Song · Artist"
		if (ogTitle) {
			const byMatch = ogTitle.match(/^(.+?)\s+(?:by|[-–—·])\s+(.+?)(?:\s+\||\s+on\s+|$)/i);
			if (byMatch) artist = byMatch[2].trim();
		}

		// Spotify OG description: "Artist · Album · Song · Year" or "Artist · Song · Year"
		if (!artist && ogDescription) {
			const descParts = ogDescription.split(/\s*·\s*/);
			const skipWords = ['song', 'album', 'single', 'ep', 'podcast', 'episode'];
			if (descParts.length >= 2) {
				// First part that isn't a skip word or year is the artist
				const artistCandidates = descParts.filter(p => {
					const t = p.trim().toLowerCase();
					return t && !/^\d{4}$/.test(t) && !/^\d+\s+songs?$/.test(t) && !skipWords.includes(t);
				});
				if (artistCandidates.length > 0) artist = artistCandidates[0].trim() || null;

				// Find album: second candidate that isn't the artist
				if (descParts.length >= 3) {
					const albumCandidate = descParts.find(p => {
						const t = p.trim().toLowerCase();
						return t && t !== artist?.toLowerCase() && !/^\d{4}$/.test(t) &&
							!/^\d+\s+songs?$/.test(t) && !skipWords.includes(t);
					});
					if (albumCandidate) album = albumCandidate.trim();
				}
			}
		}

		// Meta tag: music:musician or og:audio:artist
		const metaArtist =
			get(/<meta[^>]+(?:property|name)="(?:music:musician|og:audio:artist)"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:music:musician|og:audio:artist)"/i);
		if (metaArtist) artist = metaArtist;

		// Meta tag: music:album
		const metaAlbum =
			get(/<meta[^>]+(?:property|name)="music:album"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="music:album"/i);
		if (metaAlbum) album = metaAlbum;

		if (url.includes('/album/')) album = ogTitle?.split(/\s+[-–—·]\s+/)[0] ?? null;

		enrichment = { kind: 'music', artist, album, duration: null, genre: null };
	}

	// Place fallback: Yelp, TripAdvisor, Google Maps, Foursquare
	if (!enrichment && (matchesDomain(urlDomain, PLACE_DOMAINS) || isMapsUrl(urlDomain, url))) {
		let rating: string | null = null;
		let category: string | null = null;

		if (ogDescription) {
			const ratingMatch = ogDescription.match(/(\d+\.?\d?)\s*(?:star|★|\/5|\/ 5)/i);
			if (ratingMatch) rating = ratingMatch[1];
			const catMatch = ogDescription.match(/^([^.·\-—]+?)(?:\s*[.·\-—])/);
			if (catMatch && catMatch[1].length < 40) category = catMatch[1].trim();
		}

		enrichment = {
			kind: 'place', address: null, phone: null, priceRange: null,
			category, rating, ratingCount: null,
			latitude: null, longitude: null, hours: null
		};
	}

	// Movie fallback: IMDB, Letterboxd, RT, Netflix, streaming platforms
	if (!enrichment && (matchesDomain(urlDomain, MOVIE_DOMAINS) || isAmazonVideoUrl(urlDomain, url))) {
		let director: string | null = null;
		let year: number | null = null;
		let rating: string | null = null;
		let ratingSource: string | null = null;
		let cast: string[] = [];

		// Year from title: "Movie Title (2024)"
		if (ogTitle) {
			const yearMatch = ogTitle.match(/\((\d{4})\)/);
			if (yearMatch) year = parseInt(yearMatch[1], 10);
		}

		// Director from title (Letterboxd): "Title (2024) directed by Name"
		if (ogTitle) {
			const dirMatch = ogTitle.match(/directed by\s+(.+?)$/i);
			if (dirMatch) director = dirMatch[1].replace(/\s*[|–—-]\s*.*$/, '').trim();
		}

		if (ogDescription) {
			// IMDB pattern: "Directed by Name. With Actor1, Actor2, Actor3. Plot..."
			const imdbDirMatch = ogDescription.match(/^Directed by\s+(.+?)\.\s+With\s+/i);
			if (imdbDirMatch) director = imdbDirMatch[1].trim();

			const imdbCastMatch = ogDescription.match(/With\s+(.+?)\.\s/i);
			if (imdbCastMatch) cast = imdbCastMatch[1].split(/,\s*/).map(s => s.trim()).filter(Boolean).slice(0, 6);

			// Rating patterns
			const imdbRating = ogDescription.match(/(\d+\.?\d?)\/10/);
			if (imdbRating) { rating = imdbRating[1]; ratingSource = '/10'; }

			if (!rating) {
				const rtScore = ogDescription.match(/(\d+)%/);
				if (rtScore) { rating = rtScore[1]; ratingSource = '%'; }
			}

			if (!rating) {
				const letterboxdRating = ogDescription.match(/(\d+\.?\d?)\s*out of\s*5/i);
				if (letterboxdRating) { rating = letterboxdRating[1]; ratingSource = '/5'; }
			}

			if (!rating) {
				const starRating = ogDescription.match(/(\d+\.?\d?)\s*(?:star|★)/i);
				if (starRating) { rating = starRating[1]; ratingSource = '/5'; }
			}
		}

		enrichment = {
			kind: 'movie', director, year, runtime: null,
			genre: null, rating, ratingSource, cast, contentRating: null
		};
	}

	// Book fallback: Goodreads, OpenLibrary, Bookshop, Barnes & Noble
	if (!enrichment && matchesDomain(urlDomain, BOOK_DOMAINS)) {
		let author: string | null = null;
		let averageRating: string | null = null;
		let isbn: string | null = null;

		// Meta tag: book:author
		const metaAuthor =
			get(/<meta[^>]+(?:property|name)="book:author"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="book:author"/i);
		if (metaAuthor) author = metaAuthor;

		// Title pattern: "Book Title by Author Name" or "Book Title by Author | Site"
		if (!author && ogTitle) {
			const byMatch = ogTitle.match(/^.+?\s+by\s+(.+?)(?:\s*[|–—\-]|$)/i);
			if (byMatch) author = byMatch[1].trim();
		}

		// Meta tag: book:isbn
		const metaIsbn =
			get(/<meta[^>]+(?:property|name)="book:isbn"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="book:isbn"/i);
		if (metaIsbn) isbn = metaIsbn;

		// Rating from description: Goodreads "4.02 avg rating" or "Rating: 4.5"
		if (ogDescription) {
			const grRating = ogDescription.match(/(\d+\.?\d{1,2})\s*(?:avg\s+)?rating/i);
			if (grRating) averageRating = grRating[1];

			if (!averageRating) {
				const starRating = ogDescription.match(/(\d+\.?\d?)\s*(?:out of\s*5|\/\s*5|star|★)/i);
				if (starRating) averageRating = starRating[1];
			}
		}

		enrichment = {
			kind: 'book', author, genre: null, pageCount: null,
			isbn, publisher: null, publishDate: null, averageRating
		};
	}

	// GitHub fallback: extract owner/repo, language, stars from OG tags
	if (!enrichment && matchesDomain(urlDomain, GITHUB_DOMAINS)) {
		let owner: string | null = null;
		let repo: string | null = null;
		let ghDescription: string | null = ogDescription;
		let language: string | null = null;
		let stars: string | null = null;
		let forks: string | null = null;

		// GitHub og:title: "owner/repo: description" or just "owner/repo"
		if (ogTitle) {
			const repoMatch = ogTitle.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
			if (repoMatch) {
				owner = repoMatch[1];
				repo = repoMatch[2];
			}
		}

		// Fallback: parse from URL path /owner/repo
		if (!owner) {
			try {
				const parts = new URL(url).pathname.split('/').filter(Boolean);
				if (parts.length >= 2) {
					owner = parts[0];
					repo = parts[1];
				}
			} catch { /* */ }
		}

		// GitHub descriptions often contain star/fork counts or language
		if (ogDescription) {
			// "repo - description. Language: JavaScript. Stars: 1.2k"
			const langMatch = ogDescription.match(/(?:^|\.\s+)([A-Z][a-z]+(?:Script|Plus|Sharp)?)\s+\d/);
			if (langMatch) language = langMatch[1];

			// GitHub social image meta sometimes embeds stats
			const starsMatch = ogDescription.match(/(\d+(?:[.,]\d+)?k?)\s*(?:star|⭐)/i);
			if (starsMatch) stars = starsMatch[1];

			const forksMatch = ogDescription.match(/(\d+(?:[.,]\d+)?k?)\s*fork/i);
			if (forksMatch) forks = forksMatch[1];
		}

		enrichment = {
			kind: 'github', owner, repo,
			description: ghDescription, language, stars, forks
		};
	}

	// Article fallback: known article domains even without og:type=article
	if (!enrichment && matchesDomain(urlDomain, ARTICLE_DOMAINS)) {
		const articleAuthor =
			get(/<meta[^>]+(?:property|name)="(?:article:author|author)"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="(?:article:author|author)"/i);
		const articleDate =
			get(/<meta[^>]+(?:property|name)="(?:article:published_time|date)"[^>]+content="([^"]*)"/i) ??
			get(/<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="article:published_time"/i);

		enrichment = {
			kind: 'article',
			author: articleAuthor,
			publishedDate: articleDate ? articleDate.slice(0, 10) : null,
			readingTime: ogDescription && ogDescription.length > 80
				? `${Math.max(1, Math.round((ogDescription.split(/\s+/).length * 20) / 200))} min read`
				: null,
			siteName,
			bodyText: null
		};
	}

	// ─── Article content extraction via Readability ───
	if (type === 'article' || (enrichment && enrichment.kind === 'article')) {
		try {
			const dom = new JSDOM(html, { url });
			const reader = new Readability(dom.window.document);
			const article = reader.parse();

			if (article && article.content) {
				// Sanitize the extracted HTML
				const cleanHtml = DOMPurify.sanitize(article.content, {
					ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'strong', 'em', 'b', 'i'],
					ALLOWED_ATTR: ['href', 'src', 'alt', 'title']
				});

				if (enrichment && enrichment.kind === 'article') {
					const art = enrichment as ArticleEnrichment;
					art.contentHtml = cleanHtml;
					if (!art.bodyText && article.textContent) {
						art.bodyText = article.textContent.trim().slice(0, 10000);
					}
					if (article.byline && !art.author) art.author = article.byline;
					if (article.siteName && !art.siteName) art.siteName = article.siteName;
				} else if (!enrichment) {
					enrichment = {
						kind: 'article',
						author: article.byline || null,
						publishedDate: null,
						readingTime: `${Math.max(1, Math.round(article.textContent.split(/\s+/).length / 200))} min read`,
						siteName: article.siteName || null,
						bodyText: article.textContent.trim().slice(0, 10000),
						contentHtml: cleanHtml
					};
					type = 'article';
				}
			}
		} catch (e) {
			console.error('Failed to parse article with Readability:', e);
		}
	}

	return {
		title: ogTitle ?? url,
		image: finalImage ?? null,
		description: ogDescription ?? null,
		url,
		price: price ?? null,
		type,
		youtubeId: youtubeId ?? null,
		enrichment: enrichment ?? null
	};
}
