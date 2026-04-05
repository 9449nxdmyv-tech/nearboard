/**
 * @file sendDigestPreview.ts
 * @description HTTPS callable Cloud Function that sends a one-off digest preview
 *              email to the authenticated user. Uses the last 24 hours of activity
 *              regardless of lastDigestSentAt.
 */

import '../utils/admin.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { sendDigestEmail } from '../utils/emailService.js';
import { buildDigestForUser } from '../utils/digestBuilder.js';

export const sendDigestPreview = onCall(
	{ secrets: ['GROQ_API_KEY', 'POSTMARK_SERVER_TOKEN', 'DIGEST_HMAC_SECRET'] },
	async (request) => {
		if (!request.auth?.uid) {
			throw new HttpsError('unauthenticated', 'You must be signed in to request a digest preview.');
		}

		const uid = request.auth.uid;
		const db = getFirestore();
		const userSnap = await db.doc(`users/${uid}`).get();

		if (!userSnap.exists) {
			throw new HttpsError('not-found', 'User document not found.');
		}

		const userData = userSnap.data()!;
		const email = userData.email as string;

		if (!email) {
			throw new HttpsError('failed-precondition', 'No email address on your account.');
		}

		// Rate limit: 1 preview per 5 minutes
		const lastPreview = userData.lastDigestPreviewAt as FirebaseFirestore.Timestamp | undefined;
		if (lastPreview && Date.now() - lastPreview.toMillis() < 5 * 60 * 1000) {
			throw new HttpsError('resource-exhausted', 'Please wait a few minutes before requesting another preview.');
		}

		// Always use 24h window for preview (ignores lastDigestSentAt)
		const since = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

		const digestData = await buildDigestForUser({
			uid,
			email,
			displayName: (userData.displayName as string) || 'there',
			since
		});

		if (!digestData) {
			throw new HttpsError('not-found', 'No new activity in the last 24 hours to include in a digest.');
		}

		await sendDigestEmail(digestData);

		// Record preview timestamp for rate limiting
		await db.doc(`users/${uid}`).update({ lastDigestPreviewAt: Timestamp.now() });

		return { success: true, boardCount: digestData.boards.length };
	}
);
