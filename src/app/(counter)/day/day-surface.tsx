'use client';

/**
 * Day & Reports surface — W10.
 *
 * Row shapes below mirror `src/db/reporting-queries.ts`'s return types but are
 * declared fresh rather than imported: a client component must never import
 * from a module that reaches the database, even for a type (Day 5's rule) —
 * the import is erased at compile time, but nothing in the toolchain can
 * verify that by reading the file, so the rule is "don't name the module".
 */

import { useState } from 'react';

import {
  CASH_REASONS,
  CASH_REASON_LABELS,
  directionFor,
  type CashDirection,
  type CashReason,
} from '@/domain/cash/cash-command';
import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';
import { uuidv7 } from '@/lib/uuid';
import type { BusinessDay } from '@/lib/business-day';

import { recordCashMovementAction } from './actions';

interface ThreeNumbers {
  salesPaisa: number;
  expectedCashPaisa: number;
  udhaarTotalPaisa: number;
}

interface ReportFigures {
  revenuePaisa: number;
  costPaisa: number;
  marginPaisa: number;
  saleCount: number;
  unitsSold: number;
  returnCount: number;
}

interface OverrideRow {
  saleLineId: string;
  receiptNumber: string;
  productName: string;
  unitPricePaisa: number;
  lineDiscountPaisa: number;
  priceOverridden: boolean;
  createdAt: Date;
}

interface ReturnExceptionRow {
  returnId: string;
  receiptNumber: string;
  saleReceiptNumber: string;
  cashOutPaisa: number;
  creditReducedPaisa: number;
  reasonNote: string | null;
  byName: string;
  createdAt: Date;
}

interface QuickItemRow {
  productId: string;
  name: string;
  createdAt: Date;
}

interface AdjustmentExceptionRow {
  id: string;
  productName: string;
  qtyBaseDelta: number;
  reason: string;
  note: string | null;
  byName: string;
  createdAt: Date;
}

interface CashMovementExceptionRow {
  id: string;
  direction: CashDirection;
  amountPaisa: number;
  reason: string;
  note: string | null;
  byName: string;
  createdAt: Date;
}

interface LateSyncedRow {
  kind: 'sale' | 'payment';
  id: string;
  receiptNumber: string;
  clientCommittedAt: Date;
  createdAt: Date;
}

