/**
 * @file onContentModeration.ts
 * @description Firestore trigger that scans new content for harmful material.
 *              Runs on content creation — quarantines obviously harmful text content
 *              and scans images via Cloud Vision SafeSearch API.
 *
 *              Uses keyword-based scanning for text and Cloud Vision SafeSearch
 *              for photo content. Video moderation requires Video Intelligence API.
 */

import '../utils/admin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { logger } from 'firebase-functions';

const visionClient = new ImageAnnotatorClient();

/**
 * Blocked patterns — obvious slurs, threats, spam indicators.
 * This is a minimal blocklist. Production should use a moderation API
 * (e.g. Google Perspective API, OpenAI moderation, or Hive).
 */
const BLOCKED_PATTERNS = [
	// Spam / phishing indicators
	/\b(click here|act now|limited time|buy now|free money)\b/i,
	// Common threat language
	/\b(kill|bomb|shoot|attack)\s+(you|them|everyone|people)\b/i
];

/** SafeSearch likelihoods that trigger quarantine. */
const FLAGGED_LIKELIHOODS = ['LIKELY', 'VERY_LIKELY'];

/**
 * Extracts text content from a content document for scanning.
 */
function extractText(data: Record<string, unknown>): string {
	const parts: string[] = [];
	if (data.text) parts.push(String(data.text));
	if (data.title) parts.push(String(data.title));
	if (data.caption) parts.push(String(data.caption));
	if (data.question) parts.push(String(data.question));
	if (Array.isArray(data.items)) {
		for (const item of data.items) {
			if (typeof item === 'object' && item && 'text' in item) {
				parts.push(String((item as { text: string }).text));
			}
		}
	}
	if (Array.isArray(data.options)) {
		for (const opt of data.options) {
			if (typeof opt === 'object' && opt && 'text' in opt) {
				parts.push(String((opt as { text: string }).text));
			}
		}
	}
	return parts.join(' ');
}

/**
 * Checks if text matches any blocked patterns.
 */
function isTextFlagged(text: string): boolean {
	return BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Checks a single image URL against Cloud Vision SafeSearch.
 * Returns true if the image is flagged for adult, violence, or racy content.
 */
async function isImageFlagged(imageUrl: string): Promise<boolean> {
	try {
		const [result] = await visionClient.safeSearchDetection(imageUrl);
		const safeSearch = result.safeSearchAnnotation;
		if (!safeSearch) return false;

		const { adult, violence, racy } = safeSearch;

		if (
			FLAGGED_LIKELIHOODS.includes(adult as string) ||
			FLAGGED_LIKELIHOODS.includes(violence as string) ||
			FLAGGED_LIKELIHOODS.includes(racy as string)
		) {
			logger.warn('SafeSearch flagged image', {
				imageUrl,
				adult,
				violence,
				racy
			});
			return true;
		}

		return false;
	} catch (err) {
		logger.error('Cloud Vision SafeSearch failed for image', {
			imageUrl,
			error: err instanceof Error ? err.message : String(err)
		});
		// Don't quarantine on API errors — fail open to avoid blocking legitimate content
		return false;
	}
}

/**
 * Scans all images in a photo content document.
 * Returns true if any image is flagged.
 */
async function arePhotoImagesFlagged(data: Record<string, unknown>): Promise<boolean> {
	const images = data.images as Array<{ url: string }> | undefined;
	if (!images || images.length === 0) return false;

	const results = await Promise.all(images.map((img) => isImageFlagged(img.url)));
	return results.some(Boolean);
}

export const onContentModeration = onDocumentCreated(
	{ document: 'boards/{boardId}/content/{contentId}' },
	async (event) => {
		const data = event.data?.data();
		if (!data) return;

		const boardId = event.params.boardId;
		const contentId = event.params.contentId;
		const db = getFirestore();
		const contentRef = db.doc(`boards/${boardId}/content/${contentId}`);

		// Check if the board is public — public boards get stricter moderation
		const boardSnap = await db.doc(`boards/${boardId}`).get();
		const isPublic = boardSnap.data()?.isPublic === true;

		const text = extractText(data);
		const type = data.type as string;

		let shouldQuarantine = false;

		// Text-based moderation
		if (text && isTextFlagged(text)) {
			shouldQuarantine = true;
		}

		// Image moderation via Cloud Vision SafeSearch
		if (type === 'photo') {
			try {
				if (await arePhotoImagesFlagged(data)) {
					shouldQuarantine = true;
				}
			} catch (err) {
				logger.error('Photo moderation failed', {
					boardId,
					contentId,
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}

		// TODO: HIGH FEATURE Integrate Video Intelligence API for video frame analysis.
		// For now, flag video on public boards as pending for manual review.
		if (type === 'video') {
			// Check thumbnail if available
			const thumbnailUrl = data.thumbnailUrl as string | null;
			if (thumbnailUrl) {
				try {
					if (await isImageFlagged(thumbnailUrl)) {
						shouldQuarantine = true;
					}
				} catch (err) {
					logger.error('Video thumbnail moderation failed', {
						boardId,
						contentId,
						error: err instanceof Error ? err.message : String(err)
					});
				}
			}

			// On public boards, if not already quarantined, mark as pending for manual review
			if (isPublic && !shouldQuarantine) {
				await contentRef.update({ moderationStatus: 'pending' });
				return;
			}
		}

		if (shouldQuarantine) {
			await contentRef.update({ moderationStatus: 'quarantined' });
		}
	}
);
