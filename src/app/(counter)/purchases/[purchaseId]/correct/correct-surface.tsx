'use client';

/**
 * [PCN-009] The two forms behind "Correct or return…" — one line at a time.
 *
 * A correction asks for what the line SHOULD have said, pre-filled with what it
 * says now, so fixing a typo is changing one field. A return pre-fills the
 * credit at the batch's effective cost; the supplier decides the real credit,
 * and the operator types what they gave.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { paisaFromRupeeInput } from '@/domain/sales/cart';
import { defaultReturnCreditPaisa } from '@/domain/suppliers/supplier-return';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity } from '@/lib/quantity';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { correctPurchaseLineAction, returnToSupplierAction } from './actions';

/** Declared here, not imported from `src/db` (CLAUDE.md, Day 6/7). */
export interface CorrectableLineView {
  lineId: string;
  batchId: string;
  productName: string;
  baseUnitName: string;
  packLevels: { name: string; factor: number }[];
  qtyBase: number;
  bonusQtyBase: number;
  unitCostPaisa: number;
  onHandBase: number;
  effectiveUnitCostPaisa: number;
  expiryDate: string | null;
}

type Open = { lineId: string; mode: 'correct' | 'return'; key: Uuid } | null;

const rupees = (value: number) => (value / 100).toFixed(2);

/*
 * Blank is never zero. `Number('')` is 0 and an unreadable amount parses to
 * Rs 0, so a cleared field would otherwise record "nothing arrived" or "it was
 * free" — the same trap the purchase entry screen refuses (type 0 to mean 0).
 */
const WHOLE = /^\d+$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

