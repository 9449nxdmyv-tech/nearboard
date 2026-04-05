/**
 * @file pushService.ts
 * @description Capacitor push notification service for native iOS/Android.
 *              Handles APNs/FCM token registration, foreground notifications,
 *              and notification tap deep-linking. Web falls back to the
 *              service-worker-based FCM flow in notificationStore.
 */

import { Capacitor } from '@capacitor/core';
import { browser } from '$app/environment';

/**
 * Clears the iOS badge count. Call on app resume / foreground to
 * remove stale badge numbers. No-op on Android and web.
 */
export async function clearBadge(): Promise<void> {
	if (!isNativePush()) return;
	try {
		const { PushNotifications } = await import('@capacitor/push-notifications');
		await PushNotifications.removeAllDeliveredNotifications();
		// Badge plugin is not installed; APNs badge is reset by sending
		// a silent push with badge:0 or via the Badge plugin.
		// For now, clearing delivered notifications is the best we can do
		// without adding a dependency. iOS also clears badge on
		// removeAllDeliveredNotifications in recent Capacitor versions.
	} catch {
		// Silently ignore — not critical
	}
}

export interface NativePushCallbacks {
	onToken: (token: string) => void;
	onNotification: (title: string, body: string, boardId?: string) => void;
	onNotificationTap: (boardId?: string) => void;
}

let initialized = false;

/**
 * Returns true if we should use native Capacitor push instead of web FCM.
 */
export function isNativePush(): boolean {
	return browser && Capacitor.isNativePlatform();
}

/**
 * Requests native push notification permission on iOS/Android.
 * On iOS this shows the system permission dialog.
 * Returns true if permission was granted.
 */
export async function requestNativePushPermission(): Promise<boolean> {
	if (!isNativePush()) return false;

	const { PushNotifications } = await import('@capacitor/push-notifications');
	const result = await PushNotifications.requestPermissions();
	return result.receive === 'granted';
}

/**
 * Checks current native push permission status without prompting.
 */
export async function checkNativePushPermission(): Promise<'granted' | 'denied' | 'prompt'> {
	if (!isNativePush()) return 'denied';

	const { PushNotifications } = await import('@capacitor/push-notifications');
	const result = await PushNotifications.checkPermissions();
	if (result.receive === 'granted') return 'granted';
	if (result.receive === 'denied') return 'denied';
	return 'prompt';
}

/**
 * Initializes native push notifications. Registers with APNs (iOS) / FCM (Android),
 * listens for token updates and incoming notifications.
 * Safe to call multiple times — only initializes once.
 */
export async function initNativePush(callbacks: NativePushCallbacks): Promise<void> {
	if (!isNativePush() || initialized) return;

	const { PushNotifications } = await import('@capacitor/push-notifications');

	// Listen for successful registration — provides the device token
	await PushNotifications.addListener('registration', (token) => {
		callbacks.onToken(token.value);
	});

	// Listen for registration errors
	await PushNotifications.addListener('registrationError', (error) => {
		console.error('[pushService] Registration failed:', error);
	});

	// Foreground notification received (app is open)
	await PushNotifications.addListener('pushNotificationReceived', (notification) => {
		callbacks.onNotification(
			notification.title ?? 'Nearboard',
			notification.body ?? '',
			notification.data?.boardId as string | undefined
		);
	});

	// User tapped a notification (app was in background or closed)
	await PushNotifications.addListener('pushNotificationActionPerformed', (result) => {
		const boardId = result.notification.data?.boardId as string | undefined;
		callbacks.onNotificationTap(boardId);
	});

	// Register with APNs/FCM to get a device token
	await PushNotifications.register();

	initialized = true;
}
