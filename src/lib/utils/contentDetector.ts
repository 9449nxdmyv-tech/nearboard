/**
 * @file contentDetector.ts
 * @deprecated Use contentDetection.ts instead.
 * 
 * This file is kept for backward compatibility.
 * All new code should import from './contentDetection'.
 */

// Re-export new types and functions for backward compatibility
export {
	detectContentType,
	detectFromUrl,
	detectFromText,
	refineDetection as refineContentType,  // Backward compatibility alias
	refineDetection,
	extractDomain,
	matchesDomainList,
	matchesPathPattern,
	confidenceToLevel,
	isValidUrl as isUrl,  // Backward compatibility alias
	// Domain lists
	PRODUCT_DOMAINS,
	VIDEO_DOMAINS,
	RECIPE_DOMAINS,
	MOVIE_DOMAINS,
	BOOK_DOMAINS,
	PLACE_DOMAINS,
	MUSIC_DOMAINS,
	ARTICLE_DOMAINS,
	GITHUB_DOMAINS,
	// Path patterns
	PRODUCT_PATH_PATTERNS,
	VIDEO_PATH_PATTERNS,
	ARTICLE_PATH_PATTERNS,
	// Types
	type ContentType,
	type ConfidenceLevel,
	type ContentDetectionResult,
	type DetectionSignal
} from './contentDetection';

/**
 * @deprecated Use ContentType from contentDetection.ts
 */
export type DetectedContentType = 
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
	| 'location';
