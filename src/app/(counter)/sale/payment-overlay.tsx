'use client';

/**
 * The payment overlay — Phase 10 §4.
 *
 *   "F12/Space opens the payment overlay: amount tendered (defaults to exact),
 *    change rendered enormous. A customer attached splits cash/credit; nothing
 *    attached means the whole shortfall has nowhere to go, so it is refused
 *    the same way the domain refuses it (`credit_without_customer`) rather
 *    than silently discounting the sale."
 *
 * Enter commits, Esc returns to the cart — no other path out.
 */

import { useEffect, useRef, useState } from 'react';

import { paisaFromRupeeInput, splitPayment } from '@/domain/sales/cart';
import { keyFor } from '@/client/keyboard/registry';
import { needsClickToCommit } from '@/client/scan/amount-guard';
import { formatPaisa } from '@/lib/money';
import type { Paisa } from '@/lib/branded';

export interface PaymentSplit {
  cashPaisa: Paisa;
  creditPaisa: Paisa;
  changePaisa: Paisa;
  tenderedPaisa: Paisa;
}

export function PaymentOverlay({
  totalPaisa,
  customerName,
  busy,
  onCancel,
  onCommit,
}: {
  totalPaisa: Paisa;
  customerName: string | null;
  busy: boolean;
  onCancel: () => void;
  onCommit: (split: PaymentSplit) => void;
}) {
  const [tenderedInput, setTenderedInput] = useState(() => (totalPaisa / 100).toFixed(2));
  const field = useRef<HTMLInputElement>(null);
  /** Why Enter did not commit: an amount too large to be cash (see amount-guard). */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const tenderedPaisa = paisaFromRupeeInput(tenderedInput);
  const split = splitPayment(totalPaisa, tenderedPaisa);
  const short = split.creditPaisa > 0;
  const canCommit = !short || customerName !== null;

  function commit(): void {
    if (!canCommit || busy) {
      return;
    }
    onCommit({ ...split, tenderedPaisa });
  }

  return (
    <div
      className="bg-ink/40 fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Payment"
    >
      <div className="bg-paper w-full max-w-sm rounded-lg p-5 shadow-xl">
        <h2 className="text-green-900 mb-4 text-lg font-semibold">Payment</h2>

        <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Amount Due</p>
        <p className="text-green-900 numeral text-total leading-none font-semibold">
          {formatPaisa(totalPaisa)}
        </p>

        {customerName ? (
          <p className="text-ink/50 mt-1 text-sm">Billing to {customerName}</p>
        ) : null}

        <label className="text-ink/60 mt-4 mb-1 block text-xs" htmlFor="tendered">
          Cash tendered
        </label>
        <input
          id="tendered"
          ref={field}
          value={tenderedInput}
          inputMode="decimal"
          onChange={(event) => {
            setTenderedInput(event.target.value);
            setNotice(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (needsClickToCommit(tenderedPaisa)) {
                setNotice(
                  `${formatPaisa(tenderedPaisa, { withSymbol: true })} tendered looks like a barcode. If it is right, click Commit.`,
                );
                return;
              }
              commit();
            }
            if (event.key === 'Escape') {
              onCancel();
            }
          }}
          className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 text-2xl outline-none"
        />

        {notice ? (
          <p className="text-red mt-2 text-sm" role="alert">
            {notice}
          </p>
        ) : null}

        {split.changePaisa > 0 ? (
          <div className="mt-3 text-center">
            <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Change</p>
            {/* Phase 10 §4: change rendered enormous. */}
            <p className="text-green-900 numeral text-change leading-none font-semibold">
              {formatPaisa(split.changePaisa)}
            </p>
          </div>
        ) : null}

        {/* The same calculator, the other direction: tendering less than the
            total shows the shortfall immediately, so the cashier never reaches
            for a separate calculator to know what is short before deciding
            what to do about it (attach a customer, or ask for more cash). */}
        {short ? (
          <div className="mt-3 text-center">
            <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Remaining</p>
            <p className="text-amber numeral text-change leading-none font-semibold">
              {formatPaisa(split.creditPaisa)}
            </p>
          </div>
        ) : null}

        {short ? (
          customerName ? (
            <p className="text-amber mt-3 text-sm">
              {formatPaisa(split.creditPaisa)} goes on {customerName}’s udhaar.
            </p>
          ) : (
            <p className="text-red mt-3 text-sm" role="alert">
              Attach a customer ({keyFor('udhaar')}) to put the rest on udhaar.
            </p>
          )
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={onCancel} className="text-ink/60 text-sm">
            Esc to cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!canCommit || busy}
            className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Commit — Enter'}
          </button>
        </div>
      </div>
    </div>
  );
}
