/**
 * @file onCommentWrite.ts
 * @description Firestore trigger that fires on comment writes.
 *              Updates comment count on parent content document and
 *              sends push notifications to @mentioned board members.
 */

import '../utils/admin.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { notifyBoardMembers } from '../utils/fcmService.js';

export const onCommentWrite = onDocumentWritten(
	{ document: 'boards/{boardId}/content/{contentId}/comments/{commentId}' },
	async (event) => {
		const { boardId, contentId } = event.params;
		const db = getFirestore();

		const before = event.data?.before?.exists;
		const after = event.data?.after?.exists;

		const contentRef = db.doc(`boards/${boardId}/content/${contentId}`);

		if (!before && after) {
			// Created
			await contentRef.update({
				commentCount: FieldValue.increment(1),
				lastActivityAt: FieldValue.serverTimestamp()
			});

			// Notify @mentioned members
			const data = event.data!.after!.data()!;
			const mentions: string[] = data.mentions ?? [];
			if (mentions.length > 0) {
				// Resolve mentioned display names to member UIDs
				const membersSnap = await db
					.collection(`boards/${boardId}/members`)
					.get();

				const mentionedIds = membersSnap.docs
					.filter((doc) => {
						const memberName: string = doc.data().displayName ?? '';
						return mentions.some(
							(m) => memberName.toLowerCase() === m.toLowerCase()
						);
					})
					.map((doc) => doc.id)
					// Don't notify the comment author about their own mention
					.filter((id) => id !== data.authorId);

				if (mentionedIds.length > 0) {
					const authorName: string = data.authorName ?? 'Someone';
					await notifyBoardMembers(
						boardId,
						mentionedIds,
						'You were mentioned',
						`${authorName} mentioned you in a comment`
					);
				}
			}
		} else if (before && !after) {
			// Deleted
			await contentRef.update({
				commentCount: FieldValue.increment(-1)
			});
		}
	}
);
