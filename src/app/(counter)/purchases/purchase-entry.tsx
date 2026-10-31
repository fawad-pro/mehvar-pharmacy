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

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isMobileBrowser, useVirtualKeyboardOpen } from '@/client/navigation/device';
import { ProductSearch } from '@/components/product-search';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button, Kbd, buttonClass } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { FieldLabel, inputClass } from '@/components/ui/field';
import type { SearchHit } from '@/client/search/catalog-index';
import { useCatalog } from '@/client/search/provider';
import {
  clearDraft,
  draftHasContent,
  readDraft,
  writeDraft,
  type DraftLine,
  type PurchaseDraft,
} from '@/client/purchases/draft';
import { scanCandidates, type KeyStroke } from '@/client/scan/burst';
import { looksLikeScannedCode, parseGs1 } from '@/domain/catalog/barcode';
import { paisaFromRupeeInput, parseRupeeInput } from '@/domain/sales/cart';
import { needsClickToCommit } from '@/client/scan/amount-guard';
import {
  lineCostPaisa,
  purchaseWarnings,
  type PurchaseWarning,
} from '@/domain/purchases/purchase-command';
import { unitsOf, type ProductUnit } from '@/domain/catalog/units';
import { recordedMrpFor } from '@/domain/catalog/mrp';
import type { IndexedProduct } from '@/client/search/catalog-index';
import { baseQty, packFactor, paisa } from '@/lib/branded';
import { describeQuantity, levelToBaseUnits, scalePriceBetweenUnits } from '@/lib/quantity';
import { formatExpiry, parseExpiryInput } from '@/lib/expiry';
import { formatPaisa } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import { receivePurchaseAction, recordDeliveredMrpAction } from './actions';
import { RecentPurchases } from './recent-purchases';
import { SupplierCreditPanel } from './supplier-credit-panel';
import { SupplierPicker, SupplierPosition } from './supplier-picker';
import { supplierPositionPhrase } from '@/domain/suppliers/supplier-position';

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
  mrp: string;
  price: string;
}

/**
 * [PCN-012] The units a delivery arrives in: the product's packs, largest
 * first — a distributor invoices boxes and strips, never loose tablets. A
 * product with no pack (a bottle, a tube) arrives in its one unit.
 */
function receivingUnits(units: readonly ProductUnit[]): ProductUnit[] {
  const packs = units.filter((unit) => unit.factor > 1);
  return packs.length > 0 ? [...packs].reverse() : units.slice(0, 1);
}

/** No delivery line is this many units; a scanned EAN in Qty is far beyond it. */
const MAX_LINE_UNITS = 100_000;
/** Rs 1,000,000 a unit: no medicine costs this; a barcode in a price field does. */
const MAX_UNIT_PAISA = 100_000_000;

function rupeesLookLikeBarcode(raw: string): boolean {
  return Number(raw.trim()) * 100 > MAX_UNIT_PAISA;
}

