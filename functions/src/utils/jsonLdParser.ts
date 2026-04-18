/**
 * @file jsonLdParser.ts
 * @description Shared utilities for parsing JSON-LD structured data.
 */

import type {
	RecipeEnrichment,
	MovieEnrichment,
	BookEnrichment,
	MusicEnrichment,
	PlaceEnrichment,
	ArticleEnrichment,
	GitHubEnrichment,
	VideoEnrichment,
	ProductEnrichment,
	StructuredEnrichment,
} from '../types/jsonLdTypes.js';

/** Normalize schema.org availability URLs/labels to the enumerated values. */
const AVAILABILITY_CODES: Array<ProductEnrichment['availability']> = [
	'InStock',
	'OutOfStock',
	'PreOrder',
	'BackOrder',
	'Discontinued',
	'LimitedAvailability',
];

function normalizeAvailability(v: unknown): ProductEnrichment['availability'] {
	if (typeof v !== 'string') return null;
	// Strip schema.org prefix: "https://schema.org/InStock" → "InStock"
	const tail = v.split('/').pop()?.trim() ?? '';
	const match = AVAILABILITY_CODES.find((code) => code && code.toLowerCase() === tail.toLowerCase());
	return match ?? null;
}

/** Extract brand name from `{ brand: "Foo" }` or `{ brand: { name: "Foo" } }`. */
function extractBrand(v: unknown): string | null {
	if (!v) return null;
	if (typeof v === 'string') return v.trim() || null;
	if (Array.isArray(v)) {
		for (const item of v) {
			const name = extractBrand(item);
			if (name) return name;
		}
		return null;
	}
	if (typeof v === 'object') return str((v as Record<string, unknown>).name);
	return null;
}

/** Walk the nested offers structure to find availability/currency. */
function scanOffers<T>(offers: unknown, pick: (o: Record<string, unknown>) => T | null): T | null {
	if (!offers || typeof offers !== 'object') return null;
	const list = Array.isArray(offers) ? offers : [offers];
	for (const offer of list) {
		if (!offer || typeof offer !== 'object') continue;
		const o = offer as Record<string, unknown>;
		const picked = pick(o);
		if (picked) return picked;
		if (o.offers) {
			const nested = scanOffers(o.offers, pick);
			if (nested) return nested;
		}
	}
	return null;
}

/**
 * Extract string value, handling numbers and null/empty cases.
 */
export function str(v: unknown): string | null {
	if (typeof v === 'string' && v.trim()) return v.trim();
	if (typeof v === 'number') return String(v);
	return null;
}

/**
 * Extract person name from various JSON-LD formats.
 */
export function personName(v: unknown): string | null {
	if (typeof v === 'string') return v.trim() || null;
	if (Array.isArray(v)) {
		return v.map(personName).filter(Boolean).join(', ') || null;
	}
	if (v && typeof v === 'object') {
		return str((v as Record<string, unknown>).name);
	}
	return null;
}

/**
 * Format ISO 8601 duration (e.g., PT1H30M) to human-readable format.
 */
export function formatIsoDuration(iso: unknown): string | null {
	if (typeof iso !== 'string') return null;
	const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
	if (!m) return iso;
	const parts: string[] = [];
	if (m[1]) parts.push(`${m[1]}h`);
	if (m[2]) parts.push(`${m[2]}m`);
	if (m[3] && !m[1] && !m[2]) parts.push(`${m[3]}s`);
	return parts.join(' ') || null;
}

/**
 * Extract recipe ingredients from JSON-LD.
 */
export function extractIngredients(v: unknown): string[] {
	if (Array.isArray(v)) {
		return v.filter(i => typeof i === 'string' && i.trim()).map(i => String(i).trim());
	}
	if (typeof v === 'string') {
		return v.split(/\n+/).map(s => s.trim()).filter(Boolean);
	}
	return [];
}

/**
 * Extract recipe instructions from JSON-LD.
 */
