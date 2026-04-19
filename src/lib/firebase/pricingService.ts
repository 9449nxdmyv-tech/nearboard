/**
 * @file pricingService.ts
 * @description Product price tracking operations. Stores original price on save,
 *              registers product for price watching. All price logic lives here.
 */

import { doc, setDoc, getDoc, serverTimestamp, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from './app';
import { extractMetadata } from '$lib/api';
import { updateContent } from './boardService';

/**
 * Parses a price string into a numeric value, handling international formats.
 * Supports: "$1,299.99", "€1.299,99", "1 299,99 kr", "¥12800"
 */
function parsePrice(priceStr: string): number {
	let cleaned = priceStr.replace(/[^\d.,]/g, '');
	if (!cleaned) return NaN;

	const lastComma = cleaned.lastIndexOf(',');
	const lastDot = cleaned.lastIndexOf('.');

	if (lastComma > lastDot) {
		cleaned = cleaned.replace(/\./g, '').replace(',', '.');
	} else {
		cleaned = cleaned.replace(/,/g, '');
	}

	return parseFloat(cleaned);
}

/**
 * Registers a product for price tracking. Called when a product card is saved.
 * Creates a PriceHistoryDoc at /prices/{encodedUrl}.
 */
export async function registerProductForTracking(
	productUrl: string,
	boardId: string,
	contentId: string,
	currentPrice: string
): Promise<void> {
	const docId = encodeURIComponent(productUrl).slice(0, 1500);
	await setDoc(doc(db(), 'prices', docId), {
		productUrl,
		boardId,
		contentId,
		entries: currentPrice
			? [{ price: currentPrice, checkedAt: serverTimestamp() }]
			: [],
		priceDrop: false,
		lastCheckedAt: serverTimestamp()
	});
}

/**
 * Manually refreshes the price of a product by re-scraping the URL.
 * Updates both the content doc and the price history.
 */
export async function refreshProductPrice(
	boardId: string,
	contentId: string,
	productUrl: string,
	lastPrice: string
): Promise<{ newPrice: string | null; error?: string }> {
	try {
		const meta = await extractMetadata(productUrl, { skipCache: true });
		if (!meta.price) {
			return { newPrice: null, error: 'Could not detect price' };
		}

		const newPrice = meta.price;

		// Numeric comparison to avoid false mismatches from formatting differences
		const lastNum = parsePrice(lastPrice);
		const newNum = parsePrice(newPrice);
		const pricesMatch = !isNaN(lastNum) && !isNaN(newNum) && Math.abs(newNum - lastNum) < 0.01;

		if (pricesMatch) {
			await updateContent(boardId, contentId, {
				lastCheckedPrice: newPrice,
				lastCheckedAt: serverTimestamp()
			});
			return { newPrice };
		}

		const isPriceDrop = !isNaN(lastNum) && !isNaN(newNum) && newNum < lastNum;

		const updates: Record<string, unknown> = {
			lastCheckedPrice: newPrice,
			priceDrop: isPriceDrop,
			lastCheckedAt: serverTimestamp()
		};

		// Set originalPrice on first detected drop (only if lastPrice is a real price)
		if (isPriceDrop && lastPrice) {
			updates.originalPrice = lastPrice;
		}

		await updateContent(boardId, contentId, updates);

		// Update history
		const docId = encodeURIComponent(productUrl).slice(0, 1500);
		await updateDoc(doc(db(), 'prices', docId), {
			entries: arrayUnion({
				price: newPrice,
				checkedAt: serverTimestamp()
			})
		});

		return { newPrice };
	} catch (err) {
		console.error('Failed to refresh price:', err);
		return { newPrice: null, error: 'Refresh failed' };
	}
}

export { parsePrice };

/**
 * Fetches the price history entries for a product URL.
 * Returns numeric price points and their timestamps for charting.
 */
export async function getPriceHistory(
	productUrl: string
): Promise<{ price: number; raw: string; checkedAt: Date }[]> {
	try {
		const docId = encodeURIComponent(productUrl).slice(0, 1500);
		const snap = await getDoc(doc(db(), 'prices', docId));
		if (!snap.exists()) return [];

		const data = snap.data() as { 
			entries?: { price: string; checkedAt: any }[] 
		};
		if (!data.entries?.length) return [];

		return data.entries
			.map((e) => ({
				price: parsePrice(e.price),
				raw: e.price,
				checkedAt: e.checkedAt?.toDate?.() ?? null
			}))
			.filter((e): e is { price: number; raw: string; checkedAt: Date } =>
				!isNaN(e.price) && e.checkedAt !== null
			)
			.sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
	} catch {
		return [];
	}
}
