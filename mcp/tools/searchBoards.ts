/**
 * @file searchBoards.ts
 * @description MCP tool: Search across user's boards by keyword.
 */

import { getFirestore } from 'firebase-admin/firestore';

export async function searchBoards(userId: string, query: string) {
	const db = getFirestore();
	const boardsSnap = await db.collection('boards')
		.where('memberIds', 'array-contains', userId).get();
	const results = boardsSnap.docs
		.filter((d) => {
			const name = (d.data().name as string).toLowerCase();
			return name.includes(query.toLowerCase());
		})
		.map((d) => ({ id: d.id, name: d.data().name }));
	return { boards: results };
}
