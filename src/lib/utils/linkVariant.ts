/**
 * @file linkVariant.ts
 * @description Classifies a link's domain into a visual variant for content-aware
 *              rendering in LinkCard. Pure function — no side effects, no API calls.
 */

import {
	RECIPE_DOMAINS, MOVIE_DOMAINS, BOOK_DOMAINS, PLACE_DOMAINS,
	MUSIC_DOMAINS, ARTICLE_DOMAINS, SOCIAL_DOMAINS, GITHUB_DOMAINS,
	matchesDomain, isMapsUrl, isAmazonVideoUrl
} from '$lib/config/domains';

export type LinkVariant =
	| 'article'
	| 'recipe'
	| 'movie'
	| 'book'
	| 'place'
	| 'music'
	| 'social'
	| 'github'
	| 'default';

export interface LinkVariantConfig {
	variant: LinkVariant;
	icon: string;
	label: string;
	accentColor: string;
	imageAspect: 'landscape' | 'portrait' | 'square';
}

const VARIANT_CONFIGS: Record<LinkVariant, Omit<LinkVariantConfig, 'variant'>> = {
	recipe:  { icon: 'ph:cooking-pot',       label: 'Recipe',  accentColor: '#e07c4f', imageAspect: 'landscape' },
	movie:   { icon: 'ph:film-strip',        label: 'Film',    accentColor: '#c9375d', imageAspect: 'portrait'  },
	book:    { icon: 'ph:book-open-text',     label: 'Book',    accentColor: '#7c6f5b', imageAspect: 'portrait'  },
	place:   { icon: 'ph:map-pin',            label: 'Place',   accentColor: '#3b9b6d', imageAspect: 'landscape' },
	music:   { icon: 'ph:music-notes-simple', label: 'Music',   accentColor: '#1db954', imageAspect: 'square'    },
	article: { icon: 'ph:article',            label: 'Article', accentColor: '#4a7fb5', imageAspect: 'landscape' },
	social:  { icon: 'ph:chat-circle-dots',   label: 'Social',  accentColor: '#6c63ff', imageAspect: 'landscape' },
	github:  { icon: 'ph:github-logo',        label: 'Code',   accentColor: '#333333', imageAspect: 'landscape' },
	default: { icon: 'ph:link-simple',        label: 'Link',    accentColor: '#6c63ff', imageAspect: 'landscape' }
};

/**
 * Classifies a link by its domain into a visual variant.
 * Returns a config object with icon, label, accent color, and layout hints.
 */
export function getLinkVariant(domain: string, url: string = ''): LinkVariantConfig {
	const d = domain.replace(/^www\./, '').toLowerCase();

	let variant: LinkVariant = 'default';

	if (isMapsUrl(d, url))                       variant = 'place';
	else if (isAmazonVideoUrl(d, url))            variant = 'movie';
	else if (matchesDomain(d, RECIPE_DOMAINS))    variant = 'recipe';
	else if (matchesDomain(d, MOVIE_DOMAINS))     variant = 'movie';
	else if (matchesDomain(d, BOOK_DOMAINS))      variant = 'book';
	else if (matchesDomain(d, PLACE_DOMAINS))     variant = 'place';
	else if (matchesDomain(d, MUSIC_DOMAINS))     variant = 'music';
	else if (matchesDomain(d, GITHUB_DOMAINS))    variant = 'github';
	else if (matchesDomain(d, ARTICLE_DOMAINS))   variant = 'article';
	else if (matchesDomain(d, SOCIAL_DOMAINS))    variant = 'social';

	return { variant, ...VARIANT_CONFIGS[variant] };
}

/**
 * Estimates reading time from description text.
 * Returns null if text is too short to estimate.
 */
export function estimateReadingTime(description: string | null): string | null {
	if (!description || description.length < 80) return null;
	// Rough estimate: average OG description is ~1/20th of article length
	const estimatedWords = description.split(/\s+/).length * 20;
	const minutes = Math.max(1, Math.round(estimatedWords / 200));
	return `${minutes} min read`;
}
