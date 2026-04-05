/**
 * @file smartReminders.ts
 * @description Scheduled Cloud Function that scans board content and generates
 *              proactive push notifications for time-sensitive items using Groq AI.
 *              Deduplicates reminders sent in the last 24h. Timezone-aware: only
 *              sends to boards where at least one member's local time is ~9am.
 *              Board scans are batched with CONCURRENCY_LIMIT concurrent AI calls.
 */

import '../utils/admin.js';
import { createHash } from 'crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { notifyBoardMembers } from '../utils/fcmService.js';
import { generateText } from '../utils/aiService.js';
import { getEligibleBoards, processInBatches } from '../utils/boardEligibility.js';

const REMINDER_PROMPT = `Review these board items and identify any that are time-sensitive, overdue, or worth reminding the user about today. Pay special attention to products with active price drops — these deals may expire soon and should be surfaced as urgent. Return a list of actionable reminder messages in plain language, max 20 words each. If nothing is time-sensitive, return "NONE".

Board: "{boardName}"
Items:
{items}`;

const CONCURRENCY_LIMIT = 5;
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Hashes a reminder text for deduplication purposes.
 */
function hashReminder(text: string): string {
	return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

/**
 * Runs every 30 minutes. For each active board, checks if any member's
 * local time is ~9am and generates smart reminders if so.
 */
export const smartReminders = onSchedule({ schedule: 'every 30 minutes', secrets: ['GROQ_API_KEY'] }, async () => {
	const db = getFirestore();

	const eligibleBoards = await getEligibleBoards({
		targetHour: 9,
		activityWindowMs: 7 * 24 * 60 * 60 * 1000
	});

	await processInBatches(eligibleBoards, CONCURRENCY_LIMIT, (boardDoc) =>
		processBoardReminders(db, boardDoc)
	);
});

async function processBoardReminders(
	db: FirebaseFirestore.Firestore,
	boardDoc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<void> {
	const board = boardDoc.data() as { name: string; memberIds: string[] };

	const contentSnap = await db
		.collection(`boards/${boardDoc.id}/content`)
		.orderBy('createdAt', 'desc')
		.limit(20)
		.get();

	if (contentSnap.empty) return;

	const items = contentSnap.docs.map((d) => {
		const data = d.data();
		const type = data.type as string;
		const parts = [type];
		if (data.title) parts.push(`"${data.title}"`);
		if (data.text) parts.push(`"${(data.text as string).slice(0, 100)}"`);
		if (data.price) parts.push(`price: ${data.lastCheckedPrice || data.price}`);
		if (data.priceDrop) parts.push('PRICE DROP');
		if (data.priceDrop && data.originalPrice) parts.push(`was: ${data.originalPrice}`);
		return `- ${parts.join(' — ')}`;
	}).join('\n');

	const prompt = REMINDER_PROMPT
		.replace('{boardName}', board.name)
		.replace('{items}', items);

	const text = await generateText(prompt, 200);
	if (!text || text.trim() === 'NONE') return;

	// Send each reminder as a push notification (max 3), deduplicating against last 24h
	const reminders = text.split('\n').filter((r) => r.trim().length > 0).slice(0, 3);
	const twentyFourHoursAgo = Timestamp.fromDate(new Date(Date.now() - DEDUP_WINDOW_MS));
	const remindersSentRef = db.collection(`boards/${boardDoc.id}/reminders_sent`);

	for (const reminder of reminders) {
		const cleanReminder = reminder.replace(/^[-•]\s*/, '');
		const hash = hashReminder(cleanReminder);

		// Check if a reminder with this hash was sent in the last 24h
		const existingSnap = await remindersSentRef
			.where('hash', '==', hash)
			.where('sentAt', '>=', twentyFourHoursAgo)
			.limit(1)
			.get();

		if (!existingSnap.empty) {
			// Skip — duplicate reminder already sent recently
			continue;
		}

		await notifyBoardMembers(
			boardDoc.id,
			board.memberIds,
			board.name,
			cleanReminder
		);

		// Record the sent reminder for deduplication
		await remindersSentRef.add({
			hash,
			text: cleanReminder,
			sentAt: Timestamp.now()
		});
	}
}
