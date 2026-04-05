/**
 * @file emailDigest.ts
 * @description Scheduled Cloud Function that sends a daily email digest to each
 *              user summarizing new cards across all their boards since their
 *              last digest. Runs every 30 minutes and checks each user's local
 *              time against their preferred digest time.
 *
 * Privacy: Board membership is verified at send time — if a user was removed
 * from a board after a card was saved, that board is excluded from their digest.
 */

import '../utils/admin.js';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { sendDigestEmail } from '../utils/emailService.js';
import { getCurrentHourInTimezone, getCurrentMinuteInTimezone } from '../utils/timezone.js';
import { processInBatches } from '../utils/boardEligibility.js';
import { buildDigestForUser } from '../utils/digestBuilder.js';

const CONCURRENCY_LIMIT = 5;
const DEFAULT_DIGEST_TIME = '07:30';

interface UserDigestData {
	uid: string;
	email: string;
	displayName: string;
	digestTime: string;
	timezone: string;
	lastDigestSentAt: Timestamp | null;
}

/**
 * Runs every 30 minutes. Finds users whose local time matches their preferred
 * digest time (±15 min), gathers board activity, and sends a digest email.
 */
export const emailDigest = onSchedule(
	{ schedule: 'every 30 minutes', secrets: ['GROQ_API_KEY', 'POSTMARK_SERVER_TOKEN', 'DIGEST_HMAC_SECRET'] },
	async () => {
		const eligibleUsers = await getEligibleUsers();
		if (eligibleUsers.length === 0) return;

		await processInBatches(eligibleUsers, CONCURRENCY_LIMIT, processUserDigest);
	}
);

/**
 * Finds users with digestEnabled !== false whose local time is within
 * ±15 minutes of their preferred digest time.
 */
async function getEligibleUsers(): Promise<UserDigestData[]> {
	const db = getFirestore();

	// Firestore can't query "field is missing OR true", so query all users
	// with an email and filter in-memory.
	const allUsersSnap = await db.collection('users')
		.where('email', '!=', '')
		.get();

	const eligible: UserDigestData[] = [];

	for (const snap of allUsersSnap.docs) {
		const data = snap.data();

		// Skip users who explicitly disabled digest
		if (data.digestEnabled === false) continue;

		const email = data.email as string;
		if (!email) continue;

		const timezone = (data.digestTimezone as string) || (data.timezone as string) || 'UTC';
		const digestTime = (data.digestTime as string) || DEFAULT_DIGEST_TIME;

		// Check if now is within ±15 min of the user's preferred digest time
		if (!isAroundDigestTime(timezone, digestTime)) continue;

		// Prevent sending more than once per 20 hours
		const lastSent = data.lastDigestSentAt as Timestamp | null;
		if (lastSent && Date.now() - lastSent.toMillis() < 20 * 60 * 60 * 1000) continue;

		eligible.push({
			uid: snap.id,
			email,
			displayName: (data.displayName as string) || 'there',
			digestTime,
			timezone,
			lastDigestSentAt: lastSent ?? null
		});
	}

	return eligible;
}

/**
 * Checks if current local time is within ±15 minutes of the target HH:MM.
 */
function isAroundDigestTime(timezone: string, digestTime: string): boolean {
	const [targetH, targetM] = digestTime.split(':').map(Number);
	if (isNaN(targetH) || isNaN(targetM)) return false;

	const currentH = getCurrentHourInTimezone(timezone);
	const currentM = getCurrentMinuteInTimezone(timezone);

	const currentMinutes = currentH * 60 + currentM;
	const targetMinutes = targetH * 60 + targetM;

	const diff = Math.abs(currentMinutes - targetMinutes);
	// Handle midnight wrap (e.g., 23:50 vs 00:05)
	const wrappedDiff = Math.min(diff, 1440 - diff);
	return wrappedDiff <= 15;
}

/**
 * Processes a single user's digest: builds data, sends email, updates timestamp.
 */
async function processUserDigest(user: UserDigestData): Promise<void> {
	try {
		const db = getFirestore();
		const cutoff = user.lastDigestSentAt
			? user.lastDigestSentAt
			: Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

		const digestData = await buildDigestForUser({
			uid: user.uid,
			email: user.email,
			displayName: user.displayName,
			since: cutoff
		});

		if (!digestData) return;

		await sendDigestEmail(digestData);

		// Update lastDigestSentAt
		await db.doc(`users/${user.uid}`).update({
			lastDigestSentAt: FieldValue.serverTimestamp()
		});

		console.log(`Digest sent to ${user.email} (${digestData.boards.length} boards)`);
	} catch (err) {
		console.error(`Failed to send digest to ${user.uid}:`, err);
	}
}
