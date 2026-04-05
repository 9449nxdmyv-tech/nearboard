/**
 * @file firebase-messaging-sw.js
 * @description Firebase Cloud Messaging service worker for background push notifications.
 *              Must live at the web root (static/) to have the correct scope.
 *              Handles data-only messages (no `notification` field) to avoid duplicate
 *              display from the FCM SDK. Uses tag-based grouping to replace stale
 *              notifications for the same board.
 */

/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js');
importScripts('/firebase-config.js');

// Initialize Firebase synchronously at the top level.
// This ensures that the messaging instance and its event listeners
// (push, notificationclick, etc.) are registered immediately during
// the initial evaluation of the service worker script.
// Config is loaded from the build-generated firebase-config.js.
firebase.initializeApp(self.firebaseConfig);

const messaging = firebase.messaging();

// Handle background data-only messages.
// Title and body are in data payload (not notification) to give us full control
// over display and avoid duplicates from FCM SDK auto-display.
messaging.onBackgroundMessage((payload) => {
	const data = payload.data || {};
	const notificationTitle = data.title || payload.notification?.title || 'Nearboard';
	const notificationBody = data.body || payload.notification?.body || '';
	const boardId = data.boardId;

	const notificationOptions = {
		body: notificationBody,
		icon: '/icon-192.png',
		badge: '/icon-192.png',
		data: data,
		// Group notifications by boardId — replaces previous notification for the same board
		tag: boardId ? `nearboard-${boardId}` : 'nearboard-general',
		renotify: true
	};

	self.registration.showNotification(notificationTitle, notificationOptions);
});

// Deep-link on notification click
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const boardId = event.notification.data?.boardId;
	const url = boardId ? `/board/${boardId}` : '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if (client.url.includes(self.location.origin)) {
					// Post message to let SvelteKit handle SPA routing (no full reload)
					client.postMessage({ type: 'NOTIFICATION_CLICK', boardId });
					return client.focus();
				}
			}
			return self.clients.openWindow(url);
		})
	);
});
