'use client';

/**
 * Purchase entry — W7.
 *
 * The rhythm is the product here: "a 20-line invoice in a handful of minutes;
 * **per-line rhythm matters more than total**". So the line form is one row of
 * fields in the order the invoice is read, Enter moves to the next line, and
 * focus returns to product search every time — the same home-position rule the
 * Sale surface follows (Phase 7 rule 1).
 *
 * Everything typed is written to the draft on every change. A rush must not
 * lose a half-entered invoice (W7), and the operator will press F1 mid-invoice
 * to serve a customer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ProductSearch } from '@/components/product-search';
import type { SearchHit } from '@/client/search/catalog-index';
import { useCatalog } from '@/client/search/provider';
import {
  clearDraft,
  readDraft,
  writeDraft,
  type DraftLine,
  type PurchaseDraft,
} from '@/client/purchases/draft';
import { scanCandidates, type KeyStroke } from '@/client/scan/burst';
import { parseGs1 } from '@/domain/catalog/barcode';
import { paisaFromRupeeInput } from '@/domain/sales/cart';
import { effectiveUnitCostPaisa, receivedQty } from '@/domain/purchases/costing';
import { purchaseWarnings, type PurchaseWarning } from '@/domain/purchases/purchase-command';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import { receivePurchaseAction } from './actions';
import { RecentPurchases } from './recent-purchases';
import { SupplierCreditPanel } from './supplier-credit-panel';
import { SupplierPicker } from './supplier-picker';

interface Received {
  batchCount: number;
  resolvedPendingBase: number;
}

function emptyDraft(): PurchaseDraft {
  return {
    purchaseId: uuidv7(),
    supplierId: null,
    supplierName: null,
    invoiceRef: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    lines: [],
    updatedAt: new Date().toISOString(),
  };
}

/** The line's editable fields, as text — what a scan in a field is undone back to. */
interface LineFields {
  qty: string;
  bonus: string;
  cost: string;
  expiry: string;
  batchNumber: string;
  price: string;
}

/** No delivery line is this many units; a scanned EAN in Qty is far beyond it. */
const MAX_LINE_UNITS = 100_000;
/** Rs 1,000,000 a unit: no medicine costs this; a barcode in a price field does. */
const MAX_UNIT_PAISA = 100_000_000;

function rupeesLookLikeBarcode(raw: string): boolean {
  return Number(raw.trim()) * 100 > MAX_UNIT_PAISA;
}