export function DaySurface({
  day,
  today,
  view,
  numbers,
  figures,
  overrides,
  returns,
  quickItems,
  adjustments,
  cashMovements,
  lateSynced,
}: {
  day: BusinessDay;
  today: BusinessDay;
  view: 'daily' | 'overall';
  numbers: ThreeNumbers;
  figures: ReportFigures;
  overrides: OverrideRow[];
  returns: ReturnExceptionRow[];
  quickItems: QuickItemRow[];
  adjustments: AdjustmentExceptionRow[];
  cashMovements: CashMovementExceptionRow[];
  lateSynced: LateSyncedRow[];
}) {
  const exceptionCount =
    overrides.length +
    returns.length +
    quickItems.length +
    adjustments.length +
    cashMovements.length +
    lateSynced.length;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-green-900 text-2xl font-semibold">Day & Reports</h1>
        <nav className="ml-auto flex gap-1" aria-label="Report range">
          <a
            href={`/day?day=${day}&view=daily`}
            aria-current={view === 'daily' ? 'page' : undefined}
            className={[
              'rounded px-3 py-1 text-sm',
              view === 'daily' ? 'bg-green-100 text-green-900 font-medium' : 'text-ink/60',
            ].join(' ')}
          >
            Daily
          </a>
          <a
            href={`/day?day=${day}&view=overall`}
            aria-current={view === 'overall' ? 'page' : undefined}
            className={[
              'rounded px-3 py-1 text-sm',
              view === 'overall' ? 'bg-green-100 text-green-900 font-medium' : 'text-ink/60',
            ].join(' ')}
          >
            Overall
          </a>
        </nav>
      </header>

      {view === 'daily' ? (
        <div className="flex items-center gap-3">
          <label className="text-ink/60 text-sm" htmlFor="day-picker">
            Business day
          </label>
          <input
            id="day-picker"
            type="date"
            defaultValue={day}
            max={today}
            onChange={(event) => {
              if (event.target.value) {
                window.location.href = `/day?day=${event.target.value}&view=daily`;
              }
            }}
            className="border-line focus:border-green-600 h-touch rounded border px-3 outline-none"
          />
        </div>
      ) : null}

      {/* The three numbers, first — I6's huge-numerals treatment, the same
          promise the owner phone view (W11) makes. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumberCard label="Sales" amountPaisa={numbers.salesPaisa} />
        <NumberCard label="Expected cash in drawer" amountPaisa={numbers.expectedCashPaisa} />
        <NumberCard label="Running udhaar total" amountPaisa={numbers.udhaarTotalPaisa} amber />
      </div>

      <DrawerCount expectedCashPaisa={numbers.expectedCashPaisa} />

      <CashMovementForm />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FigureCard label="Revenue" amountPaisa={figures.revenuePaisa} />
        <FigureCard label="Margin" amountPaisa={figures.marginPaisa} />
        <FigureCard label="Sale count" value={figures.saleCount} />
        <FigureCard label="Units sold" value={figures.unitsSold} />
      </div>

      <div>
        <h2 className="text-green-900 mb-2 font-medium">
          Exceptions
          <span className="text-ink/50 ml-2 text-sm font-normal">{exceptionCount}</span>
        </h2>

        {exceptionCount === 0 ? (
          <p className="text-ink/50 text-sm">Nothing exceptional today.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <ExceptionGroup title="Discounts and overrides" rows={overrides} empty={false}>
              {overrides.map((row) => (
                <Row key={row.saleLineId}>
                  <span className="font-medium">{row.productName}</span>
                  <span className="text-ink/60 ml-2">{row.receiptNumber}</span>
                  {row.priceOverridden ? (
                    <span className="text-amber ml-2 text-xs">price changed</span>
                  ) : null}
                  {row.lineDiscountPaisa > 0 ? (
                    <span className="numeral text-amber ml-auto">
                      -{formatPaisa(paisa(row.lineDiscountPaisa))}
                    </span>
                  ) : null}
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Returns" rows={returns} empty={false}>
              {returns.map((row) => (
                <Row key={row.returnId}>
                  <span className="font-medium">{row.receiptNumber}</span>
                  <span className="text-ink/60 ml-2">for {row.saleReceiptNumber}</span>
                  <span className="numeral text-amber ml-auto">
                    -{formatPaisa(paisa(row.cashOutPaisa + row.creditReducedPaisa))}
                  </span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Quick items" rows={quickItems} empty={false}>
              {quickItems.map((row) => (
                <Row key={row.productId}>
                  <span className="font-medium">{row.name}</span>
                  <span className="text-ink/50 ml-auto text-xs">needs completing</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Adjustments" rows={adjustments} empty={false}>
              {adjustments.map((row) => (
                <Row key={row.id}>
                  <span className="font-medium">{row.productName}</span>
                  <span
                    className={`numeral ml-2 ${row.qtyBaseDelta < 0 ? 'text-amber' : 'text-green-900'}`}
                  >
                    {row.qtyBaseDelta > 0 ? '+' : ''}
                    {row.qtyBaseDelta}
                  </span>
                  <span className="text-ink/60 ml-2">{row.reason.replaceAll('_', ' ')}</span>
                  <span className="text-ink/40 ml-auto text-xs">{row.byName}</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Cash movements" rows={cashMovements} empty={false}>
              {cashMovements.map((row) => (
                <Row key={row.id}>
                  <span className="font-medium">{CASH_REASON_LABELS[row.reason as CashReason]}</span>
                  <span
                    className={`numeral ml-2 ${row.direction === 'out' ? 'text-amber' : 'text-green-900'}`}
                  >
                    {row.direction === 'in' ? '+' : '-'}
                    {formatPaisa(paisa(row.amountPaisa))}
                  </span>
                  {row.note ? <span className="text-ink/50 ml-2 text-xs">“{row.note}”</span> : null}
                  <span className="text-ink/40 ml-auto text-xs">{row.byName}</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Synced late" rows={lateSynced} empty={false}>
              {lateSynced.map((row) => (
                <Row key={row.id}>
                  <span className="font-medium">{row.receiptNumber}</span>
                  <span className="text-ink/60 ml-2">{row.kind}</span>
                  <span className="text-ink/40 ml-auto text-xs">
                    recorded {row.clientCommittedAt.toLocaleTimeString('en-PK')}, synced{' '}
                    {row.createdAt.toLocaleTimeString('en-PK')}
                  </span>
                </Row>
              ))}
            </ExceptionGroup>
          </div>
        )}
      </div>
    </section>
  );
}

function ExceptionGroup<T>({
  title,
  rows,
  children,
}: {
  title: string;
  rows: T[];
  empty: boolean;
  children: React.ReactNode;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="text-ink/70 mb-1 text-sm font-medium">
        {title} <span className="text-ink/40">({rows.length})</span>
      </h3>
      <ul className="border-line divide-line divide-y rounded border text-sm">{children}</ul>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex flex-wrap items-baseline gap-1 px-3 py-2">{children}</li>;
}

function NumberCard({
  label,
  amountPaisa,
  amber = false,
}: {
  label: string;
  amountPaisa: number;
  amber?: boolean;
}) {
  return (
    <div className="border-line rounded border p-4">
      <p className="text-ink/60 text-xs tracking-[0.1em] uppercase">{label}</p>
      <p
        className={`numeral mt-1 text-3xl font-semibold ${amber ? 'text-amber' : 'text-green-900'}`}
      >
        {formatPaisa(paisa(amountPaisa), { withSymbol: true })}
      </p>
    </div>
  );
}

function FigureCard({
  label,
  amountPaisa,
  value,
}: {
  label: string;
  amountPaisa?: number;
  value?: number;
}) {
  return (
    <div className="border-line rounded border p-3">
      <p className="text-ink/60 text-xs tracking-[0.08em] uppercase">{label}</p>
      <p className="numeral text-green-900 mt-1 text-xl font-semibold">
        {amountPaisa !== undefined ? formatPaisa(paisa(amountPaisa)) : value}
      </p>
    </div>
  );
}

/** W10's ritual: count the drawer, record what it says against the expected figure. */
function DrawerCount({ expectedCashPaisa }: { expectedCashPaisa: number }) {
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const countedPaisa = Math.round(Number(counted || '0') * 100);
  const differencePaisa = countedPaisa - expectedCashPaisa;

  async function record(): Promise<void> {
    if (differencePaisa === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);

    const outcome = await recordCashMovementAction({
      movementId: uuidv7(),
      direction: differencePaisa > 0 ? 'in' : 'out',
      amountPaisa: Math.abs(differencePaisa),
      reason: 'over_short',
      note: `Counted ${formatPaisa(paisa(countedPaisa))} against an expected ${formatPaisa(paisa(expectedCashPaisa))}`,
    });

    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setDone('Recorded. The ritual is closed — nothing else locks (D5).');
    setCounted('');
  }

  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Count the drawer</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="drawer-counted">
            What&rsquo;s actually in the drawer
          </label>
          <input
            id="drawer-counted"
            value={counted}
            inputMode="decimal"
            onChange={(event) => {
              setCounted(event.target.value);
              setDone(null);
            }}
            className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
          />
        </div>
        {counted !== '' ? (
          <p className={`text-sm ${differencePaisa === 0 ? 'text-green-900' : 'text-amber'}`}>
            {differencePaisa === 0
              ? 'Matches exactly.'
              : `${differencePaisa > 0 ? 'Over' : 'Short'} by ${formatPaisa(paisa(Math.abs(differencePaisa)))}`}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void record()}
          disabled={busy || counted === '' || differencePaisa === 0}
          className="bg-green-600 text-paper min-h-touch ml-auto rounded px-5 font-medium disabled:opacity-40"
        >
          {busy ? 'Recording…' : 'Record over/short'}
        </button>
      </div>
      {error ? (
        <p className="text-red mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-green-900 mt-2 text-sm" role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}

/** Opening float, a withdrawal, or an expense — the other three cash reasons. */
function CashMovementForm() {
  const [reason, setReason] = useState<CashReason>('opening_float');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const otherReasons = CASH_REASONS.filter((candidate) => candidate !== 'over_short');
  const direction = directionFor(reason);

  async function record(): Promise<void> {
    const amountPaisa = Math.round(Number(amount || '0') * 100);
    if (amountPaisa <= 0 || busy || direction === null) {
      return;
    }
    setBusy(true);
    setError(null);

    const outcome = await recordCashMovementAction({
      movementId: uuidv7(),
      direction,
      amountPaisa,
      reason,
      note: note.trim() === '' ? null : note.trim(),
    });

    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setDone('Saved.');
    setAmount('');
    setNote('');
  }

  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Record a cash movement</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="movement-reason">
            Reason
          </label>
          <select
            id="movement-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as CashReason);
              setDone(null);
            }}
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          >
            {otherReasons.map((candidate) => (
              <option key={candidate} value={candidate}>
                {CASH_REASON_LABELS[candidate]}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="movement-amount">
            Amount
          </label>
          <input
            id="movement-amount"
            value={amount}
            inputMode="decimal"
            onChange={(event) => {
              setAmount(event.target.value);
              setDone(null);
            }}
            className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
          />
        </div>
        <div className="min-w-48 flex-1">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="movement-note">
            Note (optional)
          </label>
          <input
            id="movement-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void record()}
          disabled={busy || Math.round(Number(amount || '0') * 100) <= 0}
          className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? (
        <p className="text-red mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-green-900 mt-2 text-sm" role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}
