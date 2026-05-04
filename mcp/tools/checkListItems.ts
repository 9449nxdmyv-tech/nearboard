/**
 * @file checkListItems.ts
 * @description MCP tool: Mark list items as complete.
 */

import { getFirestore } from 'firebase-admin/firestore';

export async function checkListItems(userId: string, boardId: string, contentId: string, itemIds: string[]) {
	const db = getFirestore();
	const ref = db.doc(`boards/${boardId}/content/${contentId}`);
	const idSet = new Set(itemIds);

	let matched = 0;
	const result = await db.runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return { error: 'Content not found' as const };

		const items = (snap.data()?.items as { id: string; text: string; completed: boolean }[]) ?? [];
		const updated = items.map((item) => {
			if (idSet.has(item.id)) {
				matched++;
				return { ...item, completed: true };
			}
			return item;
		});
		tx.update(ref, { items: updated });
		return { ok: true as const };
	});

	if ('error' in result) return result;
	return { updated: matched };
}
