'use client';

/**
 * Recovery boundary for the counter app (Phase 10 §2 surfaces).
 *
 * WHY THIS EXISTS
 *
 * Until this file, a thrown render error or a failed server action fell through
 * to Next's bare default screen — no app chrome, no way forward but the browser
 * back button. That is exactly the wall P2 forbids ("never block the counter")
 * and I5 asks us to name rather than explain.
 *
 * THE COMMON CAUSE IT NAMES
 *
 * The most likely trigger in the shipped product is a Server Action that
 * belongs to an OLDER build. The app is updated in place (packaging Phase 1),
 * every update is a fresh Next build, and a screen a cashier left open before
 * the update still carries action references from the previous one. Posting one
 * lands on the new server, which cannot decrypt it, and Next answers 404
 * ("Failed to find Server Action … from an older or newer deployment"). Pinning
 * `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (see `.env.example`) stops that at the
 * source; this boundary is the belt-and-suspenders that turns whatever slips
 * through into a single reload instead of a dead 404.
 *
 * React redacts `error.message` in production, so the copy is recovery-first
 * and does not depend on reading the underlying message — the Reload always
 * recovers, whatever threw.
 */

import { useEffect } from 'react';

export default function CounterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced to the browser console for support bundles; never shown raw to
    // the operator, who gets the sentence below instead.
    console.error('Counter surface error', error);
  }, [error]);

  return (
    <section className="mx-auto flex max-w-lg flex-col items-start gap-4 p-8">
      <h1 className="text-navy text-2xl font-semibold">This screen needs a reload</h1>
      <p className="text-ink-2 leading-relaxed">
        Something on this screen stopped responding — most often because Mehvar was updated while
        this page was left open. Your data is safe. Reload to pick up the current version and carry
        on.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch rounded-control px-6"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
          }}
          className="text-ink-2 text-sm"
        >
          Try again without reloading
        </button>
      </div>
    </section>
  );
}
