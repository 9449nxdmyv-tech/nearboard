/**
 * @file notificationStore.ts
 * @description Reactive store for push notification state. Manages FCM token
 *              lifecycle and foreground message display for both web (service worker)
 *              and native (Capacitor) platforms.
 *              Permission is deferred until the user has a meaningful reason
 *              to enable notifications (first board join/create). Foreground
 *              messages show a non-intrusive action toast instead of auto-navigating.
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { showToast } from './toastStore';

interface NotificationState {
	fcmToken: string | null;
	permission: NotificationPermission | 'unknown';
	/** Whether the SW/native listener are ready (even if permission not yet granted) */
	initialized: boolean;
	lastMessage: { title: string; body: string; boardId?: string } | null;
}

const initial: NotificationState = {
	fcmToken: null,
	permission: 'unknown',
	initialized: false,
	lastMessage: null
};

export const notificationStore = writable<NotificationState>(initial);

const NOTIF_INIT_KEY = 'nb_notif_initialized';

/**
 * Initializes notification infrastructure for the current platform.
 * - Native (iOS/Android): Sets up Capacitor push listeners
 * - Web: Registers service worker and foreground FCM listener
 * Does NOT request permission — that's deferred to requestNotificationPermission.
 */
export async function initNotifications(userId: string): Promise<void> {
	if (!browser) return;

	const { isNativePush } = await import('$lib/native/pushService');

	if (isNativePush()) {
		await initNativeNotifications(userId);
	} else {
		await initWebNotifications(userId);
	}
}

/**
 * Requests notification permission at a meaningful moment (e.g., after creating
 * or joining a board). Works on both web and native platforms.
 */
export async function requestNotificationPermission(userId: string): Promise<boolean> {
	if (!browser) return false;

	const { isNativePush } = await import('$lib/native/pushService');

	if (isNativePush()) {
		return requestNativePermission(userId);
	}
	return requestWebPermission(userId);
}

// ─── Native (Capacitor) ──────────────────────────────────────────────────────

async function initNativeNotifications(userId: string): Promise<void> {
	const { checkNativePushPermission, initNativePush } = await import('$lib/native/pushService');

	const status = await checkNativePushPermission();

	notificationStore.update((s) => ({
		...s,
		initialized: true,
		permission: status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'default'
	}));

	if (status === 'granted') {
		await activateNativePush(userId);
	}
}

async function requestNativePermission(userId: string): Promise<boolean> {
	const { requestNativePushPermission, checkNativePushPermission } = await import('$lib/native/pushService');

	const current = await checkNativePushPermission();
	if (current === 'granted') {
		await activateNativePush(userId);
		return true;
	}
	if (current === 'denied') return false;

	const granted = await requestNativePushPermission();
	notificationStore.update((s) => ({
		...s,
		permission: granted ? 'granted' : 'denied'
	}));

	if (granted) {
		await activateNativePush(userId);
		return true;
	}
	return false;
}

async function activateNativePush(userId: string): Promise<void> {
	const { initNativePush } = await import('$lib/native/pushService');
	const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
	const { db } = await import('$lib/firebase/app');

	await initNativePush({
		onToken: async (token) => {
			// Store native token in Firestore (same collection as web tokens)
			try {
				await setDoc(doc(db(), 'users', userId, 'tokens', token), {
					token,
					createdAt: serverTimestamp(),
					platform: 'native'
				});
			} catch (err) {
				console.error('[notificationStore] Failed to store native push token:', err);
			}

			notificationStore.update((s) => ({
				...s,
				fcmToken: token,
				permission: 'granted'
			}));
		},

		onNotification: (title, body, boardId) => {
			notificationStore.update((s) => ({
				...s,
				lastMessage: { title, body, boardId }
			}));

			// Show non-intrusive action toast (same as web)
			showToast(
				body || title,
				'info',
				boardId
					? {
							action: { label: 'View', onClick: () => goto(`/board/${boardId}`) },
							duration: 6000
						}
					: undefined
			);
		},

		onNotificationTap: (boardId) => {
			if (boardId) {
				goto(`/board/${boardId}`).catch(console.error);
			}
		}
	});
}

// ─── Web (Service Worker + FCM) ──────────────────────────────────────────────

async function initWebNotifications(userId: string): Promise<void> {
	if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

	try {
		await navigator.serviceWorker.register('/firebase-messaging-sw.js');

		navigator.serviceWorker.addEventListener('message', (event) => {
			if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.boardId) {
				goto(`/board/${event.data.boardId}`).catch(console.error);
			}
		});

		notificationStore.update((s) => ({
			...s,
			initialized: true,
			permission: Notification.permission
		}));

		if (Notification.permission === 'granted') {
			await activateWebFCM(userId);
		}
	} catch {
		notificationStore.update((s) => ({
			...s,
			permission: Notification.permission
		}));
	}
}

async function requestWebPermission(userId: string): Promise<boolean> {
	if (!('Notification' in window)) return false;

	if (Notification.permission === 'granted') {
		await activateWebFCM(userId);
		return true;
	}
	if (Notification.permission === 'denied') return false;
	if (sessionStorage.getItem('nb_notif_dismissed')) return false;

	const permission = await Notification.requestPermission();
	notificationStore.update((s) => ({ ...s, permission }));

	if (permission === 'granted') {
		await activateWebFCM(userId);
		localStorage.setItem(NOTIF_INIT_KEY, '1');
		return true;
	}

	sessionStorage.setItem('nb_notif_dismissed', '1');
	return false;
}

async function activateWebFCM(userId: string): Promise<void> {
	const { registerFCMToken, onForegroundMessage } = await import(
		'$lib/firebase/notificationService'
	);

	const token = await registerFCMToken(userId);

	notificationStore.update((s) => ({
		...s,
		fcmToken: token,
		permission: Notification.permission
	}));

	if (token) {
		onForegroundMessage((payload) => {
			// Data-only messages: title/body are in data payload, not notification
			const data = payload.data ?? {};
			const boardId = data.boardId;
			const title = data.title || payload.notification?.title || 'Nearboard';
			const body = data.body || payload.notification?.body || '';

			notificationStore.update((s) => ({
				...s,
				lastMessage: { title, body, boardId }
			}));

			showToast(
				body || title,
				'info',
				boardId
					? {
							action: { label: 'View', onClick: () => goto(`/board/${boardId}`) },
							duration: 6000
						}
					: undefined
			);
		});
	}
}
