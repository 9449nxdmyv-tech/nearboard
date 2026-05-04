/**
 * @file onUserDelete.ts
 * @description Firestore trigger that cleans up all user-associated data when a
 *              user document is deleted (account deletion flow).
 *              - Deletes all boards the user owns (cascades via onBoardDelete trigger)
 *              - Removes member docs from boards the user joined
 *              - Deletes user subcollections (tokens, readState)
 *              - Deletes templates created by the user
 *              - Deletes avatar from Storage
 */

import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';

const BATCH_SIZE = 100;

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

export const onUserDelete = onDocumentDeleted({ document: 'users/{userId}' }, async (event) => {
	const userId = event.params.userId;
	const db = getFirestore();

	// 1. Delete all boards owned by this user (triggers onBoardDelete for cascade cleanup)
	const ownedBoards = await db.collection('boards').where('ownerId', '==', userId).get();
	for (const boardDoc of ownedBoards.docs) {
		await boardDoc.ref.delete();
	}

	// 2. Remove member doc from boards the user joined (but didn't own).
	// Skip owned boards — they were deleted in step 1 and the cascade trigger
	// handles their members; trying to update them here would race with deletion.
	const allBoards = await db.collection('boards').where('memberIds', 'array-contains', userId).get();
	for (const boardDoc of allBoards.docs) {
		if (boardDoc.data().ownerId === userId) continue;
		const memberRef = db.doc(`boards/${boardDoc.id}/members/${userId}`);
		const memberSnap = await memberRef.get();
		if (memberSnap.exists) {
			await memberRef.delete();
		}
		// Remove userId from memberIds array
		await boardDoc.ref.update({
			memberIds: (boardDoc.data().memberIds as string[]).filter((id: string) => id !== userId)
		});
	}

	// 3. Delete user subcollections
	await deleteCollection(db, `users/${userId}/tokens`);
	await deleteCollection(db, `users/${userId}/readState`);
	await deleteCollection(db, `users/${userId}/memories`);

	// 4. Delete templates created by this user (chunked to stay under the
	// 500-op write batch limit if a creator made many templates).
	const templates = await db.collection('templates').where('creatorId', '==', userId).get();
	for (let i = 0; i < templates.docs.length; i += BATCH_SIZE) {
		const batch = db.batch();
		for (const tmpl of templates.docs.slice(i, i + BATCH_SIZE)) {
			batch.delete(tmpl.ref);
		}
		await batch.commit();
	}

	// 5. Delete avatar from Storage
	try {
		const bucket = getStorage().bucket();
		const [files] = await bucket.getFiles({ prefix: `users/${userId}/` });
		await Promise.all(files.map((file) => file.delete()));
	} catch {
		// Storage cleanup is best-effort — file may not exist
	}
});
