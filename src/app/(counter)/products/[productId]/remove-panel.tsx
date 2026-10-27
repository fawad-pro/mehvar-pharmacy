'use client';

/**
 * Remove a product entered by mistake, or put a removed one back.
 *
 * Removing hides the product from the counter and the lists; its history stays
 * and keeps counting in reports (Phase 9 §1). It is refused while the product
 * holds stock or a shortfall — the operator writes that off or moves it first,
 * so no units leave the count without a record. Two steps, so a stray Enter
 * does not remove anything.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useCatalog } from '@/client/search/provider';

import { removeProductAction, restoreProductAction, type RemoveOutcome } from '../actions';

export function RemovePanel({
  productId,
  productName,
  isActive,
  canReplace,
}: {
  productId: string;
  productName: string;
  isActive: boolean;
  /** Replace needs history to move; offered only when there is some. */
  canReplace: boolean;
}) {
  const router = useRouter();
  const { refresh: refreshCatalog } = useCatalog();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Extract<RemoveOutcome, { ok: false }> | null>(null);

  async function remove() {
    setBusy(true);
    const outcome = await removeProductAction(productId);
    setBusy(false);
    setConfirming(false);
    if (!outcome.ok) {
      setRefusal(outcome);
      return;
    }
    setRefusal(null);
    // The counter's index is client state that revalidation does not reach.
    refreshCatalog();
    const unlinked = outcome.unlinked
      .map((code) => `${code.barcode}:${code.unitLevelName}`)
      .join(',');
    router.replace(
      `/products/${productId}?removed=1${unlinked ? `&unlinked=${encodeURIComponent(unlinked)}` : ''}`,
    );
  }

  async function restore() {
    setBusy(true);
    const outcome = await restoreProductAction(productId);
    setBusy(false);
    if (!outcome.ok) {
      setRefusal({ ok: false, message: outcome.message });
      return;
    }
    setRefusal(null);
    refreshCatalog();
    router.replace(`/products/${productId}`);
  }

  if (!isActive) {
    return (
      <div className="border-line flex flex-wrap items-center gap-3 rounded border px-3 py-2">
        <p className="text-sm">Removed — not shown at the counter or in Products.</p>
        <button
          type="button"
          onClick={() => void restore()}
          disabled={busy}
          className="border-line min-h-touch ml-auto rounded border px-4"
        >
          Restore
        </button>
        {refusal ? (
          <p role="alert" className="text-red w-full text-sm">
            {refusal.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border-line flex flex-col gap-2 rounded border p-3">
      <h2 className="text-ink/60 text-xs tracking-[0.14em] uppercase">Entered by mistake?</h2>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">
            Remove {productName}? It stops showing at the counter. Past sales stay in reports.
          </p>
          <button
            type="button"
            autoFocus
            onClick={() => void remove()}
            disabled={busy}
            className="bg-red text-paper min-h-touch rounded px-4 font-medium"
          >
            Yes, remove it
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="border-line min-h-touch rounded border px-4"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setRefusal(null);
              setConfirming(true);
            }}
            className="border-line min-h-touch rounded border px-4"
          >
            Remove product
          </button>
        </div>
      )}
      {refusal ? (
        <div role="alert" className="text-sm">
          <p className="text-red">{refusal.message}</p>
          {refusal.blockedBy === 'stock' ? (
            <p className="mt-1 flex flex-wrap gap-x-4">
              <Link href="/stock/adjust" className="text-green-700 hover:underline">
                Remove the stock
              </Link>
              {canReplace ? (
                <Link
                  href={`/products/${productId}/replace`}
                  className="text-green-700 hover:underline"
                >
                  Replace it with the right product
                </Link>
              ) : null}
            </p>
          ) : refusal.blockedBy === 'pending' ? (
            <p className="mt-1 flex flex-wrap gap-x-4">
              <Link href="/purchases" className="text-green-700 hover:underline">
                Receive stock
              </Link>
              <Link href="/stock/adjust" className="text-green-700 hover:underline">
                Correct the count
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
