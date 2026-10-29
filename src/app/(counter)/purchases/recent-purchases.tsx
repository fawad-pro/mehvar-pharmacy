'use client';

/**
 * What has been received lately — the other half of W7.
 *
 * "Received — 2 batches on the shelf" was the whole record an owner ever saw
 * of a delivery: a sentence that scrolled away. The invoice they reconcile
 * against, and the question that follows a week later ("what did we take from
 * Bilal this month, and what did we pay?"), had nowhere to land even though
 * the rows were being written correctly all along.
 *
 * Refreshes when a purchase commits, so the entry form's confirmation and this
 * list are never telling different stories.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { CardTitle, cardClass } from '@/components/ui/card';
import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';

import Link from 'next/link';

import { recentPurchasesAction } from './actions';

/** Mirrors `PurchaseListItem`; declared here rather than imported, because a
 * client component must never name a module that reaches the database. */
interface PurchaseRow {
  id: string;
  supplierName: string | null;
  invoiceRef: string | null;
  invoiceDate: string | null;
  createdAt: Date;
  lineCount: number;
  totalCostPaisa: number;
}

export function RecentPurchases({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);

  // The latest request's answer wins; see `SupplierCreditPanel`.
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    void recentPurchasesAction()
      .then((answer) => {
        if (mine === latest.current) setRows(answer);
      })
      .catch(() => {
        // Offline (ADR-3): receiving needs the server, so a list of what was
        // received does too. Silence is right — the entry form above still
        // works and says so itself.
      });
  }, []);

  useEffect(load, [load, reloadKey]);

  return (
    <section aria-label="Recent deliveries" className={cardClass}>
      <CardTitle>Recent deliveries</CardTitle>
      {rows === null ? (
        <p className="text-body-sm text-ink-2 m-0">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-body-sm text-ink-2 m-0">Nothing received yet.</p>
      ) : (
        <ul className="divide-line text-body-sm -mx-5 m-0 list-none divide-y p-0">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 px-5">
              {/* Was a dead end: a supplier, a date and a total with nothing
                  behind them, so "what actually came in?" had no answer. The
                  invoice is a record you can open now, like a receipt. */}
              <Link
                href={`/purchases/${row.id}`}
                className="text-blue-600 inline-flex min-h-touch items-center font-medium hover:underline"
              >
                {row.supplierName ?? 'No supplier'}
              </Link>
              {row.invoiceRef ? <span className="text-ink-2">invoice {row.invoiceRef}</span> : null}
              <span className="text-ink-2">
                {row.invoiceDate
                  ? row.invoiceDate.split('-').reverse().join('/')
                  : new Date(row.createdAt).toLocaleDateString('en-PK')}
              </span>
              <span className="text-ink-2 ml-auto">
                {row.lineCount} line{row.lineCount === 1 ? '' : 's'}
              </span>
              <span className="numeral w-28 font-medium">
                {formatPaisa(paisa(row.totalCostPaisa), { withSymbol: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
