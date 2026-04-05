/**
 * @file notificationService.ts
 * @description FCM token registration, foreground message handling, and
 *              token storage in Firestore. All push notification Firebase
 *              logic lives here — never call FCM directly from components.
 * @todos
 *   - MED FEATURE: Handle notification tap deep-link routing to board (Capacitor)
 */

import { getMessaging, getToken, onMessage, type MessagePayload } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './app';

let messaging: ReturnType<typeof getMessaging> | null = null;

function ensureMessaging() {
	if (!messaging) {
		messaging = getMessaging();
	}
	return messaging;
}

/**
 * Requests notification permission and registers the FCM token.
 * Stores the token in Firestore at /users/{uid}/tokens/{token}.
 * Returns the token string, or null if permission was denied or an error occurred.
 */
export async function registerFCMToken(userId: string): Promise<string | null> {
	// Verify service worker registration exists before requesting permission
	let swRegistration: ServiceWorkerRegistration | undefined;
	try {
		swRegistration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
	} catch (err) {
		console.error('[notificationService] Failed to get SW registration:', err);
		return null;
	}

	if (!swRegistration) {
		console.error('[notificationService] Service worker not registered at /firebase-messaging-sw.js');
		return null;
	}

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return null;

	const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

	let token: string;
	try {
		token = await getToken(ensureMessaging(), {
			vapidKey,
			serviceWorkerRegistration: swRegistration
		});
	} catch (err) {
		console.error('[notificationService] Failed to get FCM token:', err);
		return null;
	}

	if (!token) return null;

	try {
		await setDoc(doc(db(), 'users', userId, 'tokens', token), {
			token,
			createdAt: serverTimestamp(),
			platform: 'web'
		});
	} catch (err) {
		console.error('[notificationService] Failed to store FCM token in Firestore:', err);
		return null;
	}

	return token;
}

/**
 * Listens for foreground FCM messages. Returns an unsubscribe function.
 */
export function onForegroundMessage(
	callback: (payload: MessagePayload) => void
): () => void {
	return onMessage(ensureMessaging(), callback);
}