export function extractInstructions(v: unknown): string[] {
	if (!v) return [];
	if (typeof v === 'string') {
		return v.split(/\n+/).map(s => s.trim()).filter(Boolean);
	}
	if (Array.isArray(v)) {
		return v.flatMap(item => {
			if (typeof item === 'string') return [item.trim()];
			if (item && typeof item === 'object') {
				const obj = item as Record<string, unknown>;
				if (obj.text) return [String(obj.text).trim()];
				if (Array.isArray(obj.itemListElement)) {
					return extractInstructions(obj.itemListElement);
				}
			}
			return [];
		}).filter(Boolean);
	}
	return [];
}

/**
 * Check if a type list contains a specific type.
 */
export function hasType(types: unknown[], targetType: string): boolean {
	return types.some((v) =>
		typeof v === 'string' && (v === targetType || v.endsWith('/' + targetType))
	);
}

/**
 * Parse video JSON-LD into structured enrichment.
 */
export function parseVideo(data: Record<string, unknown>): VideoEnrichment | null {
	const publisher = data.publisher as Record<string, unknown> | undefined;
	const views = data.interactionCount || (data.interactionStatistic as Record<string, unknown> | undefined)?.userInteractionCount;

	return {
		kind: 'video',
		author: personName(data.author),
		publishedDate: str(data.uploadDate)?.slice(0, 10) ?? null,
		duration: formatIsoDuration(data.duration),
		views: views ? String(views) : null,
		siteName: publisher ? str(publisher.name) : null,
	};
}

/**
 * Parse recipe JSON-LD into structured enrichment.
 */
export function parseRecipe(data: Record<string, unknown>): RecipeEnrichment | null {
	const recipe: RecipeEnrichment = {
		kind: 'recipe',
		cookTime: formatIsoDuration(data.cookTime),
		prepTime: formatIsoDuration(data.prepTime),
		totalTime: formatIsoDuration(data.totalTime),
		servings: str(data.recipeYield) ?? str(data.yield),
		ingredients: extractIngredients(data.recipeIngredient),
		instructions: extractInstructions(data.recipeInstructions),
		cuisine: str(data.recipeCuisine),
		calories: null,
	};

	if (data.nutrition && typeof data.nutrition === 'object') {
		recipe.calories = str((data.nutrition as Record<string, unknown>).calories);
	}

	return recipe;
}

/**
 * Parse movie/TV JSON-LD into structured enrichment.
 */
export function parseMovie(data: Record<string, unknown>): MovieEnrichment | null {
	const rating = data.aggregateRating as Record<string, unknown> | undefined;
	
	return {
		kind: 'movie',
		director: personName(data.director),
		year: data.datePublished
			? parseInt(String(data.datePublished).slice(0, 4), 10) || null
			: null,
		runtime: formatIsoDuration(data.duration),
		genre: Array.isArray(data.genre)
			? data.genre.join(', ')
			: str(data.genre),
		rating: rating ? str(rating.ratingValue) : null,
		ratingSource: rating
			? (str(rating.bestRating) ? `/${rating.bestRating}` : '/10')
			: null,
		cast: Array.isArray(data.actor)
			? data.actor.map(personName).filter(Boolean) as string[]
			: [],
		contentRating: str(data.contentRating),
	};
}

/**
 * Parse book JSON-LD into structured enrichment.
 */
export function parseBook(data: Record<string, unknown>): BookEnrichment | null {
	const rating = data.aggregateRating as Record<string, unknown> | undefined;
	
	return {
		kind: 'book',
		author: personName(data.author),
		genre: Array.isArray(data.genre)
			? data.genre.join(', ')
			: str(data.genre),
		pageCount: data.numberOfPages
			? parseInt(String(data.numberOfPages), 10) || null
			: null,
		isbn: str(data.isbn),
		publisher: personName(data.publisher),
		publishDate: str(data.datePublished),
		averageRating: rating ? str(rating.ratingValue) : null,
	};
}

/**
 * Parse music JSON-LD into structured enrichment.
 */
