/**
 * @file onBoardDelete.ts
 * @description Firestore trigger that cleans up all subcollections when a board
 *              document is deleted. Firestore does not cascade deletes automatically.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';

const SUBCOLLECTIONS = ['members', 'content', 'briefings', 'assistant', 'wrapped', 'joinRequests'];
const BATCH_SIZE = 100;

/**
 * Deletes all documents in a collection in batches.
 */
async function deleteCollection(db: FirebaseFirestore.Firestore, path: string): Promise<void> {
	const colRef = db.collection(path);
	let snapshot = await colRef.limit(BATCH_SIZE).get();

	while (!snapshot.empty) {
		const batch = db.batch();
		for (const doc of snapshot.docs) {
			batch.delete(doc.ref);
		}
		await batch.commit();
		snapshot = await colRef.limit(BATCH_SIZE).get();
	}
}

export const onBoardDelete = onDocumentDeleted({ document: 'boards/{boardId}' }, async (event) => {
	const boardId = event.params.boardId;
	const db = getFirestore();

	// Also delete votes subcollections within content docs
	const contentSnap = await db.collection(`boards/${boardId}/content`).get();
	for (const contentDoc of contentSnap.docs) {
		await deleteCollection(db, `boards/${boardId}/content/${contentDoc.id}/votes`);
	}

	// Delete all top-level subcollections
	await Promise.all(
		SUBCOLLECTIONS.map((sub) => deleteCollection(db, `boards/${boardId}/${sub}`))
	);
});
