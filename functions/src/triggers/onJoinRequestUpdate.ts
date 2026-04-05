/**
 * @file onJoinRequestUpdate.ts
 * @description Firestore trigger that sends push notifications when a join
 *              request is approved or rejected. Uses data-only messages
 *              consistent with all other notification triggers.
 */

import '../utils/admin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging, type BatchResponse } from 'firebase-admin/messaging';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

const ANDROID_CHANNEL_ID = 'nearboard_default';

export const onJoinRequestUpdate = onDocumentUpdated(
	{ document: 'boards/{boardId}/joinRequests/{requestId}' },
	async (event) => {
		const before = event.data?.before.data();
		const after = event.data?.after.data();
		if (!before || !after) return;

		// Only act on pending → approved or pending → rejected
		if (before.status !== 'pending') return;
		if (after.status !== 'approved' && after.status !== 'rejected') return;

		const boardId = event.params.boardId;
		const requesterId = after.requesterId as string;
		const approved = after.status === 'approved';

		const db = getFirestore();

		// Get board name
		const boardSnap = await db.doc(`boards/${boardId}`).get();
		const boardName = boardSnap.data()?.name ?? 'a board';

		// Get requester's FCM tokens
		const tokensSnap = await db.collection(`users/${requesterId}/tokens`).get();
		if (tokensSnap.empty) return;

		const tokens = tokensSnap.docs.map((d) => d.data().token as string).filter(Boolean);
		if (tokens.length === 0) return;

		const title = approved ? 'Join request approved!' : 'Join request declined';
		const body = approved
			? `Your request to join '${boardName}' was approved!`
			: `Your request to join '${boardName}' was declined.`;

		const messaging = getMessaging();
		const response = await messaging.sendEachForMulticast({
			tokens,
			data: {
				type: approved ? 'join_request_approved' : 'join_request_rejected',
				boardId,
				title,
				body
			},
			android: {
				priority: 'high',
				notification: {
					channelId: ANDROID_CHANNEL_ID,
					title,
					body,
					icon: 'ic_notification',
					tag: `nearboard-join-${boardId}`
				}
			},
			apns: {
				payload: {
					aps: {
						alert: { title, body },
						sound: 'default',
						badge: 1,
						'mutable-content': 1
					}
				},
				headers: { 'apns-collapse-id': `nearboard-join-${boardId}` }
			},
			webpush: {
				headers: { Urgency: 'high' }
			}
		});

		// Clean up stale tokens
		const batch = db.batch();
		let hasDeletes = false;
		for (let i = 0; i < response.responses.length; i++) {
			const result = response.responses[i];
			if (
				result.error &&
				(result.error.code === 'messaging/registration-token-not-registered' ||
					result.error.code === 'messaging/invalid-registration-token')
			) {
				const tokenSnap = await db
					.collectionGroup('tokens')
					.where('token', '==', tokens[i])
					.get();
				for (const doc of tokenSnap.docs) {
					batch.delete(doc.ref);
					hasDeletes = true;
				}
			}
		}
		if (hasDeletes) await batch.commit();
	}
);
