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

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
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
