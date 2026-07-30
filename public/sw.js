/**
 * The counter's service worker — ADR-3.
 *
 * Its whole job is that a counter which reloads during a disruption still has
 * a sale screen. It is not an offline-first cache and must never try to be:
 * ADR-3 scopes offline support to "cash sales, udhaar sales, settlements, and
 * quick-item creation", and the outbox in `client/sync/queue.ts` is what
 * actually keeps those safe. This file only makes sure the app shell boots.
 *
 * Three rules it must not break:
 *
 *  1. **Never touch a non-GET request.** Server actions are POSTs. If one were
 *     served from a cache, or swallowed, a sale would look delivered when it
 *     was not. They go to the network and are allowed to fail — the outbox
 *     retries, which is the designed behaviour.
 *  2. **Never cache an API response.** `/api/catalog` has its own IndexedDB
 *     cache with a watermark (ADR-4); a second, dumber cache in front of it
 *     would serve a catalog the app believes it has already reconciled.
 *  3. **Never serve a stale document when the network is available.**
 *     Navigations are network-first so a deploy lands on the next reload
 *     (Phase 12 §2.6's version-skew posture), with the cache as the fallback
 *     that only matters when the network is gone.
 */

const CACHE = 'mehvar-shell-v1';

/** The document a cold offline start falls back to: home is the sale screen. */
const SHELL_URL = '/sale';

self.addEventListener('install', () => {
  // Nothing is pre-cached here: the shell is a signed-in document, and at
  // install time there may be no session yet. The page asks for it instead,
  // once it knows it is logged in — see the 'warm-shell' message below.
  self.skipWaiting();
});

/**
 * Warms the shell on request from the page.
 *
 * Without this the cache is only ever filled by a document navigation, and the
 * counter mostly navigates client-side — so a machine could run all day, never
 * perform a second document load, and still have nothing to fall back on when
 * it reloads during an outage. The page sends this once it is on a real
 * screen with a session, which is exactly when the shell is worth keeping.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'warm-shell') {
    event.waitUntil(
      caches
        .open(CACHE)
        .then((cache) => cache.add(SHELL_URL))
        .catch(() => {
          // A failed warm costs the offline-reload case and nothing else.
        }),
    );
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

function isCacheableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/manifest.webmanifest' ||
    /\.(?:css|js|woff2?|png|svg|ico)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Rule 1 and 2: anything that writes, and anything the app caches itself,
  // goes straight to the network with no interference at all.
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // Rule 3: documents are network-first.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            // Cached under its own URL, not under the shell's: caching every
            // document as the shell would mean a trip to Customers replaced
            // the sale screen the counter falls back to.
            const cache = await caches.open(CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          // This document if it is known, otherwise the sale screen — home is
          // always a defensible place to land (Phase 10 §1).
          const cached = (await caches.match(request)) ?? (await caches.match(SHELL_URL));
          if (cached) {
            return cached;
          }
          throw new Error('offline and no cached shell');
        }
      })(),
    );
    return;
  }

  // Static assets are cache-first with a background refresh: they are
  // content-hashed, so a cached hit is never wrong, and the refresh keeps the
  // next version warm.
  if (isCacheableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => undefined);

        const response = cached ?? (await network);
        if (!response) {
          throw new Error('offline and not cached');
        }
        return response;
      })(),
    );
  }
});
