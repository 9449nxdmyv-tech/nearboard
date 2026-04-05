/**
 * @file moderationService.ts
 * @description Content moderation operations. Provides methods to quarantine,
 *              approve, and check moderation status of content items.
 *              All moderation ops go through this module — never from components.
 */

import { doc, updateDoc, query, collection, where, getDocs, limit } from 'firebase/firestore';
import { db } from './app';
import type { ModerationStatus, ContentDoc } from '$lib/types';

/**
 * Updates the moderation status of a content item.
 * Used by board owners to approve or quarantine content.
 */
export async function setModerationStatus(
	boardId: string,
	contentId: string,
	status: ModerationStatus
): Promise<void> {
	await updateDoc(doc(db(), 'boards', boardId, 'content', contentId), {
		moderationStatus: status
	});
}

/**
 * Fetches all quarantined content in a board (for owner review).
 */
export async function getQuarantinedContent(boardId: string): Promise<ContentDoc[]> {
	const q = query(
		collection(db(), 'boards', boardId, 'content'),
		where('moderationStatus', '==', 'quarantined'),
		limit(50)
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ContentDoc);
}

/**
 * Checks if content should be visible. Quarantined content is hidden
 * from non-owners.
 */
export function isContentVisible(item: ContentDoc, isOwner: boolean): boolean {
	if (!item.moderationStatus || item.moderationStatus === 'approved') return true;
	if (item.moderationStatus === 'pending') return true;
	// Quarantined: only visible to board owner for review
	return isOwner;
}
