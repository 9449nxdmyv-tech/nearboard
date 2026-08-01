/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

const CACHE_NAME = `nearboard-${version}`;

// Assets to precache: built files + static assets
const PRECACHE = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        // Don't cache non-ok or opaque responses
        if (!response || response.status !== 200) return response;

        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    }).catch(() => {
      // Offline fallback: return the shell for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html') as Promise<Response>;
      }
      return new Response('Offline', { status: 503 });
    })
  );
});

/*
 * FUTURE: Global sync layer (e.g. Nostr)
 * ----------------------------------------
 * When adding a global/online sync option:
 * - Add a background sync handler here to push queued posts to relays
 * - Keep IndexedDB as the single source of truth (offline-first)
 * - The fetch handler above already caches aggressively for offline use
 * - Add periodic sync to pull new posts from relays when online
 */
