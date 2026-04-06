/**
 * @file onThisDay.ts
 * @description Scheduled Cloud Function that runs daily at 7:00 AM UTC.
 *              For each user, finds content they saved 7, 30, or 365 days ago
 *              (±1 day window) and writes a memory doc to users/{uid}/memories.
 *              The Today Dashboard surfaces these as nostalgia cards.
 */

import '../utils/admin.js';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

interface MemoryItem {
	contentId: string;
	boardId: string;
	boardName: string;
	type: string;
	title: string;
	imageUrl: string | null;
	authorName: string;
	originalDate: FirebaseFirestore.Timestamp;
}

interface MemoryDoc {
	userId: string;
	date: string; // YYYY-MM-DD
	items: MemoryItem[];
	daysAgo: number; // 7, 30, or 365
	label: string; // "1 week ago", "1 month ago", "1 year ago"
	createdAt: FirebaseFirestore.FieldValue;
}

const LOOKBACK_WINDOWS = [
	{ days: 7, label: '1 week ago' },
	{ days: 30, label: '1 month ago' },
	{ days: 365, label: '1 year ago' }
];

function dateWindowBounds(daysAgo: number): { start: Date; end: Date } {
	const now = new Date();
	const target = new Date(now);
	target.setDate(target.getDate() - daysAgo);

	const start = new Date(target);
	start.setHours(0, 0, 0, 0);

	const end = new Date(target);
	end.setHours(23, 59, 59, 999);

	return { start, end };
}

function extractTitle(data: Record<string, unknown>): string {
	if (data.title && typeof data.title === 'string') return data.title;
	if (data.text && typeof data.text === 'string') return (data.text as string).slice(0, 80);
	if (data.locationName && typeof data.locationName === 'string') return data.locationName as string;
	if (data.question && typeof data.question === 'string') return data.question as string;
	return '';
}

function extractImage(data: Record<string, unknown>): string | null {
	if (data.images && Array.isArray(data.images) && data.images.length > 0) {
		return (data.images[0] as { url?: string })?.url ?? null;
	}
	if (data.imageUrl && typeof data.imageUrl === 'string') return data.imageUrl;
	if (data.thumbnailUrl && typeof data.thumbnailUrl === 'string') return data.thumbnailUrl;
	if (data.image && typeof data.image === 'string') return data.image;
	return null;
}

export const onThisDay = onSchedule('every day 07:00', async () => {
	const db = getFirestore();
	const usersSnap = await db.collection('users').select('email').get();

	const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

	for (const userDoc of usersSnap.docs) {
		const uid = userDoc.id;

		// Get all boards this user is a member of
		const boardsSnap = await db.collection('boards')
			.where('memberIds', 'array-contains', uid)
			.select('name')
			.get();

		if (boardsSnap.empty) continue;

		const boardMap = new Map<string, string>();
		for (const b of boardsSnap.docs) {
			boardMap.set(b.id, (b.data().name as string) || 'Board');
		}

		// Check each lookback window
		for (const { days, label } of LOOKBACK_WINDOWS) {
			const { start, end } = dateWindowBounds(days);
			const startTs = Timestamp.fromDate(start);
			const endTs = Timestamp.fromDate(end);

			const items: MemoryItem[] = [];

			// Query each board for content in the date window
			for (const [boardId, boardName] of boardMap) {
				const contentSnap = await db
					.collection(`boards/${boardId}/content`)
					.where('createdAt', '>=', startTs)
					.where('createdAt', '<=', endTs)
					.where('authorId', '==', uid)
					.orderBy('createdAt', 'desc')
					.limit(5)
					.get();

				for (const doc of contentSnap.docs) {
					const data = doc.data();
					items.push({
						contentId: doc.id,
						boardId,
						boardName,
						type: data.type as string,
						title: extractTitle(data),
						imageUrl: extractImage(data),
						authorName: data.authorName as string,
						originalDate: data.createdAt as FirebaseFirestore.Timestamp
					});
				}
			}

			// Only write if we found content
			if (items.length === 0) continue;

			// Write memory doc (idempotent: use date+days as doc ID)
			const memoryId = `${today}_${days}d`;
			const memoryDoc: MemoryDoc = {
				userId: uid,
				date: today,
				items,
				daysAgo: days,
				label,
				createdAt: FieldValue.serverTimestamp()
			};

			await db.doc(`users/${uid}/memories/${memoryId}`).set(memoryDoc);
		}
	}
});
