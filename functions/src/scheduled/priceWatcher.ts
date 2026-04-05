/**
 * @file priceWatcher.ts
 * @description Scheduled Cloud Function that polls retailer pages daily
 *              for price changes using OG meta tags, JSON-LD structured data,
 *              and common CSS selector patterns. Updates Firestore and triggers
 *              price drop alerts.
 */

import '../utils/admin.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { notifyBoardMembers } from '../utils/fcmService.js';
import { processInBatches } from '../utils/boardEligibility.js';

/** Max price history entries per product (prevents 1MB doc limit). ~2 years of daily checks. */
const MAX_PRICE_ENTRIES = 730;

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function isAmazonDomain(hostname: string): boolean {
	return /(?:^|\.)amazon\.\w+(?:\.\w+)?$/.test(hostname.replace(/^www\./, ''));
}

function extractAsin(url: string): string | null {
	const match = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
	return match?.[1] ?? null;
}

/** Amazon-specific price extraction patterns */
function extractAmazonPrice(html: string): string | null {
	const corePrice = html.match(/class="a-price-whole"[^>]*>([^<]+)/i);
	const coreFraction = html.match(/class="a-price-fraction"[^>]*>([^<]+)/i);
	if (corePrice?.[1]) {
		const whole = corePrice[1].replace(/[^\d]/g, '');
		const frac = coreFraction?.[1]?.replace(/[^\d]/g, '') ?? '00';
		return `$${whole}.${frac}`;
	}
	const priceBlock = html.match(/id="priceblock_(?:ourprice|dealprice|saleprice)"[^>]*>\s*([^<]+)/i);
	if (priceBlock?.[1]?.trim()) return priceBlock[1].trim();
	const asinPrice = html.match(/data-asin-price="([^"]+)"/i);
	if (asinPrice?.[1]) return `$${asinPrice[1]}`;
	const ariaPrice = html.match(/<span[^>]*class="a-offscreen"[^>]*>\s*([£$€¥₹][\d.,]+)/i);
	if (ariaPrice?.[1]) return ariaPrice[1];
	return null;
}