export function PurchaseEntry({ tenantId, isOwner }: { tenantId: string; isOwner: boolean }) {
  const { index, refresh } = useCatalog();
  const [draft, setDraft] = useState<PurchaseDraft>(emptyDraft);
  const [resumed, setResumed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState<Received | null>(null);
  /**
   * The chosen supplier's balance when they were picked (PCN-016), for "you
   * owe" beside the name and "after this" under Paid now. Not kept in the
   * draft: a resumed invoice would show a figure from another day.
   */
  const [supplierBalance, setSupplierBalance] = useState<number | null>(null);
  /** The invoice date's field, behind "More details" (PCN-016). */
  const [showDate, setShowDate] = useState(false);
  /** Bumped on a successful receive so the history below reloads. */
  const [receivedCount, setReceivedCount] = useState(0);
  const isKeyboardOpen = useVirtualKeyboardOpen();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const supplierRef = useRef<HTMLButtonElement>(null);
  const invoiceRefRef = useRef<HTMLInputElement>(null);

  // The line being typed, before it joins the draft.
  const [pending, setPending] = useState<{
    productId: string;
    productName: string;
    baseUnitName: string;
    /** [PCN-012] What this product can arrive in, largest pack first. */
    units: ProductUnit[];
    /**
     * Fields a 1D barcode could not fill — it carries only the product number
     * — so the operator reads them off the pack. A 2D code fills them.
     */
    fromPack: { expiry: boolean; batch: boolean };
    /**
     * The expiry a 2D code carried, exactly. Shown as MM/YYYY like any other
     * (PCN-017); kept as scanned while the field still says that month.
     */
    packExpiry: string | null;
  } | null>(null);
  const [unitKey, setUnitKey] = useState('');
  const [qty, setQty] = useState('');
  const [bonus, setBonus] = useState('');
  const [cost, setCost] = useState('');
  const [expiry, setExpiry] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [mrp, setMrp] = useState('');
  const [price, setPrice] = useState('');
  const qtyRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
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
  //
  // Focus starts where W7's path does: at the supplier for a new invoice, at
  // product search for one already under way. It used to start nowhere, so
  // the first thing typed after F7 went nowhere either.
  useEffect(() => {
    const saved = readDraft(tenantId);
    if (saved) {
      /* eslint-disable react-hooks/set-state-in-effect -- see above */
      setDraft(saved);
      setResumed(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    if (!isMobileBrowser()) {
      (saved?.supplierId ? searchRef : supplierRef).current?.focus();
    }
  }, [tenantId]);

  // Persisted on every change, so there is no "save" the operator could forget.
  useEffect(() => {
    if (draftHasContent(draft)) {
      writeDraft(tenantId, draft);
    }
  }, [tenantId, draft]);

  useEffect(() => {
    if (pending) {
      // After a 1D scan the pack still has to be read: start at its expiry.
      const target = pending.fromPack.expiry ? expiryRef : qtyRef;
      target.current?.focus();
      if (isMobileBrowser()) {
        setTimeout(() => {
          target.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      }
    }
  }, [pending]);

  const invoiceTotal = draft.lines.reduce((sum, line) => sum + lineCostPaisa(line), 0);

  // [PCN-007] "Paid now": empty means the whole invoice was paid (an ordinary
  // cash purchase, unchanged). Anything less is put on the supplier's account.
  // Text that is not an amount (a scanned GS1 code ends in letters) is said,
  // never read as Rs 0 — that put the whole invoice on credit unannounced.
  const cashPaidTyped = (draft.cashPaidText ?? '').trim() !== '';
  const cashPaidParsed = cashPaidTyped ? parseRupeeInput(draft.cashPaidText ?? '') : null;
  const cashPaidUnreadable = cashPaidTyped && cashPaidParsed === null;
  const cashPaidPaisa = cashPaidParsed ?? invoiceTotal;
  const creditPaisa = cashPaidUnreadable ? 0 : Math.max(0, invoiceTotal - cashPaidPaisa);
  /** One rule for the button and for Enter in Paid now. */
  const canReceive =
    draft.lines.length > 0 &&
    !busy &&
    !cashPaidUnreadable &&
    !(creditPaisa > 0 && !draft.supplierId);

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
    if (!isMobileBrowser()) {
      searchRef.current?.focus();
    }
  }, []);

  /**
   * Enter in the invoice header goes on to the first line. The date is
   * today's unless changed, and leaving a date field by Tab takes a key per
   * part of the date — four keys, on every invoice, to skip a field that is
   * almost always right.
   */
  function onHeaderEnter(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      focusSearch();
    }
  }

  const onSelectProduct = useCallback((hit: SearchHit, rawQuery: string) => {
    // A pack's 2D code carries its own batch and expiry: scanning it fills
    // them in, still editable. A typed search leaves them empty, as before.
    const pack = parseGs1(rawQuery);
    const units = receivingUnits(
      unitsOf({
        baseUnitName: hit.product.baseUnitName,
        packLevels: hit.product.packLevels,
        pricePerBasePaisa: hit.product.pricePaisa,
        units: hit.product.units,
      }),
    );
    // A scanned code names its own unit (a box code means a box); otherwise
    // the largest pack, which is how distributors invoice.
    const unit = units.find((candidate) => candidate.name === hit.unitLevelName) ?? units[0];
    // A scanned code that did not say when the pack expires or which batch it
    // is (an EAN, or a 2D code without those fields): read them off the pack.
    const scanned = looksLikeScannedCode(rawQuery);
    setPending({
      productId: hit.product.id,
      productName: hit.product.name,
      baseUnitName: hit.product.baseUnitName,
      units,
      fromPack: { expiry: scanned && !pack?.expiry, batch: scanned && !pack?.batch },
      packExpiry: pack?.expiry ?? null,
    });
    setUnitKey(unit?.key ?? '');
    // Pre-filled from the catalog: the common case is that the price has not
    // changed, and capture-at-receiving (Phase 1 §3) only needs confirming.
    setPrice(((unit?.pricePaisa ?? hit.product.pricePaisa) / 100).toFixed(2));
    setMrp('');
    setQty('');
    setBonus('');
    setCost('');
    setExpiry(pack?.expiry ? formatExpiry(pack.expiry) : '');
    setBatchNumber(pack?.batch ?? '');
  }, []);

  function addLine(
    fields: LineFields = { qty, bonus, cost, expiry, batchNumber, mrp, price },
  ): boolean {
    if (!pending) {
      return false;
    }
    const unit = pending.units.find((candidate) => candidate.key === unitKey) ?? pending.units[0];
    if (!unit) {
      return false;
    }
    const { qty, bonus, cost, expiry, batchNumber, mrp, price } = fields;
    const unitCount = Number(qty.trim());
    if (!Number.isSafeInteger(unitCount) || unitCount <= 0) {
      setError(`Enter how many ${unit.name} arrived.`);
      return false;
    }
    const bonusCount = bonus.trim() === '' ? 0 : Number(bonus.trim());
    if (!Number.isSafeInteger(bonusCount) || bonusCount < 0) {
      setError(`Enter the bonus as whole ${unit.name} — leave it empty for none.`);
      return false;
    }
    // Backstop for a barcode typed into a number field: no delivery line is a
    // hundred thousand units or a million rupees a unit, and a scanned EAN is
    // thirteen digits. Said plainly, never stored.
    const level = { name: unit.name, factor: unit.factor };
    if (
      unitCount > MAX_LINE_UNITS ||
      bonusCount > MAX_LINE_UNITS ||
      levelToBaseUnits(unitCount + bonusCount, level) > MAX_LINE_UNITS * 1_000
    ) {
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
    if (rupeesLookLikeBarcode(cost) || rupeesLookLikeBarcode(price) || rupeesLookLikeBarcode(mrp)) {
      setError('That price looks like a barcode, not an amount. Check Cost, MRP and Sells for.');
      return false;
    }
    const pricePaisa = paisaFromRupeeInput(price);
    if (pricePaisa <= 0) {
      setError('Enter the selling price for this stock.');
      return false;
    }
    // Optional, but never silently dropped: text that is not an amount is said.
    const mrpPaisa = parseRupeeInput(mrp);
    if (mrp.trim() !== '' && mrpPaisa === null) {
      setError(
        `MRP is not an amount — type the MRP printed on the ${unit.name}, or leave it empty.`,
      );
      return false;
    }
    const costPaisa = paisaFromRupeeInput(cost);
    // [PCN-017] Month and year, as the pack prints it; stored as the month's
    // last day. A 2D code's own date stands while the field still reads it.
    const typedExpiry = expiry.trim();
    const expiryDate =
      typedExpiry === ''
        ? null
        : pending.packExpiry !== null && typedExpiry === formatExpiry(pending.packExpiry)
          ? pending.packExpiry
          : parseExpiryInput(typedExpiry);
    if (typedExpiry !== '' && expiryDate === null) {
      setError('Type the expiry as month and year, as on the pack: 03/28 or 03/2028.');
      return false;
    }

    // [PCN-012] The line as the invoice states it: counts and money in the
    // unit it arrived in. Base quantities come from the unit's size (through
    // lib/quantity); the per-base cost and price are nominal, rounded up.
    const line: DraftLine = {
      lineId: uuidv7(),
      productId: pending.productId,
      productName: pending.productName,
      baseUnitName: pending.baseUnitName,
      qtyBase: levelToBaseUnits(unitCount, level),
      bonusQtyBase: levelToBaseUnits(bonusCount, level),
      unitCostPaisa: scalePriceBetweenUnits(costPaisa, packFactor(unit.factor), packFactor(1)),
      expiryDate,
      batchNumber: batchNumber.trim() === '' ? null : batchNumber.trim(),
      mrpAtReceivingPaisa: mrpPaisa,
      priceAtReceivingPaisa: scalePriceBetweenUnits(
        pricePaisa,
        packFactor(unit.factor),
        packFactor(1),
      ),
      entered: {
        unitKey: unit.key,
        unitName: unit.name,
        unitCount,
        bonusUnitCount: bonusCount,
        unitCostPaisa: costPaisa,
        pricePaisa,
      },
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
    setMrp(fields.mrp);
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
        `Scanned ${hit.product.name}. Finish the ${pending?.productName ?? ''} line first — quantity and cost — or press Esc to drop it.`,
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
    before.current.push({ qty, bonus, cost, expiry, batchNumber, mrp, price });
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
    if (!canReceive) {
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
    setSupplierBalance(null);
    setShowDate(false);
    setResumed(false);
    // Stock moved, so the counter's advisory snapshot is stale.
    refresh();
    // The next invoice starts where every invoice does.
    setPending(null);
    if (!isMobileBrowser()) {
      supplierRef.current?.focus();
    }
  }

  const chosenUnit =
    pending?.units.find((candidate) => candidate.key === unitKey) ?? pending?.units[0];
  const unitLabel = chosenUnit?.name ?? pending?.baseUnitName ?? 'unit';
  const invoiceTotalText = formatPaisa(paisa(invoiceTotal), { withSymbol: true });
  const lineCountText = `${draft.lines.length} line${draft.lines.length === 1 ? '' : 's'}`;
  const datedToday = draft.invoiceDate === emptyDraft().invoiceDate;
  const datedText = datedToday ? 'dated today' : `dated ${formatDate(draft.invoiceDate)}`;
  /** Paid now beyond the bill: it comes off what is owed (PCN-007's balance). */
  const overPaisa = cashPaidUnreadable ? 0 : Math.max(0, cashPaidPaisa - invoiceTotal);

  const receiveButton = (
    <Button
      kind="primary"
      block
      onClick={() => void receive()}
      disabled={!canReceive}
      className="h-14 text-[17px]"
    >
      {busy ? (
        'Receiving…'
      ) : (
        <>
          Receive stock <Kbd>Enter</Kbd>
        </>
      )}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 w-full max-w-full flex-col overflow-x-hidden">
      <div className="min-h-0 flex-1 w-full max-w-full overflow-y-auto overflow-x-hidden px-4 py-3 md:p-6 lg:px-8 pb-36 md:pb-6">
        <div className="flex min-w-0 w-full max-w-full flex-col gap-3 md:gap-4 lg:flex-row lg:items-start lg:gap-6">
          <section aria-label="Delivery" className="flex min-w-0 w-full max-w-full flex-col gap-3 md:gap-4 lg:flex-1">
            {resumed ? (
              <Badge role="status" className="self-start">
                Resumed — saved as you typed
              </Badge>
            ) : null}

            {received ? (
              <Banner
                tone="done"
                role="status"
                aria-label="Received"
                lead={`Received — ${received.batchCount} batch${received.batchCount === 1 ? '' : 'es'} on the shelf.`}
              >
                {received.resolvedPendingBase > 0
                  ? // D2 closing its loop, said plainly: the shortfall the
                    // counter sold into is now accounted for.
                    `${received.resolvedPendingBase} unit${received.resolvedPendingBase === 1 ? '' : 's'} that had already been sold are now accounted for. `
                  : null}
                <Link
                  href="/stock"
                  className="font-medium text-blue-600 underline-offset-2 hover:underline"
                >
                  See it in stock
                </Link>
              </Banner>
            ) : null}

            {/* Invoice header: supplier, invoice number, and the date behind
                More details — it is today's on almost every invoice. */}
            <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
              <div className="col-span-2 flex min-w-0 flex-col gap-1.5 md:col-span-1">
                <span
                  className="h-label text-label block whitespace-nowrap text-ink-2"
                  id="supplier-label"
                >
                  Supplier
                </span>
                <button
                  ref={supplierRef}
                  type="button"
                  aria-labelledby="supplier-label"
                  onClick={() => {
                    setPicking(true);
                  }}
                  className={`${buttonClass('secondary')} w-full justify-between px-3.5 font-normal`}
                >
                  {draft.supplierName ? (
                    <span className="min-w-0 flex-1 truncate text-left">
                      <b className="font-semibold">{draft.supplierName}</b>
                      {supplierBalance !== null ? (
                        <span className="text-ink-2">
                          {' '}
                          · {lowerFirst(supplierPositionPhrase(supplierBalance))}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-left text-ink-2">
                      Choose a supplier<span className="max-md:hidden"> — Enter</span>
                    </span>
                  )}
                  <Chevron />
                </button>
              </div>

              <label className="flex min-w-0 flex-col gap-1.5">
                <FieldLabel>Invoice no.</FieldLabel>
                <input
                  ref={invoiceRefRef}
                  autoComplete="off"
                  value={draft.invoiceRef}
                  placeholder="As printed on the bill"
                  onKeyDown={onHeaderEnter}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, invoiceRef: event.target.value }));
                  }}
                  className={inputClass}
                />
              </label>

              {showDate ? (
                <label className="flex min-w-0 flex-col gap-1.5">
                  <FieldLabel>Invoice date</FieldLabel>
                  <input
                    type="date"
                    value={draft.invoiceDate}
                    onKeyDown={onHeaderEnter}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, invoiceDate: event.target.value }));
                    }}
                    className={inputClass}
                  />
                </label>
              ) : (
                <Button
                  kind="quiet"
                  aria-expanded={false}
                  className="self-end"
                  onClick={() => {
                    setShowDate(true);
                  }}
                >
                  <span className="max-md:hidden">More details — </span>
                  <span className="md:hidden">{datedToday ? 'Dated today' : datedText}</span>
                  <span className="max-md:hidden">{datedText}</span>
                  <Chevron />
                </Button>
              )}
            </div>

            {/* The line being entered. */}
            <div className={`${cardClass} gap-3 p-4`}>
              <ProductSearch
                label="Search or scan a product"
                hint="Enter goes to Qty"
                onSelect={onSelectProduct}
                inputRef={searchRef}
                autoFocus={false}
                // The lines are in: Enter on an empty search goes to Paid now. Tab
                // went there by way of the last line's Remove button.
                onEnterEmpty={() => {
                  if (draft.lines.length > 0) document.getElementById('cash-paid')?.focus();
                }}
              />

              {pending ? (
                <div
                  className="border-line flex flex-col gap-3 border-t pt-3"
                  // The line routes a scan to the next product itself, so the
                  // counter's scan guard leaves its fields alone.
                  data-scan-target=""
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
                  {/* Which product and which pack first; then the numbers, which
                      all follow the pack. */}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-control font-semibold">{pending.productName}</span>

                    {/* [PCN-012] The unit it arrived in, as buttons — largest pack
                        first and pressed. Qty, bonus, cost and price all follow it. */}
                    {pending.units.length > 1 ? (
                      <div role="group" aria-label="Arrived in" className="flex flex-wrap">
                        {pending.units.map((unit, index) => {
                          const chosen = unit.key === chosenUnit?.key;
                          return (
                            <button
                              key={unit.key}
                              type="button"
                              aria-pressed={chosen}
                              onClick={() => {
                                setUnitKey(unit.key);
                                setPrice((unit.pricePaisa / 100).toFixed(2));
                              }}
                              className={[
                                'h-touch min-w-touch border px-4 text-control',
                                index === 0 ? 'rounded-l-control' : '-ml-px',
                                index === pending.units.length - 1 ? 'rounded-r-control' : '',
                                chosen
                                  ? 'relative z-10 border-blue-600 bg-blue-50 font-semibold text-navy'
                                  : 'border-border bg-surface font-medium text-navy hover:bg-page',
                              ].join(' ')}
                            >
                              {unit.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {chosenUnit && chosenUnit.factor > 1 ? (
                      <span className="text-body-sm text-ink-2">
                        1 {chosenUnit.name} = {describeUnitSize(chosenUnit, pending)}
                      </span>
                    ) : null}
                  </div>

                  {/* Two rows of four on a laptop and tablet, in the order the
                      invoice is read; two columns on a phone. */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <LineField
                      label={`Qty (${unitLabel})`}
                      ref={qtyRef}
                      value={qty}
                      inputMode="numeric"
                      onChange={(event) => {
                        setQty(event.target.value);
                      }}
                    />
                    <LineField
                      label={`Bonus (${unitLabel})`}
                      value={bonus}
                      inputMode="numeric"
                      placeholder="0"
                      onChange={(event) => {
                        setBonus(event.target.value);
                      }}
                    />
                    <LineField
                      label={`Cost of 1 ${unitLabel}`}
                      rupees
                      value={cost}
                      inputMode="decimal"
                      placeholder="0.00"
                      onChange={(event) => {
                        setCost(event.target.value);
                      }}
                    />
                    {/* W7: "expiry (always asked)" — asked every time, never
                        required, because a non-perishable genuinely has none
                        (Phase 9 §4). PCN-017: month and year, as on the pack. */}
                    <LineField
                      label={
                        pending.fromPack.expiry && expiry === '' ? 'Expiry — from pack' : 'Expiry'
                      }
                      attention={pending.fromPack.expiry && expiry === ''}
                      text
                      ref={expiryRef}
                      value={expiry}
                      inputMode="numeric"
                      placeholder="MM/YY"
                      onChange={(event) => {
                        setExpiry(event.target.value);
                      }}
                    />
                    <LineField
                      label={
                        pending.fromPack.batch && batchNumber === '' ? 'Batch — from pack' : 'Batch'
                      }
                      attention={pending.fromPack.batch && batchNumber === ''}
                      text
                      value={batchNumber}
                      placeholder="On the pack"
                      onChange={(event) => {
                        setBatchNumber(event.target.value);
                      }}
                    />
                    {/* The MRP printed on the pack, for the unit it arrived in
                        (D4: the pack in hand is authoritative). Optional; a price
                        above it is warned, never refused. */}
                    <LineField
                      label={`MRP of 1 ${unitLabel}`}
                      rupees
                      value={mrp}
                      inputMode="decimal"
                      placeholder="Optional"
                      onChange={(event) => {
                        setMrp(event.target.value);
                      }}
                    />
                    <LineField
                      label="Sells for"
                      rupees
                      value={price}
                      inputMode="decimal"
                      onChange={(event) => {
                        setPrice(event.target.value);
                      }}
                    />
                    <Button
                      className="self-end max-md:col-span-2 max-md:h-[52px] max-md:w-full"
                      onClick={() => {
                        addLine();
                      }}
                    >
                      Add line <Kbd>Enter</Kbd>
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {error ? (
              <Banner tone="refused" role="alert">
                {error}
              </Banner>
            ) : null}

            <p className="text-caption text-ink-2 m-0 px-1 max-md:hidden">
              {pending
                ? 'Enter adds the line and comes back here. Esc returns to the search from any field.'
                : draft.lines.length > 0
                  ? 'Lines all in? Enter on an empty search goes to Paid now. Esc returns to the search from any field.'
                  : 'Search or scan the product to start a line. Esc returns here from any field.'}
            </p>

            <div className="hidden md:block bg-surface shadow-card overflow-x-auto rounded-card">
              <table className="w-full min-w-[740px] text-left">
                <thead className="text-label text-ink-2">
                  <tr className="border-line border-b">
                    <th className="px-4 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Qty</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Bonus</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                      Cost each
                    </th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">Expiry · batch</th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                      Sells for
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Amount</th>
                    <th className="w-12 p-0">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-control">
                  {draft.lines.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-body-sm text-ink-2 px-4 py-6 text-center">
                        No lines yet. Search or scan the first product on the bill.
                      </td>
                    </tr>
                  ) : null}
                  {draft.lines.map((line) => {
                    const lineWarnings = warningsByLine.get(line.lineId) ?? [];
                    return (
                      <tr key={line.lineId} className="border-line border-t first:border-t-0">
                        <td className="px-4 py-1.5">
                          <span className="flex min-h-touch flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium">{line.productName}</span>
                            {lineWarnings.map((warning) => (
                              <Badge key={warning.kind} tone="attention">
                                {warningText(warning)}
                              </Badge>
                            ))}
                          </span>
                          <MrpOffer
                            line={line}
                            product={index?.products.find(
                              (product) => product.id === line.productId,
                            )}
                            isOwner={isOwner}
                            onRecorded={refresh}
                          />
                        </td>
                        {/* As the invoice reads: "10 box", cost and price per box.
                            A draft saved before PCN-012 has no unit and reads in
                            base units, as it was typed. */}
                        <td className="numeral px-3 py-1.5 text-right whitespace-nowrap">
                          {line.entered
                            ? `${line.entered.unitCount} ${line.entered.unitName}`
                            : `${line.qtyBase} ${line.baseUnitName}`}
                        </td>
                        <td className="numeral text-ink-2 px-3 py-1.5 text-right whitespace-nowrap">
                          {line.entered
                            ? line.entered.bonusUnitCount > 0
                              ? `${line.entered.bonusUnitCount} ${line.entered.unitName}`
                              : '—'
                            : line.bonusQtyBase > 0
                              ? `${line.bonusQtyBase} ${line.baseUnitName}`
                              : '—'}
                        </td>
                        <td className="numeral px-3 py-1.5 text-right whitespace-nowrap">
                          {formatPaisa(paisa(line.entered?.unitCostPaisa ?? line.unitCostPaisa), {
                            withSymbol: true,
                          })}
                        </td>
                        <td className="numeral px-3 py-1.5 whitespace-nowrap">
                          {line.expiryDate ? formatExpiry(line.expiryDate) : '—'}
                          {line.batchNumber ? (
                            <span className="text-ink-2"> · {line.batchNumber}</span>
                          ) : null}
                        </td>
                        <td className="numeral px-3 py-1.5 text-right whitespace-nowrap">
                          {formatPaisa(
                            paisa(line.entered?.pricePaisa ?? line.priceAtReceivingPaisa),
                            {
                              withSymbol: true,
                            },
                          )}
                          {line.mrpAtReceivingPaisa !== null ? (
                            <span className="text-caption text-ink-2 block">
                              MRP{' '}
                              {formatPaisa(paisa(line.mrpAtReceivingPaisa), { withSymbol: true })}
                            </span>
                          ) : null}
                        </td>
                        <td className="numeral px-3 py-1.5 text-right font-semibold whitespace-nowrap">
                          {formatPaisa(paisa(lineCostPaisa(line)), { withSymbol: true })}
                        </td>
                        <td className="p-0">
                          <Button
                            kind="quiet"
                            className="w-touch px-0 text-xl"
                            onClick={() => {
                              removeLine(line.lineId);
                            }}
                            aria-label={`Remove ${line.productName}`}
                          >
                            ×
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile received lines list (card format) */}
            <div className="md:hidden flex flex-col gap-2.5">
              {draft.lines.length === 0 ? (
                <div className={`${cardClass} p-4 text-center text-body-sm text-ink-2`}>
                  No lines yet. Search or scan the first product on the bill.
                </div>
              ) : (
                draft.lines.map((line) => {
                  const lineWarnings = warningsByLine.get(line.lineId) ?? [];
                  return (
                    <div key={line.lineId} className={`${cardClass} gap-2.5 p-3.5`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-1 min-w-0 flex-col gap-1">
                          <span className="text-control font-semibold text-navy break-words">
                            {line.productName}
                          </span>
                          {lineWarnings.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {lineWarnings.map((warning) => (
                                <Badge key={warning.kind} tone="attention">
                                  {warningText(warning)}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          <MrpOffer
                            line={line}
                            product={index?.products.find((product) => product.id === line.productId)}
                            isOwner={isOwner}
                            onRecorded={refresh}
                          />
                        </div>
                        <Button
                          kind="quiet"
                          className="size-11 shrink-0 p-0 text-2xl text-ink-2 hover:text-red -mr-2 -mt-2"
                          onClick={() => {
                            removeLine(line.lineId);
                          }}
                          aria-label={`Remove ${line.productName}`}
                        >
                          ×
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-2 text-body-sm">
                        <div className="flex justify-between">
                          <span className="text-ink-2">Qty:</span>
                          <span className="numeral font-medium">
                            {line.entered
                              ? `${line.entered.unitCount} ${line.entered.unitName}`
                              : `${line.qtyBase} ${line.baseUnitName}`}
                            {line.entered && line.entered.bonusUnitCount > 0
                              ? ` (+${line.entered.bonusUnitCount})`
                              : line.bonusQtyBase > 0
                                ? ` (+${line.bonusQtyBase})`
                                : ''}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-2">Cost each:</span>
                          <span className="numeral font-medium">
                            {formatPaisa(paisa(line.entered?.unitCostPaisa ?? line.unitCostPaisa), {
                              withSymbol: true,
                            })}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-2">Expiry · batch:</span>
                          <span className="numeral font-medium">
                            {line.expiryDate ? formatExpiry(line.expiryDate) : '—'}
                            {line.batchNumber ? (
                              <span className="text-ink-2"> · {line.batchNumber}</span>
                            ) : null}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-2">Sells for:</span>
                          <span className="numeral font-medium">
                            {formatPaisa(
                              paisa(line.entered?.pricePaisa ?? line.priceAtReceivingPaisa),
                              { withSymbol: true },
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-baseline justify-between border-t border-line pt-2">
                        <span className="text-label text-ink-2">Amount</span>
                        <span className="numeral text-control font-semibold text-navy">
                          {formatPaisa(paisa(lineCostPaisa(line)), { withSymbol: true })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <aside
            aria-label="Invoice"
            className="flex min-w-0 w-full max-w-full flex-col gap-3 md:grid md:grid-cols-2 md:items-start md:gap-4 lg:sticky lg:top-0 lg:flex lg:w-[340px] lg:shrink-0 lg:items-stretch"
          >
            <div className={`${cardClass} gap-2 max-md:hidden`}>
              <span className="text-label text-ink-2">Invoice total</span>
              <p
                aria-label="Invoice total"
                className="text-navy numeral text-total m-0 text-right font-semibold tracking-tight whitespace-nowrap"
              >
                {invoiceTotalText}
              </p>
              <p className="text-body-sm text-ink-2 m-0 flex justify-between">
                <span>Lines</span>
                <b className="numeral text-navy font-medium">{draft.lines.length}</b>
              </p>
            </div>

            {/* [PCN-007] What was paid to the distributor now. Left empty it
                means "paid in full" (the ordinary cash purchase); less, and the
                rest goes on this supplier's account — the mirror of an udhaar
                sale. */}
            <div className={`${cardClass} gap-2.5 max-md:p-4`}>
              <label className="flex min-w-0 flex-col gap-1.5">
                <FieldLabel>Paid now</FieldLabel>
                <span className="relative block">
                  <span
                    aria-hidden="true"
                    className="text-body-sm pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-2"
                  >
                    Rs
                  </span>
                  <input
                    autoComplete="off"
                    id="cash-paid"
                    value={draft.cashPaidText ?? ''}
                    inputMode="decimal"
                    placeholder={(invoiceTotal / 100).toFixed(2)}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, cashPaidText: event.target.value }));
                    }}
                    // Enter receives, as Enter in Cash tendered completes a sale. A
                    // figure that looks like a barcode still needs the click.
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (!needsClickToCommit(cashPaidPaisa)) void receive();
                      }
                    }}
                    aria-invalid={cashPaidUnreadable ? true : undefined}
                    aria-describedby="cash-paid-says"
                    className={`${inputClass} numeral text-field-lg pl-11 text-right font-medium`}
                  />
                </span>
              </label>
              <p
                id="cash-paid-says"
                className="text-body-sm m-0"
                role={cashPaidUnreadable || needsClickToCommit(cashPaidPaisa) ? 'alert' : undefined}
              >
                {cashPaidUnreadable ? (
                  <strong className="text-red font-medium">
                    Not an amount — type what was paid, or clear it for paid in full.
                  </strong>
                ) : needsClickToCommit(cashPaidPaisa) ? (
                  <strong className="text-amber-text font-medium">
                    {formatPaisa(paisa(cashPaidPaisa), { withSymbol: true })} looks like a barcode.
                    Check Paid now.
                  </strong>
                ) : draft.lines.length === 0 ? (
                  <span className="text-ink-2">Leave it empty when you pay the whole bill.</span>
                ) : creditPaisa > 0 ? (
                  <>
                    <strong className="text-amber-text font-semibold">
                      {formatPaisa(paisa(creditPaisa), { withSymbol: true })} less than the bill.
                    </strong>{' '}
                    {draft.supplierName ? (
                      <>
                        It goes on {draft.supplierName}’s account
                        {supplierBalance !== null ? (
                          <>
                            {' '}
                            — after this{' '}
                            <SupplierPosition
                              balancePaisa={supplierBalance + creditPaisa}
                              midSentence
                            />
                          </>
                        ) : null}
                        .
                      </>
                    ) : (
                      <span className="text-amber-text">
                        Choose a supplier to put it on their account.
                      </span>
                    )}
                  </>
                ) : overPaisa > 0 ? (
                  <>
                    <strong className="font-semibold">
                      {formatPaisa(paisa(overPaisa), { withSymbol: true })} more than the bill.
                    </strong>
                    {draft.supplierName && supplierBalance !== null ? (
                      <>
                        {' '}
                        After this {draft.supplierName}:{' '}
                        <SupplierPosition balancePaisa={supplierBalance - overPaisa} midSentence />.
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <strong className="font-semibold text-green-700">Paid in full.</strong>{' '}
                    <span className="text-ink-2">Leave it empty when you paid the whole bill.</span>
                  </>
                )}
              </p>
            </div>

            <nav
              aria-label="Suppliers and deliveries"
              className="-ml-3 flex flex-wrap gap-2 md:self-center lg:self-auto"
            >
              <a href="#owed-to-suppliers" className={buttonClass('quiet')}>
                Owed to suppliers
              </a>
              <a href="#recent-deliveries" className={buttonClass('quiet')}>
                Recent deliveries
              </a>
              {/* [PCN-013] The owed list holds only open balances; a settled
                  supplier, the usual state of one added by mistake, is reached
                  from here. */}
              <Link href="/purchases/suppliers" className={buttonClass('quiet')}>
                All suppliers
              </Link>
            </nav>

            <div className="max-md:hidden md:col-start-2 lg:mt-2">{receiveButton}</div>
          </aside>
        </div>

        <div className="mt-6 flex flex-col gap-4 md:mt-8">
          <div id="owed-to-suppliers" className="scroll-mt-4">
            <SupplierCreditPanel reloadKey={receivedCount} />
          </div>
          <div id="recent-deliveries" className="scroll-mt-4">
            <RecentPurchases reloadKey={receivedCount} />
          </div>
        </div>
      </div>

      {/* Phone: Receive in a bar above the tabs, the invoice total beside it. */}
      {!isKeyboardOpen ? (
        <div className="bg-surface shadow-bar flex shrink-0 flex-col gap-1 px-4 py-3 md:hidden">
          <p className="text-body-sm text-ink-2 m-0 flex items-baseline justify-between">
            <span>Invoice total · {lineCountText}</span>
            <b className="numeral text-stat text-navy font-semibold">{invoiceTotalText}</b>
          </p>
          <Button
            kind="primary"
            block
            onClick={() => void receive()}
            disabled={!canReceive}
            className="h-[52px] text-[17px]"
          >
            {busy ? 'Receiving…' : 'Receive stock'}
          </Button>
        </div>
      ) : null}

      {picking ? (
        <SupplierPicker
          onPick={(supplier) => {
            setDraft((current) => ({
              ...current,
              supplierId: supplier.id,
              supplierName: supplier.name,
            }));
            setSupplierBalance(supplier.balancePaisa);
            setPicking(false);
            // On along W7's path: the invoice number comes next. Without this
            // focus fell to the page, and Tab went to the key bar.
            requestAnimationFrame(() => invoiceRefRef.current?.focus());
          }}
          onCancel={() => {
            setPicking(false);
            requestAnimationFrame(() => supplierRef.current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

/** The design system's chevron, for a control that opens something. */
function Chevron() {
  return (
    <span
      aria-hidden="true"
      className="ml-1 inline-block size-[7px] shrink-0 -translate-y-0.5 rotate-45 border-r-[1.6px] border-b-[1.6px] border-current"
    />
  );
}

/** `2026-10-29` → `29/10/2026`: a date as the shop reads it. */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

/** "10 strip", "100 tab": the chosen pack's size, in the packs beneath it. */
function describeUnitSize(
  unit: ProductUnit,
  pending: { units: ProductUnit[]; baseUnitName: string },
): string {
  const smaller = pending.units
    .filter((candidate) => candidate.factor > 1 && candidate.factor < unit.factor)
    .map((candidate) => ({ name: candidate.name, factor: packFactor(candidate.factor) }));
  return describeQuantity(baseQty(unit.factor), pending.baseUnitName, smaller);
}

/** "you owe Rs 4,500.00" beside the supplier's name. */
function lowerFirst(phrase: string): string {
  return phrase.charAt(0).toLowerCase() + phrase.slice(1);
}

/**
 * One of the line's fields. The input is nested inside its label rather than
 * wired by id: these fields are re-created per line, and generated ids would
 * either collide or drift. Implicit association is what makes the field
 * reachable by name — to a screen reader and to the keyboard path the
 * definition of done requires.
 */
function LineField({
  label,
  attention = false,
  rupees = false,
  text = false,
  onFocus,
  ...input
}: Omit<React.ComponentProps<'input'>, 'autoComplete'> & {
  label: string;
  /** Asked of the operator specifically (read it off the pack): said in amber. */
  attention?: boolean;
  /** Money: `Rs` before the figure. */
  rupees?: boolean;
  /** Words, not a figure: left-aligned. */
  text?: boolean;
}) {
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    onFocus?.(e);
    if (isMobileBrowser()) {
      setTimeout(() => {
        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  };
  const field = (
    <input
      autoComplete="off"
      className={`${inputClass} ${text ? '' : 'numeral text-right'} ${rupees ? 'pl-11' : ''}`}
      onFocus={handleFocus}
      {...input}
    />
  );
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      {/* One line always: a label that wraps makes its field look like a
          different level of the form. A long unit name is cut, in full on
          hover. */}
      <span
        title={label}
        className={`h-label text-label block truncate whitespace-nowrap ${attention ? 'text-amber-text font-semibold' : 'text-ink-2'}`}
      >
        {label}
      </span>
      {rupees ? (
        <span className="relative block">
          <span
            aria-hidden="true"
            className="text-body-sm pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-2"
          >
            Rs
          </span>
          {field}
        </span>
      ) : (
        field
      )}
    </label>
  );
}

/** I5 — plain words. All are warnings, never blocks (D4, T1). */
function warningText(warning: PurchaseWarning): string {
  switch (warning.kind) {
    case 'price_above_mrp':
      return 'Above MRP';
    case 'price_below_cost':
      return 'Sells below cost';
    case 'expiry_missing':
      return 'No expiry';
    case 'expiry_in_past':
      return 'Expired';
    case 'expiry_soon':
      return 'Expires soon';
  }
}

/**
 * [PCN-012] The pack's MRP differs from the product's record: say so, and let
 * the owner take it — with the new selling price when the line's differs —
 * or leave the record as it is. Never applied silently (D4: the pack in hand
 * is authoritative, but the price is the owner's decision).
 */
function MrpOffer({
  line,
  product,
  isOwner,
  onRecorded,
}: {
  line: DraftLine;
  product: IndexedProduct | undefined;
  isOwner: boolean;
  onRecorded: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | { error: string }>('idle');
  const entered = line.entered;
  const onPack = line.mrpAtReceivingPaisa;
  // Derived for an index cached before PCN-012, as everywhere else.
  const units = product
    ? unitsOf({
        baseUnitName: product.baseUnitName,
        packLevels: product.packLevels,
        pricePerBasePaisa: product.pricePaisa,
        units: product.units,
      })
    : [];
  const unit = units.find((candidate) => candidate.key === entered?.unitKey);
  if (!entered || onPack === null || !product || !unit) {
    return null;
  }
  const recorded = recordedMrpFor(
    { mrpPaisa: product.mrpPaisa, mrpUnit: product.mrpUnit ?? null, units },
    unit,
  );
  if (state === 'done') {
    return (
      <span className="text-green-700 block text-xs" role="status">
        Recorded on {product.name}.
      </span>
    );
  }
  if (recorded === onPack) {
    return null;
  }
  const newPrice = entered.pricePaisa !== unit.pricePaisa ? entered.pricePaisa : null;

  async function record(pricePaisa: number | null): Promise<void> {
    if (!unit || onPack === null) return;
    setState('busy');
    const outcome = await recordDeliveredMrpAction({
      productId: line.productId,
      unitKey: unit.key,
      mrpPaisa: onPack,
      pricePaisa,
    }).catch(() => ({ ok: false as const, message: 'Needs internet — try again.' }));
    if (outcome.ok) {
      setState('done');
      onRecorded();
    } else {
      setState({ error: outcome.message });
    }
  }

  return (
    <span className="mt-1 block text-xs" role="note">
      <span className="text-amber-text">
        MRP on pack {formatPaisa(paisa(onPack))} per {unit.name} —{' '}
        {recorded === null ? 'none on record' : `on record ${formatPaisa(paisa(recorded))}`}.
      </span>
      {isOwner ? (
        <span className="ml-2 inline-flex gap-3">
          {newPrice !== null ? (
            <button
              type="button"
              disabled={state === 'busy'}
              onClick={() => void record(newPrice)}
              className="text-blue-600 font-medium underline-offset-2 hover:underline"
            >
              Record it, and sell at {formatPaisa(paisa(newPrice))} per {unit.name}
            </button>
          ) : null}
          <button
            type="button"
            disabled={state === 'busy'}
            onClick={() => void record(null)}
            className="text-blue-600 font-medium underline-offset-2 hover:underline"
          >
            {newPrice !== null ? 'Record the MRP only' : 'Record the MRP'}
          </button>
        </span>
      ) : (
        <span className="text-ink-2 ml-2">The owner can update it.</span>
      )}
      {typeof state === 'object' ? (
        <span className="text-red ml-2" role="alert">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
