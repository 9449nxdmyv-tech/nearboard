/**
 * @file jsonLdTypes.ts
 * @description Shared types for JSON-LD structured data parsing.
 * 
 * Note: These types are duplicated in src/lib/types/api.ts for client-side use.
 * Consider moving to a shared package in the future.
 */

export interface LinkEnrichment {
	kind: string;
	[key: string]: unknown;
}

export interface RecipeEnrichment extends LinkEnrichment {
	kind: 'recipe';
	cookTime: string | null;
	prepTime: string | null;
	totalTime: string | null;
	servings: string | null;
	ingredients: string[];
	instructions: string[];
	cuisine: string | null;
	calories: string | null;
}

export interface MovieEnrichment extends LinkEnrichment {
	kind: 'movie';
	director: string | null;
	year: number | null;
	runtime: string | null;
	genre: string | null;
	rating: string | null;
	ratingSource: string | null;
	cast: string[];
	contentRating: string | null;
}

export interface BookEnrichment extends LinkEnrichment {
	kind: 'book';
	author: string | null;
	genre: string | null;
	pageCount: number | null;
	isbn: string | null;
	publisher: string | null;
	publishDate: string | null;
	averageRating: string | null;
}

export interface MusicEnrichment extends LinkEnrichment {
	kind: 'music';
	artist: string | null;
	album: string | null;
	duration: string | null;
	genre: string | null;
}

export interface PlaceEnrichment extends LinkEnrichment {
	kind: 'place';
	address: string | null;
	phone: string | null;
	priceRange: string | null;
	category: string | null;
	rating: string | null;
	ratingCount: number | null;
	latitude: number | null;
	longitude: number | null;
	hours: string | null;
}

export interface ArticleEnrichment extends LinkEnrichment {
	kind: 'article';
	author: string | null;
	publishedDate: string | null;
	readingTime: string | null;
	siteName: string | null;
}

export interface GitHubEnrichment extends LinkEnrichment {
	kind: 'github';
	owner: string | null;
	repo: string | null;
	description: string | null;
	language: string | null;
	stars: string | null;
	forks: string | null;
}

/** Alias for frontend compatibility (uses lowercase 'h') */
export type GithubEnrichment = GitHubEnrichment;

export type StructuredEnrichment =
	| RecipeEnrichment
	| MovieEnrichment
	| BookEnrichment
	| MusicEnrichment
	| PlaceEnrichment
	| ArticleEnrichment
	| GitHubEnrichment;
