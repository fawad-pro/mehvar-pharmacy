'use client';

/**
 * [PCN-013] Cancel a payment or cash entry typed wrong.
 *
 * The entry is never edited or deleted (ADR-1): cancelling writes the opposite
 * entry, and both stay on record. Two steps, so a stray Enter cancels nothing;
 * the second step says what will happen in the shop's words.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type CancelOutcome = { ok: true } | { ok: false; message: string };

export function CancelEntryButton({
  what,
  run,
}: {
  /** "the Rs 5,000.00 payment", "this Rs 300.00 expense". */
  what: string;
  run: () => Promise<CancelOutcome>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const outcome = await run().catch((): CancelOutcome => ({
      ok: false,
      message: 'Cancelling needs a connection to the shop’s computer. Try again.',
    }));
    setBusy(false);
    setConfirming(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-sm">Cancel {what}? It stays on record, marked cancelled.</span>
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={() => void cancel()}
            className="bg-red text-surface min-h-touch rounded-control px-3 text-sm font-medium"
          >
            Yes, cancel it
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="border-border min-h-touch rounded-control border px-3 text-sm"
          >
            Keep it
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="text-blue-600 min-h-touch px-1 text-sm underline-offset-2 hover:underline"
        >
          Cancel entry
        </button>
      )}
      {error ? (
        <span role="alert" className="text-red text-sm">
          {error}
        </span>
      ) : null}
    </span>
  );
}
