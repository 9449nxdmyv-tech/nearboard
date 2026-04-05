/**
 * @file getAllBoards.ts
 * @description MCP tool: Get all boards the user belongs to.
 */

import { getFirestore } from 'firebase-admin/firestore';

export async function getAllBoards(userId: string) {
	const db = getFirestore();
	const snap = await db.collection('boards')
		.where('memberIds', 'array-contains', userId).get();
	return {
		boards: snap.docs.map((d) => ({
			id: d.id,
			name: d.data().name,
			template: d.data().template,
			memberCount: (d.data().memberIds as string[]).length,
			streak: d.data().streak
		}))
	};
}
