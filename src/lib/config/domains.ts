/**
 * @file domains.ts
 * @description Shared domain classification lists. Single source of truth used
 *              by ogParser, contentDetection, linkVariant, api/og, and
 *              enrichmentGuards. Taken as the union of prior duplicated lists.
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
	'simonandschuster.com', 'barnesandnoble.com', 'libro.fm',
	'audible.com', 'bookdepository.com'
] as const;

export const PLACE_DOMAINS = [
	'yelp.com', 'tripadvisor.com', 'foursquare.com',
	'opentable.com', 'thefork.com', 'zomato.com',
	'happycow.net', 'timeout.com', 'resy.com'
] as const;

export const MUSIC_DOMAINS = [
	'open.spotify.com', 'spotify.com', 'soundcloud.com',
	'music.apple.com', 'tidal.com', 'bandcamp.com',
	'deezer.com', 'last.fm', 'qobuz.com'
] as const;

export const ARTICLE_DOMAINS = [
	'medium.com', 'substack.com', 'nytimes.com', 'theguardian.com',
	'washingtonpost.com', 'bbc.com', 'bbc.co.uk', 'arstechnica.com',
	'theverge.com', 'wired.com', 'theatlantic.com', 'newyorker.com',
	'reuters.com', 'apnews.com', 'economist.com', 'ft.com',
	'bloomberg.com', 'techcrunch.com', 'thenextweb.com', 'dev.to',
	'hackernoon.com', 'longform.org', 'nautil.us', 'slate.com'
] as const;

export const SOCIAL_DOMAINS = [
	'twitter.com', 'x.com', 'instagram.com', 'threads.net',
	'reddit.com', 'mastodon.social', 'bsky.app', 'tumblr.com',
	'facebook.com', 'linkedin.com', 'tiktok.com', 'pinterest.com'
] as const;

export const GITHUB_DOMAINS = [
	'github.com', 'gitlab.com', 'bitbucket.org', 'gist.github.com',
	'sourcegraph.com', 'codeberg.org'
] as const;

/** Known product retailer domains */
export const PRODUCT_DOMAINS = [
	// Amazon regional (must cover all major TLDs)
	'amazon.com', 'amazon.co', 'amazon.co.uk', 'amazon.de', 'amazon.es', 'amazon.fr',
	'amazon.it', 'amazon.ca', 'amazon.co.jp', 'amazon.com.au', 'amazon.com.br',
	'amazon.com.mx', 'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.sa',
	'amazon.ae', 'amazon.in', 'amazon.sg', 'amazon.com.tr',
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
	'sephora.com', 'ulta.com', 'chewy.com', 'petco.com', 'petsmart.com',
	// International retailers
	'lazada.com', 'shopee.com', 'tokopedia.com', 'flipkart.com',
	'jd.com', 'taobao.com', 'tmall.com', 'rakuten.com',
	// Additional
	'thredup.com', 'poshmark.com', 'depop.com', 'mercadolibre.com',
	'mercadolibre.com.mx', 'mercadolivre.com'
] as const;

/** Known video platform domains */
export const VIDEO_DOMAINS = [
	'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com',
	'dailymotion.com', 'twitch.tv', 'rumble.com', 'bitchute.com',
	'odysee.com', 'streamable.com', 'loom.com', 'wistia.com',
	'peertube.social', 'vidyard.com', 'kick.com', 'rutube.ru'
] as const;

// ─── URL Path Patterns ───────────────────────────────────────────────────────

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

/** Image file extensions — direct image URLs */
export const IMAGE_EXTENSIONS = [
	'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico', '.tiff'
] as const;

/** Image hosting domains */
export const IMAGE_DOMAINS = [
	'imgur.com', 'i.imgur.com', 'flickr.com', '500px.com',
	'unsplash.com', 'pexels.com', 'pixabay.com', 'shutterstock.com',
	'gettyimages.com', 'deviantart.com', 'pinimg.com', 'i.pinimg.com',
	'gfycat.com', 'cloudinary.com', 'imgbb.com', 'postimg.cc'
] as const;

/** URL patterns suggesting image content */
export const IMAGE_PATH_PATTERNS = [
	/\/images?\//i,
	/\/photos?\//i,
	/\/pictures?\//i,
	/\/img\//i,
	/\/gallery\//i,
	/\/wp-content\/uploads/i,
	/\/cdn\/.*\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i,
	/\/media\/.*\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i
] as const;

// ─── Helper Functions ────────────────────────────────────────────────────────

/** Check if a domain (www-stripped) matches any entry in a domain list. */
export function matchesDomain(domain: string, list: readonly string[]): boolean {
	return list.some(d => domain === d || domain.endsWith('.' + d));
}

/** Alias kept for call sites that used the longer name. */
export const matchesDomainList = matchesDomain;

/** Check if a URL path matches any pattern. */
export function matchesPathPattern(pathname: string, patterns: readonly RegExp[]): boolean {
	return patterns.some(p => p.test(pathname));
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
