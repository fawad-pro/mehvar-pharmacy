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

import { NO_ANSWER } from '@/components/load-failed';
import { paisaFromRupeeInput } from '@/domain/sales/cart';
import { defaultReturnCreditPaisa } from '@/domain/suppliers/supplier-return';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity, levelToBaseUnits } from '@/lib/quantity';
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
  /** [PCN-012] The unit the line was bought in, and its size; the base unit, 1, on an older line. */
  unitName: string;
  factor: number;
  /** The cost of ONE of `unitName`. */
  unitCostPaisa: number;
  onHandBase: number;
  /**
   * [PCN-012] The batch's cost position — its current total and units received
   * (bonus and corrections included) and how many have left — from which the
   * suggested credit is the exact cost of the units going back (PCN-009).
   */
  costPosition: { basis: { totalPaisa: number; receivedBase: number }; takenBase: number };
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
                {line.factor === 1
                  ? describeQuantity(baseQty(line.qtyBase), line.baseUnitName, line.packLevels)
                  : `${line.qtyBase / line.factor} ${line.unitName}`}
                {line.bonusQtyBase > 0
                  ? ` + ${line.bonusQtyBase / line.factor} ${line.unitName} bonus`
                  : ''}{' '}
                at {formatPaisa(paisa(line.unitCostPaisa))} / {line.unitName}
              </span>
              <span className="text-ink/50 text-xs">
                {describeQuantity(baseQty(line.onHandBase), line.baseUnitName, line.packLevels)} on
                hand
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

/**
 * The units a supplier takes back: the product's packs, largest first, keyed
 * as the product keys them (`u1` is the first pack level). Loose units only
 * when there are no packs at all.
 */
function returnUnitsOf(line: CorrectableLineView): { key: string; name: string; factor: number }[] {
  const packs = line.packLevels
    .map((level, index) => ({ key: `u${index + 1}`, name: level.name, factor: level.factor }))
    .filter((level) => level.factor > 1)
    .sort((a, b) => b.factor - a.factor);
  return packs.length > 0 ? packs : [{ key: 'u0', name: line.baseUnitName, factor: 1 }];
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
  // In the line's own unit: whole boxes for a box line (PCN-012).
  const [qty, setQty] = useState(String(line.qtyBase / line.factor));
  const [bonus, setBonus] = useState(String(line.bonusQtyBase / line.factor));
  const [cost, setCost] = useState(rupees(line.unitCostPaisa));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitLevel = { name: line.unitName, factor: line.factor };

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
      qtyBase: levelToBaseUnits(Number(qty.trim()), unitLevel),
      bonusQtyBase: levelToBaseUnits(Number(bonus.trim()), unitLevel),
      unitCostPaisa: paisaFromRupeeInput(cost),
      note,
    }).catch(() => ({ ok: false as const, message: NO_ANSWER }));
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
        Quantity ({line.unitName})
        <input
          autoComplete="off"
          autoFocus
          inputMode="numeric"
          value={qty}
          onChange={(event) => setQty(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="text-ink/70 text-xs">
        Bonus ({line.unitName})
        <input
          autoComplete="off"
          inputMode="numeric"
          value={bonus}
          onChange={(event) => setBonus(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="text-ink/70 text-xs">
        Unit cost (Rs per {line.unitName})
        <input
          autoComplete="off"
          inputMode="decimal"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
          className={`${fieldClass} numeral`}
        />
      </label>
      <label className="text-ink/70 text-xs">
        Why
        <input
          autoComplete="off"
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
  // [PCN-012] Goods go back to a supplier in packs, never loose; the unit the
  // line was bought in is pressed. A product with no packs returns its base unit.
  const units = returnUnitsOf(line);
  const [unitKey, setUnitKey] = useState(
    (units.find((unit) => unit.factor === line.factor) ?? units[0]!).key,
  );
  const unit = units.find((candidate) => candidate.key === unitKey) ?? units[0]!;
  const [qty, setQty] = useState('');
  const [credit, setCredit] = useState('');
  const [creditTouched, setCreditTouched] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = Number(qty);
  const counted = WHOLE.test(qty.trim()) && count > 0;
  const qtyBase = counted ? levelToBaseUnits(count, unit) : 0;
  // What these units carry out of the batch, at cost — the suggestion, and
  // the figure any edited credit is compared with.
  const stockCostPaisa = counted
    ? defaultReturnCreditPaisa(line.costPosition.basis, line.costPosition.takenBase, qtyBase)
    : 0;
  const suggested = counted ? rupees(stockCostPaisa) : '';
  const creditShown = creditTouched ? credit : suggested;
  const creditPaisa = AMOUNT.test(creditShown.trim()) ? paisaFromRupeeInput(creditShown) : null;
  const upTo = Math.floor(line.onHandBase / unit.factor);

  async function save(): Promise<void> {
    if (busy) return;
    if (!counted) {
      setError(`Enter how many ${unit.name} are going back, as a whole number.`);
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
      qtyBase,
      creditPaisa: paisaFromRupeeInput(creditShown),
      note,
      entered: { unitKey: unit.key, unitName: unit.name, unitCount: count },
    }).catch(() => ({ ok: false as const, message: NO_ANSWER }));
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
      {units.length > 1 ? (
        <div role="group" aria-label="Going back in" className="col-span-full flex">
          {units.map((candidate, index) => {
            const pressed = candidate.key === unit.key;
            return (
              <button
                key={candidate.key}
                type="button"
                aria-pressed={pressed}
                onClick={() => setUnitKey(candidate.key)}
                className={[
                  'border-line h-touch min-w-11 border px-3 text-sm capitalize',
                  index === 0 ? 'rounded-l' : '-ml-px',
                  index === units.length - 1 ? 'rounded-r' : '',
                  pressed
                    ? 'bg-green-600 text-paper border-green-600 font-medium'
                    : 'bg-paper text-ink hover:bg-green-100',
                ].join(' ')}
              >
                {candidate.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <label className="text-ink/70 text-xs">
        Quantity going back ({unit.name}, up to {upTo})
        <input
          autoComplete="off"
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
          autoComplete="off"
          inputMode="decimal"
          value={creditShown}
          onChange={(event) => {
            setCreditTouched(true);
            setCredit(event.target.value);
          }}
          className={`${fieldClass} numeral`}
        />
      </label>
      {counted ? (
        <p className="text-ink/60 col-span-full text-xs" role="status" aria-label="Stock cost">
          These go back at a stock cost of {formatPaisa(paisa(stockCostPaisa))}
          {creditPaisa !== null && creditPaisa !== stockCostPaisa
            ? creditPaisa < stockCostPaisa
              ? ` — the credit is ${formatPaisa(paisa(stockCostPaisa - creditPaisa))} less.`
              : ` — the credit is ${formatPaisa(paisa(creditPaisa - stockCostPaisa))} more.`
            : '.'}
        </p>
      ) : null}
      <label className="text-ink/70 text-xs">
        Note
        <input
          autoComplete="off"
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