export function CorrectSurface({
  lines,
  supplierName,
}: {
  lines: CorrectableLineView[];
  supplierName: string | null;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {done ? (
        <p className="text-green-900 text-sm" role="status">
          {done}
        </p>
      ) : null}
      <ul className="border-line divide-line divide-y rounded border">
        {lines.map((line) => (
          <li key={line.lineId} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{line.productName}</span>
              <span className="text-ink/60 text-sm">
                {describeQuantity(baseQty(line.qtyBase), line.baseUnitName, line.packLevels)}
                {line.bonusQtyBase > 0
                  ? ` + ${line.bonusQtyBase} ${line.baseUnitName} bonus`
                  : ''}{' '}
                at {formatPaisa(paisa(line.unitCostPaisa))} / {line.baseUnitName}
              </span>
              <span className="text-ink/50 text-xs">
                {line.onHandBase} {line.baseUnitName} on hand
                {line.expiryDate ? ` · exp ${line.expiryDate}` : ''}
              </span>
              <span className="ml-auto flex gap-3 text-sm">
                <button
                  type="button"
                  className="text-green-700 hover:underline"
                  onClick={() => {
                    setDone(null);
                    setOpen({ lineId: line.lineId, mode: 'correct', key: uuidv7() });
                  }}
                >
                  Correct this line
                </button>
                <button
                  type="button"
                  className="text-green-700 hover:underline disabled:opacity-40"
                  disabled={supplierName === null || line.onHandBase === 0}
                  onClick={() => {
                    setDone(null);
                    setOpen({ lineId: line.lineId, mode: 'return', key: uuidv7() });
                  }}
                >
                  Return to supplier
                </button>
              </span>
            </div>
            {open?.lineId === line.lineId && open.mode === 'correct' ? (
              <CorrectionForm
                key={open.key}
                line={line}
                correctionId={open.key}
                onDone={(message) => {
                  setOpen(null);
                  setDone(message);
                }}
              />
            ) : null}
            {open?.lineId === line.lineId && open.mode === 'return' && supplierName ? (
              <ReturnForm
                key={open.key}
                line={line}
                returnId={open.key}
                supplierName={supplierName}
                onDone={(message) => {
                  setOpen(null);
                  setDone(message);
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {supplierName === null ? (
        <p className="text-ink/60 text-xs">
          This invoice has no supplier, so goods from it cannot be returned for credit. Use a
          distributor-return adjustment on the Adjust screen instead.
        </p>
      ) : null}
    </div>
  );
}

const fieldClass =
  'border-line focus:border-green-600 h-touch mt-1 w-full rounded border px-3 outline-none';

function CorrectionForm({
  line,
  correctionId,
  onDone,
}: {
  line: CorrectableLineView;
  correctionId: Uuid;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(line.qtyBase));
  const [bonus, setBonus] = useState(String(line.bonusQtyBase));
  const [cost, setCost] = useState(rupees(line.unitCostPaisa));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (busy) return;
    if (!WHOLE.test(qty.trim()) || !WHOLE.test(bonus.trim())) {
      setError('Enter quantities as whole numbers — type 0 to mean none.');
      return;
    }
    if (!AMOUNT.test(cost.trim())) {
      setError('Enter the unit cost in rupees, like 12.50 — type 0 if it was free.');
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await correctPurchaseLineAction({
      correctionId,
      purchaseLineId: line.lineId,
      qtyBase: Number(qty.trim()),
      bonusQtyBase: Number(bonus.trim()),
      unitCostPaisa: paisaFromRupeeInput(cost),
      note,
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    router.refresh();
    onDone(`${line.productName}: correction recorded.`);
  }

  return (
    <form
      aria-label={`Correct ${line.productName}`}
      className="bg-green-100/40 grid grid-cols-2 gap-3 rounded p-3 sm:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="text-ink/70 text-xs">
        Quantity ({line.baseUnitName})
        <input
          autoFocus
          inputMode="numeric"
          value={qty}
          onChange={(event) => setQty(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="text-ink/70 text-xs">
        Bonus ({line.baseUnitName})
        <input
          inputMode="numeric"
          value={bonus}
          onChange={(event) => setBonus(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="text-ink/70 text-xs">
        Unit cost (Rs per {line.baseUnitName})
        <input
          inputMode="decimal"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
          className={`${fieldClass} numeral`}
        />
      </label>
      <label className="text-ink/70 text-xs">
        Why
        <input
          value={note}
          placeholder="e.g. cost typed wrong"
          onChange={(event) => setNote(event.target.value)}
          className={fieldClass}
        />
      </label>
      <div className="col-span-full flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Record correction — Enter'}
        </button>
        {error ? (
          <p className="text-red text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function ReturnForm({
  line,
  returnId,
  supplierName,
  onDone,
}: {
  line: CorrectableLineView;
  returnId: Uuid;
  supplierName: string;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [qty, setQty] = useState('');
  const [credit, setCredit] = useState('');
  const [creditTouched, setCreditTouched] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qtyNumber = Number(qty);
  const suggested =
    Number.isInteger(qtyNumber) && qtyNumber > 0
      ? rupees(defaultReturnCreditPaisa(qtyNumber, line.effectiveUnitCostPaisa))
      : '';
  const creditShown = creditTouched ? credit : suggested;

  async function save(): Promise<void> {
    if (busy) return;
    if (!WHOLE.test(qty.trim()) || qtyNumber <= 0) {
      setError('Enter how many units are going back, as a whole number.');
      return;
    }
    if (!AMOUNT.test(creditShown.trim())) {
      setError('Enter the credit in rupees, like 450.00 — type 0 if there is none.');
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await returnToSupplierAction({
      returnId,
      batchId: line.batchId,
      qtyBase: qtyNumber,
      creditPaisa: paisaFromRupeeInput(creditShown),
      note,
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    router.refresh();
    onDone(`${line.productName}: return to ${supplierName} recorded.`);
  }

  return (
    <form
      aria-label={`Return ${line.productName} to ${supplierName}`}
      className="bg-green-100/40 grid grid-cols-2 gap-3 rounded p-3 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="text-ink/70 text-xs">
        Quantity going back ({line.baseUnitName}, up to {line.onHandBase})
        <input
          autoFocus
          inputMode="numeric"
          value={qty}
          onChange={(event) => setQty(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="text-ink/70 text-xs">
        Credit from {supplierName} (Rs)
        <input
          inputMode="decimal"
          value={creditShown}
          onChange={(event) => {
            setCreditTouched(true);
            setCredit(event.target.value);
          }}
          className={`${fieldClass} numeral`}
        />
      </label>
      <label className="text-ink/70 text-xs">
        Note
        <input
          value={note}
          placeholder="e.g. near expiry"
          onChange={(event) => setNote(event.target.value)}
          className={fieldClass}
        />
      </label>
      <div className="col-span-full flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Record return — Enter'}
        </button>
        {error ? (
          <p className="text-red text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