export function PurchaseEntry({ tenantId }: { tenantId: string }) {
  const { index, refresh } = useCatalog();
  const [draft, setDraft] = useState<PurchaseDraft>(emptyDraft);
  const [resumed, setResumed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState<Received | null>(null);
  /** Bumped on a successful receive so the history below reloads. */
  const [receivedCount, setReceivedCount] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // The line being typed, before it joins the draft.
  const [pending, setPending] = useState<{
    productId: string;
    productName: string;
    baseUnitName: string;
  } | null>(null);
  const [qty, setQty] = useState('');
  const [bonus, setBonus] = useState('');
  const [cost, setCost] = useState('');
  const [expiry, setExpiry] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [price, setPrice] = useState('');
  const qtyRef = useRef<HTMLInputElement>(null);
  // Scan detection in the line's fields (see `client/scan/burst.ts`): the keys
  // typed since the last Enter, and the fields as they stood before each one —
  // what a scan that landed in a field is undone back to.
  const strokes = useRef<KeyStroke[]>([]);
  const before = useRef<LineFields[]>([]);

  // Resumed once, after mount. W7's whole point: "a rush must not lose a
  // half-entered invoice."
  //
  // Deliberately an effect rather than lazy `useState` initialization. The
  // draft lives in `localStorage`, which does not exist while the server
  // renders — initializing from it would make the server and the first client
  // render disagree, and React would discard the restored draft during
  // hydration. Reading it after mount is the correct shape for restoring
  // persisted state, and is what the rule below would otherwise push us away
  // from.
  useEffect(() => {
    const saved = readDraft(tenantId);
    if (saved) {
      /* eslint-disable react-hooks/set-state-in-effect -- see above */
      setDraft(saved);
      setResumed(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [tenantId]);

  // Persisted on every change, so there is no "save" the operator could forget.
  useEffect(() => {
    if (draft.lines.length > 0) {
      writeDraft(tenantId, draft);
    }
  }, [tenantId, draft]);

  useEffect(() => {
    if (pending) {
      qtyRef.current?.focus();
    }
  }, [pending]);

  const invoiceTotal = draft.lines.reduce(
    (sum, line) => sum + line.qtyBase * line.unitCostPaisa,
    0,
  );

  // [PCN-007] "Paid now": empty means the whole invoice was paid (an ordinary
  // cash purchase, unchanged). Anything less is put on the supplier's account.
  const cashPaidPaisa =
    draft.cashPaidText !== undefined && draft.cashPaidText.trim() !== ''
      ? paisaFromRupeeInput(draft.cashPaidText)
      : invoiceTotal;
  const creditPaisa = Math.max(0, invoiceTotal - cashPaidPaisa);

  const command = useMemo(
    () => ({
      purchaseId: draft.purchaseId,
      supplierId: draft.supplierId,
      invoiceRef: draft.invoiceRef.trim() === '' ? null : draft.invoiceRef.trim(),
      invoiceDate: draft.invoiceDate === '' ? null : draft.invoiceDate,
      note: null,
      cashPaidPaisa,
      lines: draft.lines,
    }),
    [draft, cashPaidPaisa],
  );

  const warnings = useMemo(() => purchaseWarnings(command), [command]);
  const warningsByLine = useMemo(() => {
    const map = new Map<string, PurchaseWarning[]>();
    for (const warning of warnings) {
      map.set(warning.lineId, [...(map.get(warning.lineId) ?? []), warning]);
    }
    return map;
  }, [warnings]);

  const focusSearch = useCallback(() => {
    setPending(null);
    searchRef.current?.focus();
  }, []);

  const onSelectProduct = useCallback((hit: SearchHit, rawQuery: string) => {
    // A pack's 2D code carries its own batch and expiry: scanning it fills
    // them in, still editable. A typed search leaves them empty, as before.
    const pack = parseGs1(rawQuery);
    setPending({
      productId: hit.product.id,
      productName: hit.product.name,
      baseUnitName: hit.product.baseUnitName,
    });
    // Pre-filled from the catalog: the common case is that the price has not
    // changed, and capture-at-receiving (Phase 1 §3) only needs confirming.
    setPrice((hit.product.pricePaisa / 100).toFixed(2));
    setQty('');
    setBonus('');
    setCost('');
    setExpiry(pack?.expiry ?? '');
    setBatchNumber(pack?.batch ?? '');
  }, []);

  function addLine(fields: LineFields = { qty, bonus, cost, expiry, batchNumber, price }): boolean {
    if (!pending) {
      return false;
    }
    const { qty, bonus, cost, expiry, batchNumber, price } = fields;
    const qtyBase = Number(qty.trim());
    if (!Number.isSafeInteger(qtyBase) || qtyBase <= 0) {
      setError('Enter how many units arrived.');
      return false;
    }
    // Backstop for a barcode typed into a number field: no delivery line is a
    // hundred thousand units or a million rupees a unit, and a scanned EAN is
    // thirteen digits. Said plainly, never stored.
    const bonusBase = bonus.trim() === '' ? 0 : Math.max(0, Number(bonus.trim()));
    if (qtyBase > MAX_LINE_UNITS || bonusBase > MAX_LINE_UNITS) {
      setError('That quantity looks like a barcode, not a count. Check Qty and Bonus.');
      return false;
    }
    // The unit cost must be ENTERED, not merely default to zero. "Sells for" is
    // pre-filled from the catalog and "Unit cost" is not, so a line added
    // without it lands at zero cost — which reads as a Rs 0.00 invoice total,
    // a margin computed against nothing, and (since PCN-007) a supplier balance
    // that thinks the delivery was free. A genuinely free line is entered as an
    // explicit "0"; a blank is the operator having skipped the field.
    if (cost.trim() === '') {
      setError('Enter what this stock cost — type 0 if it was free.');
      return false;
    }
    // Checked on the typed number, before conversion: an amount past what a
    // number holds exactly converts to zero, which must never pass as "free".
    if (rupeesLookLikeBarcode(cost) || rupeesLookLikeBarcode(price)) {
      setError('That price looks like a barcode, not an amount. Check Unit cost and Sells for.');
      return false;
    }
    const pricePaisa = paisaFromRupeeInput(price);
    if (pricePaisa <= 0) {
      setError('Enter the selling price for this stock.');
      return false;
    }

    const line: DraftLine = {
      lineId: uuidv7(),
      productId: pending.productId,
      productName: pending.productName,
      baseUnitName: pending.baseUnitName,
      qtyBase,
      bonusQtyBase: bonusBase,
      unitCostPaisa: paisaFromRupeeInput(cost),
      expiryDate: expiry.trim() === '' ? null : expiry.trim(),
      batchNumber: batchNumber.trim() === '' ? null : batchNumber.trim(),
      mrpAtReceivingPaisa: null,
      priceAtReceivingPaisa: pricePaisa,
    };

    setDraft((current) => ({
      ...current,
      lines: [...current.lines, line],
      updatedAt: new Date().toISOString(),
    }));
    setError(null);
    setReceived(null);
    focusSearch();
    return true;
  }

  /**
   * A barcode scanned while the cursor was in one of the line's fields. The
   * fields go back to how they were before it; then it is the next product:
   * the current line is added if it is complete, and the scanned product's
   * line opens — with its own batch and expiry from a 2D code.
   */
  function routeScan(code: string, fields: LineFields): void {
    setQty(fields.qty);
    setBonus(fields.bonus);
    setCost(fields.cost);
    setExpiry(fields.expiry);
    setBatchNumber(fields.batchNumber);
    setPrice(fields.price);

    const hit = index?.resolveBarcode(code);
    if (!hit) {
      setError(
        'That code is not linked to a product yet. Finish or drop this line (Esc), then scan it in the search box to link or add it.',
      );
      return;
    }
    const complete =
      fields.qty.trim() !== '' && fields.cost.trim() !== '' && fields.price.trim() !== '';
    if (!complete) {
      setError(
        `Scanned ${hit.product.name}. Finish the ${pending?.productName ?? ''} line first — quantity and unit cost — or press Esc to drop it.`,
      );
      return;
    }
    if (addLine(fields)) {
      onSelectProduct(hit, code);
    }
  }

  function onLineKeyDownCapture(event: React.KeyboardEvent): void {
    // When the key was pressed, not when this handler got to it: each keystroke
    // re-renders the form, and on a busy page handler time stretches a
    // scanner's 4 ms gaps past the threshold.
    const now = event.timeStamp;
    if (event.key === 'Enter') {
      const typed = strokes.current;
      const snapshots = before.current;
      strokes.current = [];
      before.current = [];
      const candidates = scanCandidates(typed, now);
      if (candidates) {
        // Handled here, before the field's own Enter would add the line. The
        // code is the longest ending the catalogue knows; failing that, all of it.
        event.preventDefault();
        event.stopPropagation();
        const code =
          candidates.find((candidate) => index?.resolveBarcode(candidate)) ?? candidates[0]!;
        const fields = snapshots[typed.length - code.length] ?? snapshots[0]!;
        routeScan(code, fields);
      }
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    // Keydown runs before the field changes: this is the line as it stood.
    before.current.push({ qty, bonus, cost, expiry, batchNumber, price });
    strokes.current.push({ key: event.key, at: now });
  }

  function removeLine(lineId: string): void {
    setDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.lineId !== lineId),
      updatedAt: new Date().toISOString(),
    }));
  }

  async function receive(): Promise<void> {
    if (draft.lines.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);

    const outcome = await receivePurchaseAction(command).catch(() => ({
      ok: false as const,
      // ADR-3's calm sentence for the surfaces that genuinely need a network.
      message: 'Needs internet — selling keeps working. The invoice is saved here.',
    }));

    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }

    setReceived({
      batchCount: outcome.batchCount,
      resolvedPendingBase: outcome.resolvedPendingBase,
    });
    setReceivedCount((current) => current + 1);
    clearDraft(tenantId);
    setDraft(emptyDraft());
    setResumed(false);
    // Stock moved, so the counter's advisory snapshot is stale.
    refresh();
    focusSearch();
  }

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-green-900 text-2xl font-semibold">Receive stock</h1>
        {resumed ? (
          <span
            className="border-line text-ink/60 rounded border px-2 py-0.5 text-xs"
            role="status"
          >
            Resumed — this invoice was saved as you typed
          </span>
        ) : null}
      </header>

      {/* Invoice header: supplier, reference, date. */}
      <div className="border-line flex flex-wrap items-end gap-3 rounded border p-3">
        <div className="min-w-48">
          <span className="text-ink/60 mb-1 block text-xs" id="supplier-label">
            Supplier
          </span>
          <button
            type="button"
            aria-labelledby="supplier-label"
            onClick={() => {
              setPicking(true);
            }}
            className="border-line hover:bg-green-100/50 h-touch w-full rounded border px-3 text-left"
          >
            {draft.supplierName ?? <span className="text-ink/40">Choose…</span>}
          </button>
        </div>

        <div className="w-40">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="invoice-ref">
            Invoice no.
          </label>
          <input
            id="invoice-ref"
            value={draft.invoiceRef}
            onChange={(event) => {
              setDraft((current) => ({ ...current, invoiceRef: event.target.value }));
            }}
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          />
        </div>

        <div className="w-44">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="invoice-date">
            Invoice date
          </label>
          <input
            id="invoice-date"
            type="date"
            value={draft.invoiceDate}
            onChange={(event) => {
              setDraft((current) => ({ ...current, invoiceDate: event.target.value }));
            }}
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          />
        </div>
      </div>

      {/* The line being entered. */}
      <div className="border-line rounded border p-3">
        <ProductSearch onSelect={onSelectProduct} inputRef={searchRef} autoFocus={false} />

        {pending ? (
          <div
            className="mt-3 flex flex-wrap items-end gap-2"
            onKeyDownCapture={onLineKeyDownCapture}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addLine();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                focusSearch();
              }
            }}
          >
            <span className="min-w-40 self-center font-medium">{pending.productName}</span>

            <Field label={`Qty (${pending.baseUnitName})`} width="w-24">
              <input
                ref={qtyRef}
                value={qty}
                inputMode="numeric"
                onChange={(event) => {
                  setQty(event.target.value);
                }}
                className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-2 outline-none"
              />
            </Field>

            <Field label="Bonus" width="w-20">
              <input
                value={bonus}
                inputMode="numeric"
                placeholder="0"
                onChange={(event) => {
                  setBonus(event.target.value);
                }}
                className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-2 outline-none"
              />
            </Field>

            <Field label="Unit cost" width="w-24">
              <input
                value={cost}
                inputMode="decimal"
                onChange={(event) => {
                  setCost(event.target.value);
                }}
                className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-2 outline-none"
              />
            </Field>

            {/* W7: "expiry (always asked)" — asked every time, never required,
                because a non-perishable genuinely has none (Phase 9 §4). */}
            <Field label="Expiry" width="w-40">
              <input
                type="date"
                value={expiry}
                onChange={(event) => {
                  setExpiry(event.target.value);
                }}
                className="border-line focus:border-green-600 h-touch w-full rounded border px-2 outline-none"
              />
            </Field>

            <Field label="Batch no." width="w-28">
              <input
                value={batchNumber}
                onChange={(event) => {
                  setBatchNumber(event.target.value);
                }}
                className="border-line focus:border-green-600 h-touch w-full rounded border px-2 outline-none"
              />
            </Field>

            <Field label="Sells for" width="w-24">
              <input
                value={price}
                inputMode="decimal"
                onChange={(event) => {
                  setPrice(event.target.value);
                }}
                className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-2 outline-none"
              />
            </Field>

            <button
              type="button"
              onClick={() => {
                addLine();
              }}
              className="bg-green-600 text-paper min-h-touch rounded px-4 font-medium"
            >
              Add — Enter
            </button>
          </div>
        ) : (
          <p className="text-ink/40 mt-2 text-xs">
            Search or scan the product to start a line. Esc returns here from any field.
          </p>
        )}
      </div>

      {error ? (
        <p className="text-red text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {received ? (
        <div
          className="border-line bg-green-100/50 rounded border p-3 text-sm"
          role="status"
          aria-label="Received"
        >
          <p className="text-green-900 font-medium">
            Received — {received.batchCount} batch{received.batchCount === 1 ? '' : 'es'} on the
            shelf
            <a
              href="/stock"
              className="text-green-600 ml-3 text-xs font-normal underline-offset-2 hover:underline"
            >
              See it in stock →
            </a>
          </p>
          {received.resolvedPendingBase > 0 ? (
            // D2 closing its loop, said plainly: the shortfall the counter sold
            // into is now accounted for.
            <p className="text-ink/70 mt-1">
              {received.resolvedPendingBase} unit
              {received.resolvedPendingBase === 1 ? '' : 's'} that had already been sold are now
              accounted for.
            </p>
          ) : null}
        </div>
      ) : null}

      {draft.lines.length > 0 ? (
        <div className="border-line overflow-x-auto rounded border">
          <table className="text-table w-full text-left">
            <thead className="bg-green-100/50 text-ink/60 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Bonus</th>
                <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                <th className="px-3 py-2 text-right font-medium">Effective</th>
                <th className="px-3 py-2 font-medium">Expiry</th>
                <th className="px-3 py-2 text-right font-medium">Sells for</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line) => {
                const lineWarnings = warningsByLine.get(line.lineId) ?? [];
                return (
                  <tr key={line.lineId} className="border-line border-t">
                    <td className="px-3 py-2">
                      <span className="font-medium">{line.productName}</span>
                      {lineWarnings.map((warning) => (
                        <span key={warning.kind} className="text-amber ml-2 text-xs">
                          {warningText(warning)}
                        </span>
                      ))}
                    </td>
                    <td className="numeral px-3 py-2">{line.qtyBase}</td>
                    <td className="numeral text-ink/60 px-3 py-2">
                      {line.bonusQtyBase > 0 ? `+${line.bonusQtyBase}` : '—'}
                    </td>
                    <td className="numeral px-3 py-2">{formatPaisa(paisa(line.unitCostPaisa))}</td>
                    <td className="numeral text-ink/60 px-3 py-2">
                      {/* The number margin will actually use — see costing.ts. */}
                      {line.bonusQtyBase > 0
                        ? `${formatPaisa(effectiveUnitCostPaisa(line))} × ${receivedQty(line)}`
                        : '—'}
                    </td>
                    <td className="text-ink/70 px-3 py-2">{line.expiryDate ?? '—'}</td>
                    <td className="numeral px-3 py-2">
                      {formatPaisa(paisa(line.priceAtReceivingPaisa))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          removeLine(line.lineId);
                        }}
                        className="text-ink/50 text-xs"
                        aria-label={`Remove ${line.productName}`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Invoice total</p>
          <p className="text-green-900 numeral text-2xl font-semibold">
            {formatPaisa(paisa(invoiceTotal), { withSymbol: true })}
          </p>
          <p className="text-ink/50 text-xs">
            {draft.lines.length} line{draft.lines.length === 1 ? '' : 's'}
          </p>
        </div>

        {/* [PCN-007] What was paid to the distributor now. Left blank it means
            "paid in full" (the ordinary cash purchase); reduce it and the rest
            becomes what the pharmacy owes this supplier — the mirror of an
            udhaar sale. */}
        <div className="w-40">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="cash-paid">
            Paid now
          </label>
          <input
            id="cash-paid"
            value={draft.cashPaidText ?? ''}
            inputMode="decimal"
            placeholder={(invoiceTotal / 100).toFixed(2)}
            onChange={(event) => {
              setDraft((current) => ({ ...current, cashPaidText: event.target.value }));
            }}
            className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
          />
        </div>

        {creditPaisa > 0 ? (
          <div>
            <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">On credit</p>
            <p className="text-amber numeral text-2xl font-semibold">
              {formatPaisa(paisa(creditPaisa), { withSymbol: true })}
            </p>
            <p className={`text-xs ${draft.supplierId ? 'text-ink/50' : 'text-amber'}`}>
              {draft.supplierName ? `owed to ${draft.supplierName}` : 'choose a supplier'}
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void receive()}
          disabled={draft.lines.length === 0 || busy || (creditPaisa > 0 && !draft.supplierId)}
          className="bg-green-600 text-paper min-h-touch ml-auto rounded px-6 text-lg font-medium disabled:opacity-40"
        >
          {busy ? 'Receiving…' : 'Receive stock'}
        </button>
      </div>

      <SupplierCreditPanel reloadKey={receivedCount} />

      <RecentPurchases reloadKey={receivedCount} />

      {picking ? (
        <SupplierPicker
          onPick={(supplier) => {
            setDraft((current) => ({
              ...current,
              supplierId: supplier.id,
              supplierName: supplier.name,
            }));
            setPicking(false);
          }}
          onCancel={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </section>
  );
}

function Field({
  label,
  width,
  children,
}: {
  label: string;
  width: string;
  children: React.ReactNode;
}) {
  // The input is nested inside its label rather than wired by id: these fields
  // are re-created per line, and generated ids would either collide or drift.
  // Implicit association is what makes the field reachable by name — to a
  // screen reader and to the keyboard path the definition of done requires.
  return (
    <div className={width}>
      <label className="block">
        <span className="text-ink/60 mb-1 block text-xs">{label}</span>
        {children}
      </label>
    </div>
  );
}

/** I5 — plain words. All four are warnings, never blocks (D4, T1). */
function warningText(warning: PurchaseWarning): string {
  switch (warning.kind) {
    case 'price_above_mrp':
      return 'above MRP';
    case 'price_below_cost':
      return 'sells below cost';
    case 'expiry_missing':
      return 'no expiry';
    case 'expiry_in_past':
      return 'already expired';
  }
}
