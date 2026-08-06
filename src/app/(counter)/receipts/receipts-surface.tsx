'use client';

/**
 * The receipts list.
 *
 * Every row is a link. That sounds obvious and was the actual complaint: the
 * product was full of tables listing things that had happened with no way to
 * open any of them, so a number on screen was a dead end and the only route to
 * detail ran through a workflow that could change something.
 *
 * The shapes are redeclared rather than imported from `src/db/receipt-queries`
 * — Day 7's rule, and the "types are erased anyway" argument is exactly the one
 * it exists to refuse.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

type ReceiptKind = 'sale' | 'settlement' | 'return';

interface Row {
  receiptNumber: string;
  kind: ReceiptKind;
  customerName: string | null;
  salesmanName: string;
  amountPaisa: number;
  createdAt: Date;
  onCredit: boolean;
  hasReturns: boolean;
}

/**
 * I7: a colour means one thing. A return is money leaving, which is the only
 * row here that ever needs a second look, so it is the only one that carries
 * a tone.
 */
function kindLabel(kind: ReceiptKind): { text: string; className: string } {
  switch (kind) {
    case 'sale':
      return { text: 'Sale', className: 'text-ink/60' };
    case 'settlement':
      return { text: 'Payment', className: 'text-green-700' };
    case 'return':
      return { text: 'Return', className: 'text-amber' };
  }
}

export function ReceiptsSurface({
  rows,
  search,
  hasMore,
}: {
  rows: Row[];
  search: string;
  hasMore: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(search);
  const field = useRef<HTMLInputElement>(null);
  /**
   * Set the moment a result is opened, to suppress a search sync that has not
   * fired yet. See the effect below.
   */
  const leaving = useRef(false);

  useEffect(() => {
    field.current?.focus();
  }, []);

  /*
   * Debounced rather than submit-on-Enter, because the commonest use is
   * holding a printed slip and typing the number off it — the list should be
   * narrowing while you type, the same way the counter's product search does
   * (I2). Enter is left free to open the top result.
   */
  useEffect(() => {
    if (term === search) return;
    const timer = window.setTimeout(() => {
      /*
       * Do not overwrite a navigation the operator has already started.
       *
       * The sync and a row click are two navigations racing: typing a receipt
       * number schedules a `replace` 200ms out, and clicking the result within
       * that window pushes the detail page — then the replace lands on top and
       * puts them straight back on the list. Typing a number off a slip and
       * clicking it immediately is not an unusual thing to do; it is the
       * fastest way to use this screen, so it was the path most likely to
       * break. Found by the E2E suite, which had never been run.
       */
      if (leaving.current) return;
      const next = new URLSearchParams(params.toString());
      if (term.trim() === '') next.delete('q');
      else next.set('q', term.trim());
      router.replace(`/receipts${next.toString() ? `?${next}` : ''}`);
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [term, search, params, router]);

  /** Every route out of this screen goes through here. */
  function open(receiptNumber: string): void {
    leaving.current = true;
    router.push(`/receipts/${encodeURIComponent(receiptNumber)}`);
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-green-900 text-2xl font-semibold">Receipts</h1>
          <p className="text-ink/60 text-sm">
            Every sale, payment and return. Open one to see what it contained.
          </p>
        </div>

        {/* Returns keeps its own door, for the customer who arrives with goods
            and no slip. The usual route is the other way round — open the
            receipt, then start the return from it — but a workflow reachable
            only from a record nobody can find is not reachable (Day 8). */}
        <Link
          href="/returns"
          className="border-line min-h-touch text-ink hover:bg-green-100/50 inline-flex items-center rounded border px-4 text-sm font-medium"
        >
          Return without a receipt
        </Link>
      </header>

      <input
        ref={field}
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
        }}
        onKeyDown={(event) => {
          // Enter opens the top result — the slip-in-hand path, end to end,
          // without reaching for the mouse.
          if (event.key === 'Enter' && rows[0]) {
            open(rows[0].receiptNumber);
          }
        }}
        placeholder="Receipt number or customer name"
        aria-label="Find a receipt"
        className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
      />

      {rows.length === 0 ? (
        <p className="text-ink/50 p-8 text-center text-sm">
          {search === '' ? 'No receipts yet.' : `Nothing matching “${search}”.`}
        </p>
      ) : (
        <div className="border-line overflow-x-auto rounded border">
          <table className="text-table w-full text-left">
            <thead className="bg-green-100/50 text-ink/60 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Receipt</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">By</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const kind = kindLabel(row.kind);
                return (
                  <tr key={`${row.kind}-${row.receiptNumber}`} className="border-line border-t">
                    <td className="px-3 py-2">
                      {/* The link is on the receipt number rather than the whole
                          row: a row-wide click target cannot be reached by
                          keyboard, and this product is keyboard-first. */}
                      <Link
                        href={`/receipts/${encodeURIComponent(row.receiptNumber)}`}
                        onClick={() => {
                          // Cancels the pending search sync — see the effect.
                          leaving.current = true;
                        }}
                        className="numeral text-green-700 font-medium hover:underline"
                      >
                        {row.receiptNumber}
                      </Link>
                    </td>
                    <td className="text-ink/70 px-3 py-2 text-sm">
                      {row.createdAt.toLocaleString('en-PK', {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className={`px-3 py-2 text-sm ${kind.className}`}>
                      {kind.text}
                      {row.onCredit ? (
                        <span className="text-ink/50 ml-1 text-xs">udhaar</span>
                      ) : null}
                    </td>
                    <td className="text-ink/70 px-3 py-2">{row.customerName ?? '—'}</td>
                    <td className="text-ink/50 px-3 py-2 text-sm">{row.salesmanName}</td>
                    <td className="numeral px-3 py-2 text-right">
                      {formatPaisa(paisa(row.amountPaisa), { withSymbol: true })}
                      {/* Stated on the sale, not only on the return, because
                          the question "was any of this brought back?" is asked
                          of the sale. */}
                      {row.hasReturns ? (
                        <span className="text-amber ml-1 text-xs">returned</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMore ? (
        <p className="text-ink/50 text-center text-xs">
          Showing the most recent {rows.length}. Search to narrow.
        </p>
      ) : null}
    </section>
  );
}
