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
	StructuredEnrichment,
} from '../types/jsonLdTypes.js';

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

	return {
		kind: 'article',
		author,
		publishedDate,
		readingTime: wordCount
			? `${Math.max(1, Math.round(wordCount / 200))} min read`
			: null,
		siteName: publisher ? str(publisher.name) : null,
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

	// Check mainEntity references
	if (obj.mainEntity) return extractEnrichmentFromJsonLd(obj.mainEntity);
	if (obj.mainEntityOfPage) return extractEnrichmentFromJsonLd(obj.mainEntityOfPage);
	
	return null;
}