/** Fetch Amazon product via mobile endpoint (less aggressive WAF) */
async function tryAmazonMobilePrice(productUrl: string): Promise<string | null> {
	const asin = extractAsin(productUrl);
	if (!asin) return null;
	const hostname = new URL(productUrl).hostname.replace(/^www\./, '');
	try {
		const res = await fetch(`https://${hostname}/dp/${asin}`, {
			headers: {
				'User-Agent': MOBILE_UA,
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9'
			},
			redirect: 'follow',
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return null;
		const html = await res.text();
		return extractAmazonPrice(html) ?? extractPriceFromHtml(html);
	} catch {
		return null;
	}
}

/**
 * Extracts price from OG meta tags in HTML.
 */
function extractPriceFromOgTags(html: string): string | null {
	const match = html.match(
		/<meta[^>]*property=["'](?:og:price:amount|product:price:amount)["'][^>]*content=["']([^"']+)["']/i
	) ?? html.match(
		/<meta[^>]*content=["']([^"']+)["'][^>]*property=["'](?:og:price:amount|product:price:amount)["']/i
	);
	return match?.[1] ?? null;
}

/**
 * Extracts price from JSON-LD structured data (@type: Product → offers.price).
 */
function extractPriceFromJsonLd(html: string): string | null {
	const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let scriptMatch: RegExpExecArray | null;
	while ((scriptMatch = scriptRegex.exec(html)) !== null) {
		try {
			const data = JSON.parse(scriptMatch[1]);
			const items = Array.isArray(data) ? data : [data];
			for (const item of items) {
				if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
					const offers = item.offers;
					if (!offers) continue;
					// offers can be a single object or an array
					const offerList = Array.isArray(offers) ? offers : [offers];
					for (const offer of offerList) {
						const price = offer.price ?? offer.lowPrice;
						if (price !== undefined && price !== null) {
							return String(price);
						}
					}
				}
			}
		} catch {
			// Invalid JSON-LD, skip
		}
	}
	return null;
}

/**
 * Extracts price from common CSS selector patterns via regex:
 * - class="price" elements
 * - itemprop="price" attributes
 * - data-price attributes
 */
function extractPriceFromSelectors(html: string): string | null {
	// itemprop="price" with content attribute (most reliable)
	const itemPropContent = html.match(
		/<[^>]*itemprop=["']price["'][^>]*content=["']([^"']+)["']/i
	) ?? html.match(
		/<[^>]*content=["']([^"']+)["'][^>]*itemprop=["']price["']/i
	);
	if (itemPropContent?.[1]) return itemPropContent[1];

	// data-price attribute
	const dataPrice = html.match(
		/<[^>]*data-price=["']([^"']+)["']/i
	);
	if (dataPrice?.[1]) return dataPrice[1];

	// itemprop="price" with text content
	const itemPropText = html.match(
		/<[^>]*itemprop=["']price["'][^>]*>([^<]{1,30})<\//i
	);
	if (itemPropText?.[1]?.trim()) return itemPropText[1].trim();

	// class="price" (or price-related class names) with text content
	const priceClass = html.match(
		/<[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>[\s]*([£$€¥₹]?\s*[\d.,]+)[\s]*<\//i
	);
	if (priceClass?.[1]?.trim()) return priceClass[1].trim();

	return null;
}

/**
 * Extracts price from HTML using multiple strategies in order of reliability:
 * 1. OG meta tags
 * 2. JSON-LD structured data
 * 3. Common CSS selector patterns
 */
function extractPriceFromHtml(html: string): string | null {
	return extractPriceFromOgTags(html)
		?? extractPriceFromJsonLd(html)
		?? extractPriceFromSelectors(html);
}

/**
 * Parses a price string into a numeric value, handling international formats.
 * Supports: "$1,299.99", "€1.299,99", "1 299,99 kr", "¥12800"
 */
function parsePrice(priceStr: string): number {
	// Strip currency symbols and whitespace
	let cleaned = priceStr.replace(/[^\d.,]/g, '');
	if (!cleaned) return NaN;

	// Detect format: if last separator is comma and has ≤2 digits after → comma-decimal (EU)
	const lastComma = cleaned.lastIndexOf(',');
	const lastDot = cleaned.lastIndexOf('.');

	if (lastComma > lastDot) {
		// Comma is the decimal separator (e.g. "1.299,99" or "50,99")
		cleaned = cleaned.replace(/\./g, '').replace(',', '.');
	} else {
		// Dot is the decimal separator (e.g. "1,299.99") or no decimal
		cleaned = cleaned.replace(/,/g, '');
	}

	return parseFloat(cleaned);
}

const CONCURRENCY_LIMIT = 5;

/**
 * Runs daily at 6:00 AM UTC. Checks all tracked products for price changes.
 */
export const priceWatcher = onSchedule('every day 06:00', async () => {
	const db = getFirestore();
	const pricesSnap = await db.collection('prices').get();

	await processInBatches(pricesSnap.docs, CONCURRENCY_LIMIT, async (priceDoc) => {
		const data = priceDoc.data() as {
			productUrl: string;
			boardId: string;
			contentId: string;
			entries: { price: string }[];
		};

		try {
			const response = await fetch(data.productUrl, {
				headers: {
					'User-Agent': BROWSER_UA,
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Accept-Language': 'en-US,en;q=0.9'
				},
				redirect: 'follow',
				signal: AbortSignal.timeout(10000)
			});
			if (!response.ok) return;

			const html = await response.text();
			let newPrice: string | null = null;

			const hostname = new URL(data.productUrl).hostname;
			if (isAmazonDomain(hostname)) {
				newPrice = extractAmazonPrice(html);
				// Amazon WAF fallback: try mobile endpoint
				if (!newPrice) newPrice = await tryAmazonMobilePrice(data.productUrl);
			}
			if (!newPrice) newPrice = extractPriceFromHtml(html);

			// Tier 2: Try crawler UA — sites often serve richer OG/JSON-LD to social crawlers
			if (!newPrice) {
				try {
					const crawlerRes = await fetch(data.productUrl, {
						headers: {
							'User-Agent': CRAWLER_UA,
							'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
						},
						redirect: 'follow',
						signal: AbortSignal.timeout(8000)
					});
					if (crawlerRes.ok) {
						const crawlerHtml = await crawlerRes.text();
						newPrice = extractPriceFromHtml(crawlerHtml);
					}
				} catch { /* crawler fallback failed, continue */ }
			}

			if (!newPrice) {
				console.warn(`No price found for ${data.productUrl}`);
				return;
			}

			const lastPrice = data.entries[data.entries.length - 1]?.price ?? '';
			const contentRef = db.doc(
				`boards/${data.boardId}/content/${data.contentId}`
			);

			// Check content doc exists before doing any writes
			const contentSnap = await contentRef.get();
			if (!contentSnap.exists) {
				// Product was deleted — clean up orphaned price doc
				await priceDoc.ref.delete();
				return;
			}

			// Numeric comparison avoids false mismatches from formatting
			const newPriceNum = parsePrice(newPrice);
			const lastPriceNum = parsePrice(lastPrice);
			const pricesMatch = !isNaN(newPriceNum) && !isNaN(lastPriceNum) && Math.abs(newPriceNum - lastPriceNum) < 0.01;

			// Always update lastCheckedAt so UI knows the watcher ran
			if (pricesMatch) {
				await contentRef.update({
					lastCheckedPrice: newPrice,
					lastCheckedAt: FieldValue.serverTimestamp()
				});
				return;
			}

			// Price changed — update history and cap entries to prevent unbounded growth
			const currentEntries = (data.entries || []) as { price: string; checkedAt: unknown }[];
			const trimmedEntries = currentEntries.length >= MAX_PRICE_ENTRIES
				? currentEntries.slice(-MAX_PRICE_ENTRIES + 1)
				: currentEntries;
			await priceDoc.ref.update({
				entries: [...trimmedEntries, { price: newPrice, checkedAt: FieldValue.serverTimestamp() }]
			});

			const isPriceDrop = !isNaN(newPriceNum) && !isNaN(lastPriceNum) && newPriceNum < lastPriceNum;

			const contentUpdate: Record<string, unknown> = {
				lastCheckedPrice: newPrice,
				lastCheckedAt: FieldValue.serverTimestamp(),
				priceDrop: isPriceDrop
			};

			// Set originalPrice on first detected drop (so UI shows "Was $X")
			if (isPriceDrop) {
				const existing = contentSnap.data() as { originalPrice?: string; price?: string };
				if (!existing.originalPrice) {
					contentUpdate.originalPrice = existing.price ?? lastPrice;
				}
			}

			await contentRef.update(contentUpdate);

			// If price dropped, notify board members
			if (isPriceDrop) {
				const boardSnap = await db.doc(`boards/${data.boardId}`).get();
				if (!boardSnap.exists) return;
				const board = boardSnap.data() as { name: string; memberIds: string[] };
				const title = (contentSnap.data() as { title: string }).title;

				await notifyBoardMembers(
					data.boardId,
					board.memberIds,
					'Price Drop!',
					`${title} dropped to ${newPrice} on ${board.name}`
				);
			}
		} catch (err) {
			console.warn(`Price check failed for ${data.productUrl}:`, err);
		}
	});
});
