/**
 * @file onJoinRequestUpdate.ts
 * @description Firestore trigger that sends a push notification when a join
 *              request is approved.
 */

import '../utils/admin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

export const onJoinRequestUpdate = onDocumentUpdated(
	{ document: 'boards/{boardId}/joinRequests/{requestId}' },
	async (event) => {
		const before = event.data?.before.data();
		const after = event.data?.after.data();
		if (!before || !after) return;

		// Only act on pending → approved transition
		if (before.status !== 'pending' || after.status !== 'approved') return;

		const boardId = event.params.boardId;
		const requesterId = after.requesterId as string;

		const db = getFirestore();

		// Get board name
		const boardSnap = await db.doc(`boards/${boardId}`).get();
		const boardName = boardSnap.data()?.name ?? 'a board';

		// Get requester's FCM tokens
		const tokensSnap = await db.collection(`users/${requesterId}/tokens`).get();
		if (tokensSnap.empty) return;

		const tokens = tokensSnap.docs.map((d) => d.data().token as string).filter(Boolean);
		if (tokens.length === 0) return;

		const messaging = getMessaging();
		await messaging.sendEachForMulticast({
			tokens,
			notification: {
				title: 'Join request approved!',
				body: `Your request to join '${boardName}' was approved!`
			},
			data: {
				type: 'join_request_approved',
				boardId
			}
		});
	}
);
