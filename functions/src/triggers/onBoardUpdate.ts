/**
 * @file onBoardUpdate.ts
 * @description Firestore trigger that fires on board document updates.
 *              Handles manual Living Summary regeneration requests.
 */

import '../utils/admin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { updateBoardSummary } from './onBoardContentWrite.js';

export const onBoardUpdate = onDocumentUpdated(
	{ document: 'boards/{boardId}', secrets: ['GROQ_API_KEY'] },
	async (event) => {
		const boardId = event.params.boardId;
		const db = getFirestore();

		const before = event.data?.before?.data();
		const after = event.data?.after?.data();

		if (!before || !after) return;

		// Check if manual regeneration was requested
		const regenRequestedBefore = before.lastRegenerationRequestedAt?.toMillis() ?? 0;
		const regenRequestedAfter = after.lastRegenerationRequestedAt?.toMillis() ?? 0;

		if (regenRequestedAfter > regenRequestedBefore) {
			console.log(`Manual regeneration requested for board ${boardId}`);
			await updateBoardSummary(boardId, after.name, after.template ?? 'blank', db, after.memberIds, true);
		}
	}
);
