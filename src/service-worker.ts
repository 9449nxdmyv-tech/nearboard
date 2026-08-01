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

/** Build assets carry a content hash, so their URL changes when they change. */
const IMMUTABLE = new Set(build);

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const isNavigation = event.request.mode === 'navigate';
  const isImmutable = IMMUTABLE.has(url.pathname);

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Hashed assets can be served from cache forever — a new build produces a
      // new URL, so there is nothing stale to serve.
      if (isImmutable) {
        const hit = await cache.match(event.request);
        if (hit) return hit;
      }

      // Everything else is network-first.
      //
      // Cache-first on the app shell means a rebuilt app keeps serving the old
      // bundle until storage is cleared by hand — an update that silently does
      // not apply. That was observed on device: a fresh install still rendered
      // the previous build until `pm clear`.
      try {
        const response = await fetch(event.request);
        if (response && response.status === 200) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        if (isNavigation) {
          const shell = await cache.match('/index.html');
          if (shell) return shell;
        }
        return new Response('Offline', { status: 503 });
      }
    })()
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