export function parseMusic(data: Record<string, unknown>): MusicEnrichment | null {
	let artist = personName(data.byArtist);
	
	// Try to extract artist from description if not found
	if (!artist && typeof data.description === 'string') {
		const descParts = data.description.split(/\s*·\s*/);
		const skipWords = ['song', 'album', 'single', 'ep', 'podcast', 'episode'];
		const candidates = descParts.filter((p: string) => {
			const t = p.trim().toLowerCase();
			return (
				t &&
				!/^\d{4}$/.test(t) &&
				!/^\d+\s+songs?$/.test(t) &&
				!skipWords.includes(t) &&
				!t.includes('listen to')
			);
		});
		if (candidates.length > 0) {
			artist = candidates[0].trim();
		}
	}

	return {
		kind: 'music',
		artist,
		album: hasType(data['@type'] ? [data['@type']] : [], 'MusicRecording')
			? str(data.inAlbum ? (data.inAlbum as Record<string, unknown>).name : null)
			: str(data.name),
		duration: formatIsoDuration(data.duration),
		genre: Array.isArray(data.genre)
			? data.genre.join(', ')
			: str(data.genre),
	};
}

/**
 * Parse place/business JSON-LD into structured enrichment.
 */
export function parsePlace(data: Record<string, unknown>): PlaceEnrichment | null {
	const rating = data.aggregateRating as Record<string, unknown> | undefined;
	const addr = data.address as Record<string, unknown> | undefined;
	const geo = data.geo as Record<string, unknown> | undefined;
	
	const types = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
	const category = types.find(
		t => typeof t === 'string' && t !== 'LocalBusiness'
	) as string ?? null;

	return {
		kind: 'place',
		address: addr
			? [str(addr.streetAddress), str(addr.addressLocality), str(addr.addressRegion)]
				.filter(Boolean)
				.join(', ')
			: null,
		phone: str(data.telephone),
		priceRange: str(data.priceRange),
		category,
		rating: rating ? str(rating.ratingValue) : null,
		ratingCount: rating?.reviewCount
			? parseInt(String(rating.reviewCount), 10) || null
			: null,
		latitude: geo?.latitude
			? parseFloat(String(geo.latitude)) || null
			: null,
		longitude: geo?.longitude
			? parseFloat(String(geo.longitude)) || null
			: null,
		hours: Array.isArray(data.openingHours)
			? (data.openingHours as string[]).join(', ')
			: str(data.openingHours),
	};
}

/**
 * Parse article JSON-LD into structured enrichment.
 */
export function parseArticle(data: Record<string, unknown>): ArticleEnrichment | null {
	const author = personName(data.author);
	const publishedDate = str(data.datePublished);
	const types = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
	
	// Skip if it's just a generic WebPage without article metadata
	if (!author && !publishedDate && hasType(types, 'WebPage')) {
		return null;
	}

	const wordCount = data.wordCount
		? parseInt(String(data.wordCount), 10)
		: null;
	const publisher = data.publisher as Record<string, unknown> | undefined;

	// Extract article body text from JSON-LD (many news sites include it)
	let bodyText: string | null = null;
	const rawBody = str(data.articleBody) ?? str(data.text);
	if (rawBody && rawBody.length > 50) {
		// Cap at ~10k chars to avoid storing massive articles
		bodyText = rawBody.length > 10000 ? rawBody.slice(0, 10000) + '…' : rawBody;
	}

	return {
		kind: 'article',
		author,
		publishedDate,
		readingTime: wordCount
			? `${Math.max(1, Math.round(wordCount / 200))} min read`
			: null,
		siteName: publisher ? str(publisher.name) : null,
		bodyText
	};
}

/**
 * Parse GitHub/Software JSON-LD into structured enrichment.
 */
export function parseGitHub(data: Record<string, unknown>): GitHubEnrichment | null {
	return {
		kind: 'github',
		owner: null,
		repo: str(data.name),
		description: str(data.description),
		language: str(data.programmingLanguage) ??
			(data.programmingLanguage && typeof data.programmingLanguage === 'object'
				? str((data.programmingLanguage as Record<string, unknown>).name)
				: null),
		stars: null,
		forks: null,
	};
}

