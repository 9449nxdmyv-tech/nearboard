/**
 * @file onCommentWrite.ts
 * @description Firestore trigger that fires on comment writes.
 *              Updates comment count on parent content document and
 *              sends push notifications to:
 *              1. @mentioned board members
 *              2. Content author (if not the commenter)
 *              3. Previous commenters on the same content (if not the commenter)
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

			const data = event.data!.after!.data()!;
			const commentAuthorId: string = data.authorId;
			const authorName: string = data.authorName ?? 'Someone';
			const mentions: string[] = data.mentions ?? [];

			// Collect all UIDs to notify (deduplicated, excluding the comment author)
			const notifyUids = new Set<string>();

			// 1. Content author — notify if not the commenter
			const contentSnap = await contentRef.get();
			const contentAuthorId = contentSnap.data()?.authorId as string | undefined;
			if (contentAuthorId && contentAuthorId !== commentAuthorId) {
				notifyUids.add(contentAuthorId);
			}

			// 2. Previous commenters on this content
			const commentsSnap = await db
				.collection(`boards/${boardId}/content/${contentId}/comments`)
				.orderBy('createdAt', 'desc')
				.limit(50)
				.get();

			for (const commentDoc of commentsSnap.docs) {
				const uid = commentDoc.data().authorId as string;
				if (uid && uid !== commentAuthorId) {
					notifyUids.add(uid);
				}
			}

			// 3. @mentioned members — resolve display names to UIDs
			if (mentions.length > 0) {
				const membersSnap = await db
					.collection(`boards/${boardId}/members`)
					.get();

				for (const memberDoc of membersSnap.docs) {
					const memberName: string = memberDoc.data().displayName ?? '';
					const isMentioned = mentions.some(
						(m) => memberName.toLowerCase() === m.toLowerCase()
					);
					if (isMentioned && memberDoc.id !== commentAuthorId) {
						notifyUids.add(memberDoc.id);
					}
				}
			}

			// Send notification to all collected UIDs
			if (notifyUids.size > 0) {
				// Choose appropriate message based on who's being notified
				const hasMentions = mentions.length > 0;
				const title = hasMentions ? 'New comment mention' : 'New comment';
				const body = hasMentions
					? `${authorName} mentioned you in a comment`
					: `${authorName} commented on a post`;

				await notifyBoardMembers(
					boardId,
					Array.from(notifyUids),
					title,
					body
				);
			}
		} else if (before && !after) {
			// Deleted
			await contentRef.update({
				commentCount: FieldValue.increment(-1)
			});
		}
	}
);
