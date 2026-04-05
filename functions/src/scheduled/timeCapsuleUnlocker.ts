/**
 * @file timeCapsuleUnlocker.ts
 * @description Daily scheduled function that checks for boards past their
 *              time capsule unlock date and unlocks them, notifying all members
 *              with a preview of the capsule contents.
 */

import '../utils/admin.js';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { notifyBoardMembers } from '../utils/fcmService.js';

/**
 * Counts content types in a board and returns a human-readable preview string.
 * e.g. "3 notes, 2 photos, 1 voice memo"
 */
async function buildContentPreview(
	db: FirebaseFirestore.Firestore,
	boardId: string
): Promise<string> {
	const contentSnap = await db
		.collection(`boards/${boardId}/content`)
		.get();

	if (contentSnap.empty) return 'an empty capsule';

	const counts: Record<string, number> = {};
	for (const doc of contentSnap.docs) {
		const type = (doc.data().type as string) || 'item';
		counts[type] = (counts[type] || 0) + 1;
	}

	// Map internal type names to friendly labels
	const labelMap: Record<string, string> = {
		note: 'note',
		list: 'list',
		link: 'link',
		product: 'product',
		photo: 'photo',
		video: 'video',
		voice: 'voice memo',
		poll: 'poll',
		location: 'location'
	};

	const parts: string[] = [];
	for (const [type, count] of Object.entries(counts)) {
		const label = labelMap[type] || type;
		const plural = count === 1 ? label : `${label}s`;
		parts.push(`${count} ${plural}`);
	}

	return parts.join(', ');
}

export const timeCapsuleUnlocker = onSchedule('every day 00:00', async () => {
	const db = getFirestore();
	const now = Timestamp.now();

	const snap = await db
		.collection('boards')
		.where('timeCapsuleLocked', '==', true)
		.where('timeCapsuleUnlockAt', '<=', now)
		.get();

	for (const doc of snap.docs) {
		await doc.ref.update({
			timeCapsuleLocked: false,
			timeCapsuleUnlockAt: null
		});

		const boardName = doc.data().name as string;
		const memberIds = doc.data().memberIds as string[];

		// Build a preview of what's inside the capsule
		const preview = await buildContentPreview(db, doc.id);

		await notifyBoardMembers(
			doc.id,
			memberIds,
			'Time Capsule Unlocked!',
			`Your board "${boardName}" has been unlocked! Inside: ${preview}. Take a trip down memory lane!`
		);
	}
});
