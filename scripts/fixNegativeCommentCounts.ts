/**
 * @file fixNegativeCommentCounts.ts
 * @description One-shot script to fix negative commentCount values across all boards.
 *
 * Usage:
 *   npx ts-node --project scripts/tsconfig.json scripts/fixNegativeCommentCounts.ts
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
	initializeApp({ projectId: 'nearboard-app' });
}
const db = getFirestore();

async function main() {
	const boardsSnap = await db.collection('boards').select().get();
	let fixed = 0;

	for (const boardDoc of boardsSnap.docs) {
		const contentSnap = await db
			.collection(`boards/${boardDoc.id}/content`)
			.where('commentCount', '<', 0)
			.get();

		for (const contentDoc of contentSnap.docs) {
			await contentDoc.ref.update({ commentCount: 0 });
			fixed++;
		}
	}

	console.log(`Fixed ${fixed} content docs with negative commentCount.`);
}

main().catch(console.error);
