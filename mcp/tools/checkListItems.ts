/**
 * @file checkListItems.ts
 * @description MCP tool: Mark list items as complete.
 */

import { getFirestore } from 'firebase-admin/firestore';

export async function checkListItems(userId: string, boardId: string, contentId: string, itemIds: string[]) {
	const db = getFirestore();
	const ref = db.doc(`boards/${boardId}/content/${contentId}`);
	const snap = await ref.get();
	if (!snap.exists) return { error: 'Content not found' };

	const items = (snap.data()?.items as { id: string; text: string; completed: boolean }[]) ?? [];
	const updated = items.map((item) =>
		itemIds.includes(item.id) ? { ...item, completed: true } : item
	);
	await ref.update({ items: updated });
	return { updated: itemIds.length };
}
