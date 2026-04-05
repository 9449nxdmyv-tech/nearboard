/**
 * @file backfillContentCount.ts
 * @description One-time callable to backfill contentCount on all boards
 *              that don't have the field set. Safe to run multiple times.
 */

import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

export const backfillContentCount = onCall(
	{ region: 'us-central1', timeoutSeconds: 300 },
	async () => {
		const db = getFirestore();
		const boardsSnap = await db.collection('boards').get();
		let updated = 0;

		for (const boardDoc of boardsSnap.docs) {
			const data = boardDoc.data();
			// Skip boards that already have a valid contentCount
			if (typeof data.contentCount === 'number' && data.contentCount > 0) continue;

			const contentSnap = await db
				.collection('boards')
				.doc(boardDoc.id)
				.collection('content')
				.count()
				.get();

			const count = contentSnap.data().count;
			await boardDoc.ref.update({ contentCount: count });
			updated++;
		}

		return { updated, total: boardsSnap.size };
	}
);
