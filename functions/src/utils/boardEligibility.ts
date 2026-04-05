/**
 * @file boardEligibility.ts
 * @description Shared logic for finding boards eligible for scheduled processing
 *              based on member timezone. Used by morningDigest and smartReminders.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { isAroundHour } from './timezone.js';

interface EligibilityOptions {
	/** How far back to look for board activity (default: 24h) */
	activityWindowMs?: number;
	/** Target local hour for members (e.g. 8 for ~8am) */
	targetHour: number;
}

/**
 * Finds boards with recent activity where at least one member's local time
 * is approximately the target hour. User docs are batch-fetched to avoid N+1.
 *
 * Returns the eligible board document snapshots.
 */
export async function getEligibleBoards(
	options: EligibilityOptions
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
	const { activityWindowMs = 24 * 60 * 60 * 1000, targetHour } = options;
	const db = getFirestore();
	const cutoff = Timestamp.fromDate(new Date(Date.now() - activityWindowMs));

	const boardsSnap = await db
		.collection('boards')
		.where('lastActivityAt', '>=', cutoff)
		.get();

	// Collect all unique member UIDs across all boards, then batch-fetch user docs
	const allMemberIds = new Set<string>();
	const boardMemberMap = new Map<string, string[]>();

	for (const boardDoc of boardsSnap.docs) {
		const board = boardDoc.data() as { memberIds: string[] };
		if (!board.memberIds || board.memberIds.length === 0) continue;
		boardMemberMap.set(boardDoc.id, board.memberIds);
		for (const uid of board.memberIds) {
			allMemberIds.add(uid);
		}
	}

	// Batch-fetch all user docs at once (avoids N+1 per-board fetching)
	const userDocRefs = [...allMemberIds].map((uid) => db.doc(`users/${uid}`));
	const userSnapshots = userDocRefs.length > 0 ? await db.getAll(...userDocRefs) : [];
	const userTimezoneMap = new Map<string, string>();
	for (const snap of userSnapshots) {
		if (snap.exists) {
			const timezone = (snap.data()?.timezone as string) || 'UTC';
			userTimezoneMap.set(snap.id, timezone);
		}
	}

	// Filter to boards where at least one member's local time is near targetHour
	const eligible: FirebaseFirestore.QueryDocumentSnapshot[] = [];

	for (const boardDoc of boardsSnap.docs) {
		const memberIds = boardMemberMap.get(boardDoc.id);
		if (!memberIds) continue;

		const anyMemberAtHour = memberIds.some((uid) => {
			const timezone = userTimezoneMap.get(uid) || 'UTC';
			return isAroundHour(timezone, targetHour);
		});

		if (anyMemberAtHour) {
			eligible.push(boardDoc);
		}
	}

	return eligible;
}

/**
 * Processes items in batches with a concurrency limit.
 */
export async function processInBatches<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>
): Promise<void> {
	for (let i = 0; i < items.length; i += limit) {
		const batch = items.slice(i, i + limit);
		await Promise.allSettled(batch.map(fn));
	}
}
