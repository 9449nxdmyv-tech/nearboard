/**
 * @file domains.ts
 * @description Shared domain classification lists. Single source of truth used
 *              by ogParser (enrichment fallback) and linkVariant (visual badges).
 */

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

export const MOVIE_DOMAINS = [
	'imdb.com', 'letterboxd.com', 'rottentomatoes.com', 'themoviedb.org',
	'netflix.com', 'tv.apple.com', 'disneyplus.com', 'hbo.com', 'max.com',
	'hulu.com', 'primevideo.com', 'crunchyroll.com', 'mubi.com', 'criterion.com',
	'paramountplus.com', 'peacocktv.com', 'tubitv.com', 'pluto.tv',
	'justwatch.com', 'trakt.tv', 'tvtime.com', 'serializd.com'
] as const;

export const BOOK_DOMAINS = [
	'goodreads.com', 'openlibrary.org', 'bookshop.org',
	'books.google.com', 'penguin.com', 'harpercollins.com',
	'simonandschuster.com', 'barnesandnoble.com', 'libro.fm'
] as const;

export const PLACE_DOMAINS = [
	'yelp.com', 'tripadvisor.com', 'foursquare.com',
	'opentable.com', 'thefork.com', 'zomato.com',
	'happycow.net', 'timeout.com'
] as const;

export const MUSIC_DOMAINS = [
	'open.spotify.com', 'spotify.com', 'soundcloud.com',
	'music.apple.com', 'tidal.com', 'bandcamp.com',
	'deezer.com', 'last.fm'
] as const;

export const ARTICLE_DOMAINS = [
	'medium.com', 'substack.com', 'nytimes.com', 'theguardian.com',
	'washingtonpost.com', 'bbc.com', 'bbc.co.uk', 'arstechnica.com',
	'theverge.com', 'wired.com', 'theatlantic.com', 'newyorker.com',
	'reuters.com', 'apnews.com', 'economist.com', 'ft.com',
	'bloomberg.com', 'techcrunch.com', 'thenextweb.com', 'dev.to',
	'hackernoon.com', 'longform.org', 'nautil.us'
] as const;

export const SOCIAL_DOMAINS = [
	'twitter.com', 'x.com', 'instagram.com', 'threads.net',
	'reddit.com', 'mastodon.social', 'bsky.app', 'tumblr.com',
	'facebook.com', 'linkedin.com', 'tiktok.com', 'pinterest.com'
] as const;

export const GITHUB_DOMAINS = [
	'github.com', 'gitlab.com', 'bitbucket.org', 'gist.github.com'
] as const;

/** Check if a domain (www-stripped) matches any entry in a domain list. */
export function matchesDomain(domain: string, list: readonly string[]): boolean {
	return list.some(d => domain === d || domain.endsWith('.' + d));
}

/** Check if a URL points to Google/Apple Maps. */
export function isMapsUrl(domain: string, url: string): boolean {
	if (domain === 'maps.google.com' || domain === 'maps.apple.com') return true;
	if ((domain === 'google.com' || domain.endsWith('.google.com')) && url.includes('/maps')) return true;
	return false;
}

/** Check if a URL is an Amazon Prime Video page (not a product). */
export function isAmazonVideoUrl(domain: string, url: string): boolean {
	if (!domain.match(/(?:^|\.)amazon\.\w+(?:\.\w+)?$/)) return false;
	return /\/gp\/video\/|\/dp\/[A-Z0-9]+.*video|\/Amazon-Video/i.test(url);
}
