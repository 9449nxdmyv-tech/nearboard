/**
 * @file listBoardContent.ts
 * @description MCP tool: List recent board content.
 */

import { getFirestore } from 'firebase-admin/firestore';

export async function listBoardContent(userId: string, boardId: string, limit: number) {
	const db = getFirestore();
	const snap = await db.collection(`boards/${boardId}/content`)
		.orderBy('createdAt', 'desc').limit(limit).get();
	return { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
}
