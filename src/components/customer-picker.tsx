'use client';

/**
 * The customer picker — W2's "seconds" requirement.
 *
 *   "New-customer-inline is mandatory: udhaar is extended mid-rush, not
 *    pre-registered." And T4: a balance is shown before more credit is
 *    extended, not after.
 *
 * One component serves both places a customer needs picking: attaching one to
 * a sale (F8 with items in the cart, W2) and finding one to settle (F8 on an
 * empty cart, W3). Type-ahead first; a name that matches nothing offers
 * "Add <name>" as the natural next step rather than a separate form.
 */

import { useEffect, useRef, useState } from 'react';

import { searchCustomersAction, createCustomerAction, type CustomerHit } from '@/app/(counter)/customers/actions';
import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';

export function CustomerPicker({
  title = 'Customer',
  onPick,
  onCancel,
}: {
  /** Distinguishes the attach-to-sale (W2) and settle (W3) contexts on screen. */
  title?: string;
  onPick: (customer: CustomerHit) => void;
  onCancel: () => void;
}) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === '') {
      return;
    }
    let cancelled = false;
    void searchCustomersAction(trimmed).then((result) => {
      if (!cancelled) {
        setHits(result);
        setActive(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [term]);

  // Cleared by re-deriving rather than by resetting `hits` in the effect above
  // (that would be a synchronous setState-in-effect — a stale list from a
  // previous term never renders, it just never gets asked for).
  const visibleHits = term.trim() === '' ? [] : hits;

  async function createInline(): Promise<void> {
    const name = term.trim();
    if (name === '' || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createCustomerAction({ name, phone: null });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onPick(result.customer);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      onCancel();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, visibleHits.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = visibleHits[active];
      if (hit) {
        onPick(hit);
      } else {
        void createInline();
      }
    }
  }

  return (
    <div
      className="bg-ink/40 fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-paper w-full max-w-sm rounded-lg p-5 shadow-xl">
        <h2 className="text-green-900 mb-4 text-lg font-semibold">{title}</h2>

        <input
          ref={field}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          placeholder="Name or phone…"
          className="border-line focus:border-green-600 h-touch w-full rounded border px-3 text-lg outline-none"
        />

        <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-auto" role="listbox">
          {visibleHits.map((hit, index) => (
            <li key={hit.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onClick={() => {
                  onPick(hit);
                }}
                onMouseEnter={() => {
                  setActive(index);
                }}
                className={[
                  'flex min-h-touch w-full items-center justify-between rounded px-3 text-left',
                  index === active ? 'bg-green-100' : 'hover:bg-green-100/50',
                ].join(' ')}
              >
                <span>
                  <span className="font-medium">{hit.name}</span>
                  {hit.phone ? <span className="text-ink/50 ml-2 text-xs">{hit.phone}</span> : null}
                </span>
                {/* T4 — the balance is shown before more credit gets extended. */}
                <span className={`numeral text-sm ${hit.balancePaisa > 0 ? 'text-amber' : 'text-ink/50'}`}>
                  {formatPaisa(paisa(hit.balancePaisa))}
                </span>
              </button>
            </li>
          ))}

          {term.trim() !== '' ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  void createInline();
                }}
                disabled={busy}
                className="text-green-600 hover:bg-green-100/50 min-h-touch w-full rounded px-3 text-left font-medium disabled:opacity-40"
              >
                {busy ? 'Adding…' : `+ Add “${term.trim()}” as a new customer`}
              </button>
            </li>
          ) : null}
        </ul>

        {error ? (
          <p className="text-red mt-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={onCancel} className="text-ink/60 text-sm">
            Esc to cancel
          </button>
        </div>
      </div>
    </div>
  );
}
