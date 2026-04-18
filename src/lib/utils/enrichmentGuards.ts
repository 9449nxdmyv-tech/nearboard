/**
 * @file enrichmentGuards.ts
 * @description Type guard functions for enrichment types.
 *              Used by LinkCard router and other components to safely narrow enrichment types.
 */

import type {
	LinkEnrichment,
	RecipeEnrichment,
	MovieEnrichment,
	BookEnrichment,
	PlaceEnrichment,
	MusicEnrichment,
	ArticleEnrichment,
	GithubEnrichment,
	VideoEnrichment,
	ProductEnrichment
} from '$lib/types/api';
import {
	MUSIC_DOMAINS, MOVIE_DOMAINS, BOOK_DOMAINS, RECIPE_DOMAINS,
	ARTICLE_DOMAINS, GITHUB_DOMAINS, SOCIAL_DOMAINS,
	matchesDomain
} from '$lib/config/domains';

/**
 * Type guard to check if enrichment is a RecipeEnrichment.
 * Validates that required fields are present.
 */
export function isRecipeEnrichment(e: LinkEnrichment | null | undefined): e is RecipeEnrichment {
	return e?.kind === 'recipe';
}

/**
 * Type guard to check if enrichment is a MovieEnrichment.
 * Validates that at least one meaningful field exists.
 */
export function isMovieEnrichment(e: LinkEnrichment | null | undefined): e is MovieEnrichment {
	if (e?.kind !== 'movie') return false;
	// Validate at least one meaningful field exists
	return !!(e.year || e.director || e.rating || e.cast?.length);
}

/**
 * Type guard to check if enrichment is a BookEnrichment.
 */
export function isBookEnrichment(e: LinkEnrichment | null | undefined): e is BookEnrichment {
	if (e?.kind !== 'book') return false;
	return !!(e.author || e.genre || e.averageRating || e.pageCount);
}

/**
 * Type guard to check if enrichment is a PlaceEnrichment.
 */
export function isPlaceEnrichment(e: LinkEnrichment | null | undefined): e is PlaceEnrichment {
	if (e?.kind !== 'place') return false;
	return !!(e.category || e.rating || e.address || e.priceRange);
}

/**
 * Type guard to check if enrichment is a MusicEnrichment.
 */
export function isMusicEnrichment(e: LinkEnrichment | null | undefined): e is MusicEnrichment {
	if (e?.kind !== 'music') return false;
	return !!(e.artist || e.album || e.genre || e.duration);
}

/**
 * Type guard to check if enrichment is an ArticleEnrichment.
 * Unlike other kinds, we trust the 'article' kind marker even when metadata
 * fields are null — the article layout degrades gracefully to just title +
 * description, which is still meaningfully distinct from a generic link.
 * Server-side parsers sometimes produce {kind:'article'} with all-null fields
 * for known article domains that weren't scrapeable (see buildMinimalEnrichment
 * in functions/src/triggers/ogMetadata.ts).
 */
export function isArticleEnrichment(e: LinkEnrichment | null | undefined): e is ArticleEnrichment {
	return e?.kind === 'article';
}

/**
 * Type guard to check if enrichment is a GithubEnrichment.
 */
export function isGithubEnrichment(e: LinkEnrichment | null | undefined): e is GithubEnrichment {
	if (e?.kind !== 'github') return false;
	return !!(e.repo || e.owner || e.description || e.language);
}

/**
 * Type guard to check if enrichment is a VideoEnrichment.
 */
export function isVideoEnrichment(e: LinkEnrichment | null | undefined): e is VideoEnrichment {
	if (e?.kind !== 'video') return false;
	return !!(e.author || e.siteName || e.publishedDate);
}

/**
 * Type guard to check if enrichment is a ProductEnrichment.
 * Validates that at least one meaningful field exists beyond the kind.
 */
export function isProductEnrichment(e: LinkEnrichment | null | undefined): e is ProductEnrichment {
	if (e?.kind !== 'product') return false;
	return !!(e.brand || e.rating || e.availability || e.category);
}

/**
 * Validates that enrichment has minimum required data for rendering.
 * Returns false if enrichment exists but is too sparse to use.
 */
export function isValidEnrichment(e: LinkEnrichment | null | undefined): boolean {
	if (!e) return false;

	switch (e.kind) {
		case 'recipe': return isRecipeEnrichment(e);
		case 'movie': return isMovieEnrichment(e);
		case 'book': return isBookEnrichment(e);
		case 'place': return isPlaceEnrichment(e);
		case 'music': return isMusicEnrichment(e);
		case 'article': return isArticleEnrichment(e);
		case 'github': return isGithubEnrichment(e);
		case 'video': return isVideoEnrichment(e);
		case 'product': return isProductEnrichment(e);
		default:
			// Unknown kind - treat as invalid
			return false;
	}
}

/**
 * Get the enrichment kind from a URL and enrichment data.
 * Prioritizes enrichment.kind, then falls back to URL detection.
 */
export function getEnrichmentKind(url: string, enrichment: LinkEnrichment | null | undefined): string | null {
	if (enrichment?.kind) return enrichment.kind;

	// Fallback: detect from URL
	const urlObj = new URL(url);
	const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();

	// YouTube
	if (/youtube\.com|youtu\.be/.test(domain)) return 'video';

	if (matchesDomain(domain, MUSIC_DOMAINS)) return 'music';
	if (matchesDomain(domain, MOVIE_DOMAINS)) return 'movie';
	if (matchesDomain(domain, BOOK_DOMAINS)) return 'book';
	if (matchesDomain(domain, RECIPE_DOMAINS)) return 'recipe';
	if (matchesDomain(domain, GITHUB_DOMAINS)) return 'github';
	if (matchesDomain(domain, ARTICLE_DOMAINS)) return 'article';
	if (matchesDomain(domain, SOCIAL_DOMAINS)) return 'social';

	return null;
}
