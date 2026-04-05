/**
 * @file share.ts
 * @description Web Share API utility with clipboard fallback.
 */

import type { ContentDoc } from '$lib/types';
import { showToast } from '$lib/stores';

/**
 * Derives a shareable title from the content item.
 */
function getShareTitle(item: ContentDoc): string {
	switch (item.type) {
		case 'note':
			return item.text.slice(0, 80) + (item.text.length > 80 ? '…' : '');
		case 'list':
			return item.title;
		case 'link':
		case 'product':
			return item.title || item.url;
		case 'photo':
			return item.caption || 'Photo';
		case 'video':
			return item.caption || 'Video';
		case 'voice':
			return 'Voice Note';
		case 'poll':
			return item.question;
		case 'location':
			return item.name || item.address || 'Location';
		default:
			return 'Shared from Nearboard';
	}
}

/**
 * Derives the best URL to share for this content item.
 * Link/product cards share the original URL; others share the board URL.
 */
function getShareUrl(item: ContentDoc, boardId: string): string {
	if ((item.type === 'link' || item.type === 'product') && (item as any).url) {
		return (item as any).url;
	}
	return `${window.location.origin}/board/${boardId}`;
}

/**
 * Share a content item via Web Share API (native share sheet on mobile)
 * with clipboard copy as fallback.
 */
export async function shareContent(item: ContentDoc, boardId: string): Promise<void> {
	const title = getShareTitle(item);
	const url = getShareUrl(item, boardId);
	const text = `${title}`;

	if (navigator.share) {
		try {
			await navigator.share({ title, text, url });
			return;
		} catch (err) {
			// User cancelled share — not an error
			if ((err as DOMException)?.name === 'AbortError') return;
		}
	}

	// Fallback: copy URL to clipboard
	try {
		await navigator.clipboard.writeText(url);
		showToast('Link copied to clipboard', 'success');
	} catch {
		showToast('Could not share', 'error');
	}
}
