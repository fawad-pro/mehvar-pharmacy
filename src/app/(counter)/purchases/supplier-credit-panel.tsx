'use client';

/**
 * [PCN-007] Owed to suppliers — the payable mirror of the customers-owing list.
 *
 * "Money customers owe us" has had a home since Day 4; "money we owe our
 * distributors" had none, so a pharmacy running on supplier credit could not
 * answer the one question that decides whether it can take the next delivery.
 * This panel is that answer, and the place the shop marks a payment made.
 *
 * Refreshes when a purchase commits (a received invoice on credit adds to what
 * is owed) and after each settlement, so the figure here and the Day screen's
 * "Owed to suppliers" never disagree.
 *
 * Row shape is declared here, not imported: a client component must never name
 * a module that reaches the database (the rule recorded on Day 4/Day 6).
 */

import { useCallback, useEffect, useState } from 'react';

import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';
import type { Uuid } from '@/lib/uuid';

import { settleSupplierAction, suppliersOwedAction } from './actions';

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}

export function SupplierCreditPanel({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<SupplierRow[] | null>(null);
  const [bump, setBump] = useState(0);

  const load = useCallback(() => {
    void suppliersOwedAction()
      .then(setRows)
      .catch(() => {
        // Offline (ADR-3): purchases and their payments need the server, so the
        // list of what is owed does too. Silence is right.
      });
  }, []);

  useEffect(load, [load, reloadKey, bump]);

  if (rows === null || rows.length === 0) {
    // Nothing owed is the common, healthy state; a panel that always shows would
    // just be an empty box on the busy Purchases screen. Absent is the answer.
    return null;
  }

  const total = rows.reduce((sum, row) => sum + row.balancePaisa, 0);

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="text-green-900 font-medium">Owed to suppliers</h2>
        <span className="text-amber numeral font-semibold">
          {formatPaisa(paisa(total), { withSymbol: true })}
        </span>
      </div>
      <ul className="border-line divide-line divide-y rounded border text-sm">
        {rows.map((row) => (
          <SupplierCreditRow
            key={row.id}
            row={row}
            onSettled={() => {
              setBump((n) => n + 1);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function SupplierCreditRow({
  row,
  onSettled,
}: {
  row: SupplierRow;
  onSettled: () => void;
}) {
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function settle(): Promise<void> {
    const amountPaisa = Math.round(Number(amount || '0') * 100);
    if (amountPaisa <= 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);

    const outcome = await settleSupplierAction({
      supplierId: row.id as Uuid,
      amountPaisa,
      note: null,
    }).catch(() => ({
      ok: false as const,
      message: 'Needs internet — try again when the connection is back.',
    }));

    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setPaying(false);
    setAmount('');
    onSettled();
  }

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{row.name}</span>
        {row.phone ? <span className="text-ink/50 text-xs">{row.phone}</span> : null}
        <span className="numeral text-amber ml-auto font-medium">
          {formatPaisa(paisa(row.balancePaisa), { withSymbol: true })}
        </span>
        <button
          type="button"
          onClick={() => {
            setPaying((open) => !open);
            setAmount(paying ? '' : (row.balancePaisa / 100).toString());
            setError(null);
          }}
          className="text-green-600 text-xs font-medium underline-offset-2 hover:underline"
        >
          {paying ? 'Cancel' : 'Pay'}
        </button>
      </div>

      {paying ? (
        <div
          className="mt-2 flex flex-wrap items-end gap-2"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void settle();
            }
          }}
        >
          <div className="w-36">
            <label className="text-ink/60 mb-1 block text-xs" htmlFor={`pay-${row.id}`}>
              Amount paid
            </label>
            <input
              id={`pay-${row.id}`}
              value={amount}
              inputMode="decimal"
              autoFocus
              onChange={(event) => {
                setAmount(event.target.value);
              }}
              className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void settle()}
            disabled={busy || Math.round(Number(amount || '0') * 100) <= 0}
            className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Record payment'}
          </button>
          {error ? (
            <p className="text-red text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
