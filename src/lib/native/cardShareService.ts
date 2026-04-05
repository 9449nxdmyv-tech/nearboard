/**
 * @file cardShareService.ts
 * @description Per-card share logic: generates share payloads, WhatsApp/SMS deep links,
 *              and clipboard copy. Used by ShareSheet and native share sheet.
 */

import { browser } from '$app/environment';
import type { ContentDoc } from '$lib/types';

export interface CardShareData {
	title: string;
	text: string;
	url?: string;
}

const BASE_URL = browser ? window.location.origin : '';

/**
 * Builds a share payload for a single content card.
 * For private boards, no URL is included — text only.
 */
export function getCardShareData(
	item: ContentDoc,
	boardId: string,
	isPublic: boolean
): CardShareData {
	const url = isPublic ? `${BASE_URL}/b/${boardId}/${item.id}` : undefined;
	const by = item.authorName ? ` — ${item.authorName}` : '';

	switch (item.type) {
		case 'note':
			return { title: 'Note from Nearboard', text: `${item.text}${by}`, url };
		case 'list':
			return {
				title: item.title || 'List from Nearboard',
				text: `${item.title}${by}\n${(item.items ?? []).map((i) => `• ${i.text}`).join('\n')}`,
				url
			};
		case 'link':
			return { title: item.title || 'Link from Nearboard', text: `${item.title}${by}\n${item.url}`, url };
		case 'product':
			return {
				title: item.title || 'Product from Nearboard',
				text: `${item.title} — ${item.price}${by}`,
				url
			};
		case 'voice':
			return { title: 'Voice note from Nearboard', text: `Voice note${by}`, url };
		case 'photo':
			return { title: 'Photo from Nearboard', text: `${item.caption || 'Photo'}${by}`, url };
		case 'video':
			return { title: 'Video from Nearboard', text: `${item.caption || 'Video'}${by}`, url };
		case 'location':
			return {
				title: item.name || 'Location from Nearboard',
				text: `${item.name ? `${item.name} — ` : ''}${item.address}${by}`,
				url
			};
		case 'poll':
			return { title: 'Poll from Nearboard', text: `${item.question}${by}`, url };
		default:
			return { title: 'From Nearboard', text: `Shared from Nearboard${by}`, url };
	}
}

/** Opens WhatsApp with pre-filled message. */
export function shareCardToWhatsApp(text: string, url?: string): void {
	const message = url ? `${text}\n${url}` : text;
	window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
}

/** Opens SMS/Messages with pre-filled body. */
export function shareCardToSMS(text: string, url?: string): void {
	const body = url ? `${text}\n${url}` : text;
	// iOS uses &body=, Android uses ?body= — sms:?& works on both
	window.open(`sms:?&body=${encodeURIComponent(body)}`);
}

/** Copies URL (or text if no URL) to clipboard. */
export async function copyCardLink(url?: string, text?: string): Promise<void> {
	const content = url || text || '';
	if (!content) return;

	if (navigator.clipboard) {
		await navigator.clipboard.writeText(content);
	}
}
