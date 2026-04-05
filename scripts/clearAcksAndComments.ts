/**
 * @file clearAcksAndComments.ts
 * @description Clears all acknowledgments and comments across every board.
 *              Resets acknowledgments map and commentCount on content docs,
 *              and deletes all comment subcollection documents.
 *
 * Usage:
 *   npx ts-node --project scripts/tsconfig.json scripts/clearAcksAndComments.ts
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var or gcloud auth application-default login
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (getApps().length === 0) {
	initializeApp({ projectId: 'nearboard-app' });
}
const db = getFirestore();

const BATCH_LIMIT = 400; // Firestore batch limit is 500, leave margin

async function main() {
	console.log('Fetching all boards...');
	const boardsSnap = await db.collection('boards').select().get();
	console.log(`Found ${boardsSnap.size} boards.`);

	let totalContentReset = 0;
	let totalCommentsDeleted = 0;

	for (const boardDoc of boardsSnap.docs) {
		const contentSnap = await db
			.collection(`boards/${boardDoc.id}/content`)
			.select('acknowledgments', 'commentCount')
			.get();

		if (contentSnap.empty) continue;

		let batch = db.batch();
		let batchCount = 0;

		for (const contentDoc of contentSnap.docs) {
			const data = contentDoc.data();
			const hasAcks = data.acknowledgments && Object.keys(data.acknowledgments).length > 0;
			const hasComments = (data.commentCount ?? 0) > 0;

			if (hasAcks || hasComments) {
				batch.update(contentDoc.ref, {
					acknowledgments: FieldValue.delete(),
					commentCount: 0
				});
				batchCount++;
				totalContentReset++;

				if (batchCount >= BATCH_LIMIT) {
					await batch.commit();
					batch = db.batch();
					batchCount = 0;
				}
			}

			// Delete all comments in subcollection
			const commentsSnap = await db
				.collection(`boards/${boardDoc.id}/content/${contentDoc.id}/comments`)
				.select()
				.get();

			for (const commentDoc of commentsSnap.docs) {
				batch.delete(commentDoc.ref);
				batchCount++;
				totalCommentsDeleted++;

				if (batchCount >= BATCH_LIMIT) {
					await batch.commit();
					batch = db.batch();
					batchCount = 0;
				}
			}
		}

		if (batchCount > 0) {
			await batch.commit();
		}

		console.log(`  Board ${boardDoc.id}: processed ${contentSnap.size} content docs`);
	}

	console.log(`\nDone! Reset ${totalContentReset} content docs, deleted ${totalCommentsDeleted} comments.`);
}

main().catch(console.error);
