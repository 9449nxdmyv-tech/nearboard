/**
 * @file fcmService.ts
 * @description FCM push notification sender for Cloud Functions.
 *              Sends data-only push notifications to board members, respecting
 *              per-member notification preferences (silent/ping/voice),
 *              quiet hours, and cleaning up stale tokens on send failure.
 *
 *              Messages are sent as data-only (no `notification` field) so that:
 *              - Web: the service worker has full control over display (no duplicates)
 *              - Android: FCM delivers the data message; a high-priority config
 *                ensures the system wakes the app to show the notification
 *              - iOS/APNs: the `apns.payload.aps` block triggers native display
 */

import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging, type BatchResponse } from 'firebase-admin/messaging';
import { getCurrentHourInTimezone } from './timezone.js';

const ANDROID_CHANNEL_ID = 'nearboard_default';

interface MemberNotifData {
	uid: string;
	mode: 'silent' | 'ping' | 'voice';
}

/**
 * Checks whether a user is currently in their quiet hours.
 */
function isInQuietHours(
	quietStart: number | undefined,
	quietEnd: number | undefined,
	timezone: string
): boolean {
	if (quietStart === undefined || quietEnd === undefined) return false;
	const currentHour = getCurrentHourInTimezone(timezone);
	if (quietStart < quietEnd) {
		// e.g., 22–7 doesn't wrap, 10–18 is daytime block
		return currentHour >= quietStart && currentHour < quietEnd;
	}
	// Wraps midnight: e.g., 22–7 means 22,23,0,1,2,3,4,5,6
	return currentHour >= quietStart || currentHour < quietEnd;
}

/**
 * Removes stale FCM tokens that returned registration-token-not-registered errors.
 */
async function cleanupStaleTokens(
	tokens: string[],
	response: BatchResponse
): Promise<void> {
	const db = getFirestore();
	const batch = db.batch();
	let hasDeletes = false;

	for (let i = 0; i < response.responses.length; i++) {
		const result = response.responses[i];
		if (
			result.error &&
			(result.error.code === 'messaging/registration-token-not-registered' ||
				result.error.code === 'messaging/invalid-registration-token')
		) {
			// Find and delete this token across all users
			const tokenSnap = await db
				.collectionGroup('tokens')
				.where('token', '==', tokens[i])
				.get();
			for (const doc of tokenSnap.docs) {
				batch.delete(doc.ref);
				hasDeletes = true;
			}
		}
	}

	if (hasDeletes) {
		await batch.commit();
	}
}

/**
 * Sends push notifications to board members, respecting notification preferences,
 * quiet hours, and cleaning up stale tokens.
 * - silent: skipped entirely
 * - ping: text-only push notification
 * - voice: push notification with audioUrl in data payload (if provided)
 */
export async function notifyBoardMembers(
	boardId: string,
	memberIds: string[],
	title: string,
	body: string,
	audioUrl?: string | null
): Promise<void> {
	const db = getFirestore();

	// Fetch member notification preferences in parallel
	const memberSnaps = await Promise.all(
		memberIds.map((uid) => db.doc(`boards/${boardId}/members/${uid}`).get())
	);

	const memberPrefs: MemberNotifData[] = memberSnaps
		.filter((snap) => snap.exists)
		.map((snap) => {
			const data = snap.data()!;
			return {
				uid: data.userId as string,
				mode: (data.notificationMode as 'silent' | 'ping' | 'voice') ?? 'ping'
			};
		});

	// Split members by notification mode
	const pingMembers = memberPrefs.filter((m) => m.mode === 'ping');
	const voiceMembers = memberPrefs.filter((m) => m.mode === 'voice');

	// Members not in the subcollection default to 'ping'
	const knownUids = new Set(memberPrefs.map((m) => m.uid));
	const unknownUids = memberIds.filter((uid) => !knownUids.has(uid));

	const allPingUids = [...pingMembers.map((m) => m.uid), ...unknownUids];
	const allVoiceUids = voiceMembers.map((m) => m.uid);

	// Batch-fetch user docs to check quiet hours
	const allUids = [...new Set([...allPingUids, ...allVoiceUids])];
	const userDocRefs = allUids.map((uid) => db.doc(`users/${uid}`));
	const userSnaps = userDocRefs.length > 0 ? await db.getAll(...userDocRefs) : [];
	const quietHoursMap = new Map<string, { start?: number; end?: number; tz: string }>();
	for (const snap of userSnaps) {
		if (snap.exists) {
			const data = snap.data()!;
			quietHoursMap.set(snap.id, {
				start: data.quietHoursStart as number | undefined,
				end: data.quietHoursEnd as number | undefined,
				tz: (data.timezone as string) || 'UTC'
			});
		}
	}

	// Filter out users currently in quiet hours
	const filterQuietHours = (uids: string[]): string[] =>
		uids.filter((uid) => {
			const qh = quietHoursMap.get(uid);
			if (!qh) return true;
			return !isInQuietHours(qh.start, qh.end, qh.tz);
		});

	const pingUids = filterQuietHours(allPingUids);
	const voiceUids = filterQuietHours(allVoiceUids);

	// Collect FCM tokens for each group
	const collectTokens = async (uids: string[]): Promise<string[]> => {
		if (uids.length === 0) return [];
		const tokenSnaps = await Promise.all(
			uids.map((uid) => db.collection('users').doc(uid).collection('tokens').get())
		);
		const tokens: string[] = [];
		for (const snap of tokenSnaps) {
			for (const d of snap.docs) {
				const t = d.data().token as string;
				if (t) tokens.push(t);
			}
		}
		return tokens;
	};

	const [pingTokens, voiceTokens] = await Promise.all([
		collectTokens(pingUids),
		collectTokens(voiceUids)
	]);

	const messaging = getMessaging();
	const sends: Promise<void>[] = [];

	// Send text-only notifications to ping members
	if (pingTokens.length > 0) {
		sends.push(
			messaging
				.sendEachForMulticast({
					tokens: pingTokens,
					// Data-only: title/body in data so SW and native handlers control display
					data: { boardId, title, body },
					android: {
						priority: 'high',
						notification: {
							channelId: ANDROID_CHANNEL_ID,
							title,
							body,
							icon: 'ic_notification',
							tag: `nearboard-${boardId}`
						}
					},
					apns: {
						payload: {
							aps: {
								alert: { title, body },
								sound: 'default',
								badge: 1,
								'mutable-content': 1
							}
						},
						headers: { 'apns-collapse-id': `nearboard-${boardId}` }
					},
					webpush: {
						headers: { Urgency: 'high' }
					}
				})
				.then((response) => cleanupStaleTokens(pingTokens, response))
		);
	}

	// Send notifications with audio URL to voice members
	if (voiceTokens.length > 0) {
		sends.push(
			messaging
				.sendEachForMulticast({
					tokens: voiceTokens,
					data: {
						boardId,
						title,
						body,
						...(audioUrl ? { audioUrl } : {})
					},
					android: {
						priority: 'high',
						notification: {
							channelId: ANDROID_CHANNEL_ID,
							title,
							body,
							icon: 'ic_notification',
							tag: `nearboard-${boardId}`
						}
					},
					apns: {
						payload: {
							aps: {
								alert: { title, body },
								sound: 'default',
								badge: 1,
								'mutable-content': 1
							}
						},
						headers: { 'apns-collapse-id': `nearboard-${boardId}` }
					},
					webpush: {
						headers: { Urgency: 'high' }
					}
				})
				.then((response) => cleanupStaleTokens(voiceTokens, response))
		);
	}

	await Promise.all(sends);
}