/**
 * Parse Product JSON-LD into structured enrichment.
 * Captures brand, rating, availability, and currency — fields that are useful
 * to surface on the card but sit outside price/title/image.
 */
export function parseProduct(data: Record<string, unknown>): ProductEnrichment | null {
	const rating = data.aggregateRating as Record<string, unknown> | undefined;
	const category = Array.isArray(data.category)
		? (data.category as unknown[]).map((c) => str(c)).filter(Boolean).join(' › ') || null
		: str(data.category);

	const availability =
		scanOffers(data.offers, (o) => normalizeAvailability(o.availability)) ?? null;
	const currency =
		scanOffers(data.offers, (o) => str(o.priceCurrency)) ?? str(data.priceCurrency);

	const product: ProductEnrichment = {
		kind: 'product',
		brand: extractBrand(data.brand) ?? extractBrand(data.manufacturer),
		rating: rating ? str(rating.ratingValue) : null,
		ratingCount: rating?.reviewCount
			? parseInt(String(rating.reviewCount), 10) || null
			: rating?.ratingCount
				? parseInt(String(rating.ratingCount), 10) || null
				: null,
		availability,
		currency: currency ? currency.toUpperCase() : null,
		category,
	};

	// Skip the enrichment entirely if we have no useful fields beyond the kind.
	const hasData =
		product.brand ||
		product.rating ||
		product.availability ||
		product.currency ||
		product.category;
	return hasData ? product : null;
}

/**
 * Walk JSON-LD graph and extract structured enrichment.
 */
export function extractEnrichmentFromJsonLd(data: unknown): StructuredEnrichment | null {
	if (!data || typeof data !== 'object') return null;
	
	if (Array.isArray(data)) {
		for (const item of data) {
			const result = extractEnrichmentFromJsonLd(item);
			if (result) return result;
		}
		return null;
	}

	const obj = data as Record<string, unknown>;
	
	// Handle @graph arrays
	if (Array.isArray(obj['@graph'])) {
		for (const item of obj['@graph']) {
			const result = extractEnrichmentFromJsonLd(item);
			if (result) return result;
		}
		return null;
	}

	const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];

	// Try each parser based on type
	if (hasType(types, 'VideoObject')) return parseVideo(obj);
	if (hasType(types, 'Recipe')) return parseRecipe(obj);
	if (hasType(types, 'Movie') || hasType(types, 'TVSeries') || hasType(types, 'TVEpisode')) {
		return parseMovie(obj);
	}
	if (hasType(types, 'Book')) return parseBook(obj);
	if (hasType(types, 'MusicRecording') || hasType(types, 'MusicAlbum')) {
		return parseMusic(obj);
	}
	if (
		hasType(types, 'Restaurant') ||
		hasType(types, 'LocalBusiness') ||
		hasType(types, 'FoodEstablishment') ||
		hasType(types, 'CafeOrCoffeeShop') ||
		hasType(types, 'BarOrPub') ||
		hasType(types, 'Hotel')
	) {
		return parsePlace(obj);
	}
	if (
		hasType(types, 'Article') ||
		hasType(types, 'NewsArticle') ||
		hasType(types, 'BlogPosting')
	) {
		return parseArticle(obj);
	}
	if (hasType(types, 'SoftwareSourceCode') || hasType(types, 'SoftwareApplication')) {
		return parseGitHub(obj);
	}
	// Product variants — kept last so a more specific type (Recipe on a product
	// page, Book on a bookseller page) wins if present.
	if (
		hasType(types, 'Product') ||
		hasType(types, 'IndividualProduct') ||
		hasType(types, 'ProductGroup') ||
		hasType(types, 'ProductModel')
	) {
		return parseProduct(obj);
	}

	// Check mainEntity references
	if (obj.mainEntity) return extractEnrichmentFromJsonLd(obj.mainEntity);
	if (obj.mainEntityOfPage) return extractEnrichmentFromJsonLd(obj.mainEntityOfPage);
	
	return null;
}
