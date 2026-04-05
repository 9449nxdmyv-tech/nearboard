/**
 * @file getBoardBriefing.ts
 * @description MCP tool: Get the latest AI briefing for a board.
 */

import { getFirestore } from 'firebase-admin/firestore';

export async function getBoardBriefing(userId: string, boardId: string) {
	const db = getFirestore();
	const snap = await db.collection(`boards/${boardId}/briefings`)
		.orderBy('generatedAt', 'desc').limit(1).get();
	if (snap.empty) return { briefing: null };
	return { briefing: { id: snap.docs[0].id, ...snap.docs[0].data() } };
}
