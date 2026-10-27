'use client';

/**
 * Service-worker registration — ADR-3's PWA half.
 *
 * The outbox keeps a *running* counter selling through a disruption. The
 * service worker covers the other half: a counter that reloads, or is opened
 * cold, while the network is gone. Without it the browser has no app shell to
 * boot and the operator is looking at a dinosaur instead of a sale screen.
 *
 * **Production only, deliberately.** Next's dev server ships chunks that change
 * on every edit and coordinates them over a websocket; a caching worker in that
 * loop serves stale JavaScript and produces bugs that do not exist. The
 * behaviour it provides is verified against a production build instead
 * (`npm run build && npm run start`), which is the artefact that actually runs
 * on a counter.
 */

import { useEffect } from 'react';

/** `public/sw.js`'s cache name, without its version. */
const SHELL_CACHE_PREFIX = 'mehvar-shell-';

/**
 * Not registering in development is half of the rule above. The installed
 * app runs at the same address as `npm run dev` (localhost:3000), and a
 * worker it registered stays registered for that address, controlling the
 * dev server's pages and answering their script requests from its cache. So
 * in development any worker found is removed, and the page loaded once more
 * without it. The outbox lives in IndexedDB and is not touched.
 */
async function removeLeftoverWorker(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (navigator.serviceWorker.controller) {
    // This page was served by that worker. It runs as the shell mounts,
    // before anything is typed, and once: the next load has no worker.
    console.warn('Removed a service worker left by the installed app; reloading.');
    window.location.reload();
    return;
  }
  // Only now: a worker still controlling the page refills its cache.
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(SHELL_CACHE_PREFIX))
        .map((name) => caches.delete(name)),
    );
  }
}

export function ServiceWorker() {
  useEffect(() => {
    // Absent on a page opened over plain http from another machine.
    if (!('serviceWorker' in navigator)) {
      return;
    }
    if (process.env.NODE_ENV !== 'production') {
      void removeLeftoverWorker().catch(() => {
        // Dev convenience only; a leftover worker is visible in DevTools.
      });
      return;
    }

    void (async () => {
      try {
        await navigator.serviceWorker.register('/sw.js');
        const registration = await navigator.serviceWorker.ready;
        // The counter navigates client-side almost exclusively, so the worker
        // would otherwise rarely see a document request to cache. This component
        // only renders inside the authenticated shell, so reaching here means
        // there is a session and the shell is worth keeping.
        registration.active?.postMessage({ type: 'warm-shell' });
      } catch {
        // Costs the offline-reload case and nothing else; selling continues
        // either way, because the outbox is what actually protects a sale (P2).
      }
    })();
  }, []);

  return null;
}
