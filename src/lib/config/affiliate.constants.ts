/**
 * @file affiliate.constants.ts
 * @description Configuration for V1 affiliate monetization strategy.
 */

export const AFFILIATE_ENABLED = true;

export const AFFILIATE_PROVIDER = 'skimlinks';

export const AFFILIATE_PROVIDER_PRIORITY = [
	'skimlinks',
	'sovrn',
	'amazon'
] as const;

export const AFFILIATE_ENABLED_DOMAINS = [
	'amazon.com',
	'amazon.co.uk',
	'amazon.ca',
	'amazon.de',
	'amazon.fr',
	'amazon.it',
	'amazon.es',
	'amazon.co.jp',
	'amazon.com.au',
	'amazon.in',
	'amazon.com.br',
	'amazon.com.mx',
	'amazon.nl',
	'amazon.sg',
	'walmart.com',
	'target.com',
	'homedepot.com',
	'lowes.com',
	'bestbuy.com',
	'booking.com',
	'expedia.com'
];
