/**
 * @file createBoard.ts
 * @description MCP tool: Create a new board.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export async function createBoard(
	userId: string,
	name: string,
	template: string,
	displayName: string = '',
	photoURL: string | null = null
) {
	const db = getFirestore();
	const ref = await db.collection('boards').add({
		name, ownerId: userId, memberIds: [userId],
		isPublic: false, template, streak: 0,
		lastActivityAt: FieldValue.serverTimestamp(),
		createdAt: FieldValue.serverTimestamp(),
		enableLivingSummary: true,
		summaryStyle: 'paragraph',
		allowComments: true
	});
	await db.doc(`boards/${ref.id}/members/${userId}`).set({
		userId,
		displayName,
		photoURL,
		role: 'owner',
		joinedAt: FieldValue.serverTimestamp(),
		notificationMode: 'ping',
		lastReadAt: null
	});
	return { boardId: ref.id };
}
