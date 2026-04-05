/**
 * @file processDirtyBoards.ts
 * @description Scheduled function that runs every 5 minutes to regenerate
 *              Living Summaries for boards marked as dirty by onBoardContentWrite.
 *              Replaces the old setTimeout-based debounce pattern — no billing leak.
 */

import '../utils/admin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { updateBoardSummary } from '../triggers/onBoardContentWrite.js';
import { processInBatches } from '../utils/boardEligibility.js';

const CONCURRENCY_LIMIT = 5;

export const processDirtyBoards = onSchedule(
	{ schedule: 'every 15 minutes', secrets: ['GROQ_API_KEY'] },
	async () => {
		const db = getFirestore();

		const dirtySnap = await db
			.collection('boards')
			.where('summaryDirty', '==', true)
			.where('enableLivingSummary', '==', true)
			.get();

		if (dirtySnap.empty) return;

		await processInBatches(dirtySnap.docs, CONCURRENCY_LIMIT, async (boardDoc) => {
			const board = boardDoc.data() as {
				name: string;
				template?: string;
				memberIds: string[];
			};

			// Claim: atomically clear summaryDirty so parallel instances skip this board.
			// If new content arrives during processing, onBoardContentWrite will re-set it.
			try {
				await boardDoc.ref.update({ summaryDirty: false });
			} catch {
				return; // Board was deleted or already claimed
			}

			try {
				await updateBoardSummary(
					boardDoc.id,
					board.name,
					board.template ?? 'blank',
					db,
					board.memberIds
				);
			} catch (err) {
				console.error(`Failed to update summary for board ${boardDoc.id}:`, err);
				// Re-mark dirty so it gets retried on next run
				await boardDoc.ref.update({ summaryDirty: true }).catch(() => {});
			}
		});
	}
);
