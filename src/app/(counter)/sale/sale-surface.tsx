'use client';

/**
 * The Sale surface — Phase 10 §4, "the 80% surface".
 *
 *   "Search bar, full width, top. Cart, left ~62%. Right rail ~38%: totals
 *    stacked large-to-small, TOTAL in the display's biggest numerals (I6)."
 *
 * Day 4 adds the payment overlay (tendered/change, split cash-credit), the
 * udhaar attach (the udhaar key, defect C5), and the printed receipt
 * (ADR-6). Focus
 * discipline is the thing to preserve as this file grows: focus lives in
 * search (Phase 7 rule 1), returns there after every commit, and every cart
 * edit is reachable without the mouse.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isMobileBrowser } from '@/client/navigation/device';
import { useCatalog } from '@/client/search/provider';
import { parseQuantityQuery } from '@/client/search/quantity-grammar';
import { lastSaleUnit, rememberSaleUnit } from '@/client/sale/last-unit';
import { useReceiptContext } from '@/client/receipt/receipt-context';
import {
  useRegisterUdhaarKeyHandler,
  useUdhaarKeyPress,
} from '@/client/keyboard/udhaar-key-context';
import { keyFor } from '@/client/keyboard/registry';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import type { ReceiptData } from '@/client/print/receipt';
import { CaptureBlockedError, useSync } from '@/client/sync/provider';
import { MatchTier, type SearchHit } from '@/client/search/catalog-index';
import { ProductSearch } from '@/components/product-search';
import { CustomerPicker } from '@/components/customer-picker';
import { QuickItemForm, type QuickItemDraft } from '@/components/quick-item-form';
import { ReceiptView } from '@/components/receipt-view';
import { PositionInline } from '@/components/balance-figure';
import { Banner, BannerMark } from '@/components/ui/banner';
import { Button, Kbd, buttonClass } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import type { CustomerHit } from '@/app/(counter)/customers/actions';
import { barcodeOwnerAction, linkScannedCode } from '@/app/(counter)/products/actions';
import { barcodeToStore, parseGs1 } from '@/domain/catalog/barcode';
import { businessDayOf } from '@/lib/business-day';
import { miniStatement } from '@/domain/udhaar/settlement';
// From the pure module, never from `commit-sale.ts`: that one reaches the
// database, and importing it here would pull `server-only` into the browser.
import { validateSaleCommand, type SaleRejection } from '@/domain/sales/sale-command';
import { defaultSaleUnit, unitsOf } from '@/domain/catalog/units';
import {
  addToCart,
  cartTotals,
  DEFAULT_BILL_DISCOUNT_CAP_PERCENT,
  grossSubtotalPaisa,
  isPriceOverridden,
  lineTotal,
  lineUnit,
  newCartLine,
  removeLine,
  totalLineDiscountPaisa,
  updateLine,
  type CartLine,
} from '@/domain/sales/cart';
import { packFactor, paisa } from '@/lib/branded';
import { formatExpiry } from '@/lib/expiry';
import { formatPaisa } from '@/lib/money';
import { nominalPricePerBase } from '@/lib/quantity';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { PIN_LENGTH } from '@/auth/pin-policy';
import { positionPhrase } from '@/components/balance-figure';
import { FieldLabel, inputClass } from '@/components/ui/field';
import { needsClickToCommit } from '@/client/scan/amount-guard';
import { ZERO_PAISA, type Paisa } from '@/lib/branded';
import {
  billDiscountFromInput,
  billDiscountNeedsApproval,
  paisaFromRupeeInput,
  splitPayment,
} from '@/domain/sales/cart';
import { approveBillDiscountAction } from './actions';
import { CartTable } from './cart-table';
export interface PaymentSplit {
  cashPaisa: Paisa;
  creditPaisa: Paisa;
  changePaisa: Paisa;
  tenderedPaisa: Paisa;
}

/** [PCN-014] The bill discount the sale is committed with, and who approved it. */
export interface BillDiscount {
  discountPaisa: Paisa;
  approvedBy: { id: string; name: string } | null;
}

/**
 * Pay's key. Sale's own, not the global bar's, so it is not in the registry;
 * the hint on the button and the handler read this one constant.
 */
const PAY_KEY = 'F12';


interface Committed {
  receiptNumber: string;
  totalPaisa: number;
  /** Base units sold beyond what the index believed was there (D2, advisory). */
  pendingUnits: number;
  /** Kept so the operator can put this one on paper after the fact. */
  receipt: ReceiptData;
}

/** I5 — say the next action, plainly. The domain names the reason; this names the fix. */
function messageForRejection(reason: SaleRejection): string {
  switch (reason) {
    case 'empty_cart':
      return 'The cart is empty.';
    case 'invalid_quantity':
      return 'One of the lines has no quantity.';
    case 'split_mismatch':
      return 'The cash and credit split does not add up to the total.';
    case 'credit_without_customer':
      return 'Attach a customer before putting anything on udhaar.';
    case 'negative_amount':
      return 'Check the discounts — something came out negative.';
    default:
      return 'That did not save. Try again.';
  }
}

export function SaleSurface() {
  const { index, refresh, addLocalProduct } = useCatalog();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Committed | null>(null);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  /** F12 pressed while the customer was still being found: pay once attached. */
  const payAfterPick = useRef(false);
  /** The last scanned pack, when its own 2D code says it has expired. */
  const [expiredPack, setExpiredPack] = useState<{ name: string; expiry: string } | null>(null);

  // Bill discount and cash received state
  const [discountInput, setDiscountInput] = useState('');
  const [approval, setApproval] = useState<{
    discountPaisa: Paisa;
    by: { id: string; name: string };
  } | null>(null);
  const [pinEntry, setPinEntry] = useState<{ pin: string; message: string | null; busy: boolean }>({
    pin: '',
    message: null,
    busy: false,
  });
  const [cashReceivedInput, setCashReceivedInput] = useState('');
  const [cashReceivedTyped, setCashReceivedTyped] = useState(false);
  const [amountNotice, setAmountNotice] = useState<string | null>(null);

  const discountField = useRef<HTMLInputElement>(null);
  const cashReceivedField = useRef<HTMLInputElement>(null);
  const pinField = useRef<HTMLInputElement>(null);
  /**
   * W6's pending mini-form: the typed name, plus the resolver the search awaits.
   * From an unknown scan it also carries the code, and — if another product
   * turns out to own that code — that product, so the form can refuse to put
   * the code on a second one.
   */
  const [quickAdd, setQuickAdd] = useState<{
    name: string;
    code: string | null;
    owner: { name: string; hit: SearchHit | null } | null;
    settle: (added: boolean) => void;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const receiptContext = useReceiptContext();
  const udhaarEnabled = receiptContext?.udhaarEnabled ?? true;
  const pressUdhaarKey = useUdhaarKeyPress();
  const { receipt, print, clear: clearPrinted } = usePrintReceipt();
  const { capture } = useSync();

  // Defect C5: the udhaar key belongs to Sale only while the cart has
  // something to bill. An empty cart leaves it unregistered, so AppShell's
  // Settle Udhaar fallback runs instead.
  useRegisterUdhaarKeyHandler(
    udhaarEnabled && lines.length > 0
      ? () => {
          setPickingCustomer(true);
        }
      : null,
  );

  // The cart's figures before payment: subtotal is net of line discounts.
  const grossPaisa = useMemo(() => grossSubtotalPaisa(lines), [lines]);
  const discountOnItems = useMemo(() => totalLineDiscountPaisa(lines), [lines]);
  const baseTotals = useMemo(() => cartTotals(lines), [lines]);
  const subtotalPaisa = baseTotals.subtotalPaisa;

  // Bill discount calculation
  const parsedDiscount = useMemo(
    () => billDiscountFromInput(subtotalPaisa, discountInput),
    [subtotalPaisa, discountInput],
  );
  const billDiscountPaisa = parsedDiscount.ok ? parsedDiscount.discountPaisa : ZERO_PAISA;
  const totals = useMemo(() => cartTotals(lines, billDiscountPaisa), [lines, billDiscountPaisa]);

  const capPercent = receiptContext?.billDiscountCapPercent ?? DEFAULT_BILL_DISCOUNT_CAP_PERCENT;
  const needsOwner = billDiscountNeedsApproval({
    grossPaisa,
    itemDiscountPaisa: discountOnItems,
    billDiscountPaisa,
    capPercent,
  });
  const approvedBy =
    approval !== null && approval.discountPaisa === billDiscountPaisa ? approval.by : null;
  const waitingForOwner = needsOwner && approvedBy === null;

  // Cash received & Split calculation
  const cashReceivedText = cashReceivedTyped
    ? cashReceivedInput
    : lines.length === 0
      ? ''
      : (totals.totalPaisa / 100).toFixed(2);
  const cashReceivedPaisa = paisaFromRupeeInput(cashReceivedText);
  const split = splitPayment(totals.totalPaisa, cashReceivedPaisa);
  const short = split.creditPaisa > 0;

  const canCommit =
    lines.length === 0
      ? false
      : !busy &&
        receiptContext !== null &&
        parsedDiscount.ok &&
        !waitingForOwner &&
        (!short || customer !== null);

  const stockByProduct = useMemo(() => {
    const stock: Record<string, number | null> = {};
    for (const line of lines) {
      stock[line.productId] = index?.stockOf(line.productId) ?? null;
    }
    return stock;
  }, [lines, index]);

  // PCN-008: the warning before payment, from the same snapshot as stock.
  const expiredByProduct = useMemo(() => {
    const expired: Record<string, { qtyBase: number; expiryDate: string } | null> = {};
    for (const line of lines) {
      expired[line.productId] = index?.expiredOf(line.productId) ?? null;
    }
    return expired;
  }, [lines, index]);

  const focusSearch = useCallback(() => {
    setSelectedLineId(null);
    if (!isMobileBrowser()) {
      searchRef.current?.focus();
    }
  }, []);

  /**
   * A search selection becomes a cart line.
   *
   * The quantity comes from the grammar the operator typed (`3*pana`), or from
   * the barcode's own unit level when the item was scanned — a box code means a
   * box, not a strip (Phase 5 §2).
   */
  const startsLoose = receiptContext?.saleStartsLoose ?? false;
  const onSelect = useCallback(
    (hit: SearchHit, rawQuery: string) => {
      const { count } = parseQuantityQuery(rawQuery);
      // [PCN-012] Each unit at its own price; derived for an index cached
      // before PCN-012.
      const units = unitsOf({
        baseUnitName: hit.product.baseUnitName,
        packLevels: hit.product.packLevels,
        pricePerBasePaisa: hit.product.pricePaisa,
        units: hit.product.units,
      });
      // A scanned code keeps its own unit; otherwise the unit this counter last
      // sold the product in, else the shop's configured start (PCN-012).
      const level =
        hit.unitLevelName ??
        defaultSaleUnit(units, lastSaleUnit(hit.product.id), startsLoose)?.name ??
        hit.product.baseUnitName;

      const line = newCartLine({
        lineId: uuidv7(),
        productId: hit.product.id,
        name: hit.product.name,
        strength: hit.product.strength,
        baseUnitName: hit.product.baseUnitName,
        packLevels: hit.product.packLevels,
        units,
        unitName: level,
        count,
      });
      setLines((current) => addToCart(current, line));
      // The pack in hand, not the batch FEFO will allocate: its own code says
      // when it expires. Said, never blocked (P2) — the operator checks the pack.
      const pack = parseGs1(rawQuery);
      setExpiredPack(
        pack?.expiry && pack.expiry < businessDayOf(new Date())
          ? { name: hit.product.name, expiry: pack.expiry }
          : null,
      );
      setLastSale(null);
      setError(null);
    },
    [startsLoose],
  );

  /**
   * Commits the cart — ADR-3's local commit, Phase 7 rule 3.
   *
   * The sale is captured into the durable outbox and the receipt prints on that
   * capture, not on a server response. Whether the network is there decides how
   * long the badge in the top bar shows a number, and nothing else about this
   * function: the counter's rhythm is identical online and offline, which is
   * the entire promise of ADR-3.
   *
   * Two figures on the receipt are therefore the client's last-known values
   * rather than the server's authoritative ones — the customer's balance for
   * the mini-statement, and whether the sale outran stock. That is ADR-5's
   * stated posture ("the client's last-known price at sale time; final
   * allocation may adjust recorded margin, never the customer's charged
   * price"), applied to the two other numbers a receipt shows. The authoritative
   * pending layer is created server-side at ingestion, and the balance is
   * re-derivable from records at any time (Phase 5 invariant 3).
   */
  const commitWithSplit = useCallback(
    async (split: PaymentSplit, bill: BillDiscount) => {
      if (lines.length === 0 || busy || !receiptContext) {
        return;
      }

      const soldLines = lines;
      // [PCN-014] The bill discount given on the payment screen.
      const soldTotals = cartTotals(lines, bill.discountPaisa);
      const soldCustomer = customer;
      const receiptNumber = receiptContext.nextReceiptNumber();

      const command = {
        saleId: uuidv7(),
        receiptNumber,
        customerId: soldCustomer?.id ?? null,
        lines: soldLines.map((line) => ({
          lineId: line.lineId,
          productId: line.productId,
          qtyBase: line.qtyBase,
          enteredUnitLevel: line.enteredUnitLevel,
          // [PCN-012] The exact charge is count × the unit's price; the
          // per-base figure is nominal, for a column older readers expect.
          unitPricePaisa: nominalPricePerBase(
            line.pricePerUnitPaisa,
            packFactor(lineUnit(line)?.factor ?? 1),
          ),
          unitKey: line.unitKey,
          unitName: line.enteredUnitLevel,
          unitCount: line.unitCount,
          unitPricePaisaEntered: line.pricePerUnitPaisa,
          lineDiscountPaisa: line.lineDiscountPaisa,
          priceOverridden: isPriceOverridden(line),
        })),
        invoiceDiscountPaisa: soldTotals.invoiceDiscountPaisa,
        invoiceDiscountApprovedBy: (bill.approvedBy?.id as Uuid | undefined) ?? null,
        cashPaisa: split.cashPaisa,
        creditPaisa: split.creditPaisa,
        changePaisa: split.changePaisa,
        clientCommittedAt: new Date().toISOString(),
      };

      // The domain's own validator, run before the receipt prints — the reason
      // it is pure and exported (see `commit-sale.ts`). Queue-first commits
      // mean a server rejection would arrive after the paper, so the rules that
      // can be checked locally are checked locally.
      const validation = validateSaleCommand({
        ...command,
        origin: 'online',
        clientSchemaVersion: 1,
        clientCommittedAt: new Date(command.clientCommittedAt),
      });
      if (!validation.ok) {
        receiptContext.skipReceiptNumber(receiptNumber);
        setError(messageForRejection(validation.reason));
        return;
      }

      setBusy(true);
      setError(null);

      try {
        await capture({ kind: 'sale', payload: command });
        // [PCN-012] The next line of each product starts in the unit it was
        // sold in now — recorded on the sale, never on an abandoned cart.
        for (const line of soldLines) {
          rememberSaleUnit(line.productId, line.unitKey);
        }
      } catch (error) {
        // The outbox refused the record, so it is not durable, so no receipt
        // may claim it happened. Either the licence is not active (PCN-006, a
        // deliberate refusal) or the machine could not persist it (a broken
        // machine rather than a broken network). Both stop the sale.
        receiptContext.skipReceiptNumber(receiptNumber);
        setError(
          error instanceof CaptureBlockedError
            ? error.message
            : 'This machine could not save the sale. Do not hand over the items — get help.',
        );
        setBusy(false);
        return;
      }

      // Advisory, from the index's snapshot — the same figure the cart's amber
      // chip already showed (D2).
      const pendingUnits = soldLines.reduce((sum, line) => {
        const stock = index?.stockOf(line.productId) ?? null;
        return sum + (stock === null ? 0 : Math.max(0, line.qtyBase - stock));
      }, 0);

      const receiptData: ReceiptData = {
        receiptNumber,
        dateTime: new Date(),
        salesmanName: receiptContext.salesmanName,
        tenantHeaderLines: receiptContext.tenantHeaderLines,
        tenantFooterLine: receiptContext.tenantFooterLine,
        lines: soldLines.map((line) => ({
          name: line.name,
          // As sold: 2 strips is 2, never re-expressed as tablets (P9).
          quantity: line.unitCount,
          amountPaisa: lineTotal(line),
        })),
        // The receipt's Subtotal is the GROSS figure — before any line's own
        // discount — never `soldTotals.subtotalPaisa`, which sums `lineTotal`
        // (already net) and made Subtotal read identical to TOTAL whenever a
        // line was discounted. Discount is every line's own discount summed
        // into one row; [PCN-014] the bill discount has a row of its own.
        subtotalPaisa: grossSubtotalPaisa(soldLines),
        discountPaisa: totalLineDiscountPaisa(soldLines),
        ...(soldTotals.invoiceDiscountPaisa > 0
          ? { billDiscountPaisa: soldTotals.invoiceDiscountPaisa }
          : {}),
        totalPaisa: soldTotals.totalPaisa,
        cashPaisa: split.cashPaisa,
        tenderedPaisa: split.tenderedPaisa,
        changePaisa: split.changePaisa,
        creditPaisa: split.creditPaisa,
        ...(soldCustomer ? { customerName: soldCustomer.name } : {}),
        ...(split.creditPaisa > 0 && soldCustomer
          ? { miniStatement: miniStatement(soldCustomer.balancePaisa, split.creditPaisa) }
          : {}),
      };

      // The sale is already committed and the receipt already built; whether
      // paper comes out is a shop's preference, not a step in the workflow.
      // A shop that prints on request rather than by default still has the
      // receipt one key away, from local state, exactly as before.
      //
      // Printed BEFORE the screen says "Saved": while the browser prints, the
      // page takes no keys, and "Saved" is when the operator presses the next
      // one. Until then the payment screen stays up, busy.
      if (receiptContext.autoPrintReceipt) {
        await print(receiptData);
      } else {
        clearPrinted();
      }

      // Exactly the lines this sale sold, not whatever the cart holds now:
      // the print above is awaited, and a line added meanwhile is the next
      // sale's, which a blanket clear threw away.
      const sold = new Set(soldLines.map((line) => line.lineId));
      setLines((current) => current.filter((line) => !sold.has(line.lineId)));
      setExpiredPack(null);
      setCustomer(null);
      setLastSale({
        receiptNumber,
        totalPaisa: soldTotals.totalPaisa,
        pendingUnits,
        receipt: receiptData,
      });

      // Stock moved, so the index's advisory snapshot is stale. Harmless to ask
      // for while offline: the refresh fails and the cached catalog stands.
      refresh();
      setBusy(false);
      focusSearch();
    },
    [
      lines,
      busy,
      receiptContext,
      customer,
      index,
      capture,
      refresh,
      focusSearch,
      print,
      clearPrinted,
    ],
  );

  /**
   * W6 — the shelf item that is not in the catalog, with a customer waiting.
   *
   * The product is real from this moment (D3: "never an anonymous line"), and
   * it is real *locally* first: added to the index so the cart line renders and
   * the next search finds it, captured into the outbox so it becomes real on
   * the server whenever the server is next reachable. FIFO delivery is what
   * guarantees it arrives before the sale whose line points at it.
   */
  const createQuickItem = useCallback(
    async (draft: QuickItemDraft): Promise<void> => {
      const product = {
        id: uuidv7(),
        name: draft.name,
        strength: null,
        form: null,
        manufacturer: null,
        formulaText: null,
        baseUnitName: draft.baseUnitName,
        packLevels: [],
        pricePaisa: draft.pricePaisa,
        mrpPaisa: null,
        needsCompletion: true,
      };

      try {
        await capture({
          kind: 'quick_item',
          payload: {
            id: product.id,
            name: product.name,
            pricePaisa: product.pricePaisa,
            baseUnitName: product.baseUnitName,
            barcode: draft.barcode,
          },
        });
      } catch (error) {
        // A restricted installation (PCN-006) may not create new products, and
        // the quick item is a product. Surface the reason rather than adding a
        // cart line for something the outbox refused to record.
        if (error instanceof CaptureBlockedError) {
          setError(error.message);
          return;
        }
        throw error;
      }

      // With its code, so the next scan of this pack adds it directly.
      addLocalProduct(
        product,
        draft.barcode
          ? { barcode: draft.barcode, productId: product.id, unitLevelName: product.baseUnitName }
          : undefined,
      );

      setLines((current) =>
        addToCart(
          current,
          newCartLine({
            lineId: uuidv7(),
            productId: product.id,
            name: product.name,
            baseUnitName: product.baseUnitName,
            packLevels: [],
            units: unitsOf({
              baseUnitName: product.baseUnitName,
              packLevels: [],
              pricePerBasePaisa: product.pricePaisa,
              units: null,
            }),
            unitName: product.baseUnitName,
            count: 1,
          }),
        ),
      );
      setLastSale(null);
      setError(null);
    },
    [capture, addLocalProduct],
  );

  async function submitPin(): Promise<void> {
    if (pinEntry.pin.length !== PIN_LENGTH || pinEntry.busy) return;
    const asked = billDiscountPaisa;
    setPinEntry((current) => ({ ...current, busy: true, message: null }));
    const answer = await approveBillDiscountAction(pinEntry.pin).catch(() => null);
    if (answer === null) {
      setPinEntry({
        pin: '',
        busy: false,
        message:
          'The owner’s PIN needs a connection to the shop’s computer. Sell at the full amount, or within the limit.',
      });
      return;
    }
    if (!answer.ok) {
      setPinEntry({ pin: '', busy: false, message: answer.message });
      return;
    }
    setApproval({ discountPaisa: asked, by: { id: answer.ownerId, name: answer.ownerName } });
    setPinEntry({ pin: '', message: null, busy: false });
    cashReceivedField.current?.focus();
    cashReceivedField.current?.select();
  }

  function clearDiscount(): void {
    setDiscountInput('');
    setPinEntry({ pin: '', message: null, busy: false });
    cashReceivedField.current?.focus();
    cashReceivedField.current?.select();
  }

  const executeSale = useCallback(
    async (isClick = false) => {
      if (lines.length === 0 || busy || !receiptContext) {
        return;
      }
      if (!parsedDiscount.ok) {
        discountField.current?.focus();
        discountField.current?.select();
        return;
      }
      if (waitingForOwner) {
        pinField.current?.focus();
        return;
      }
      if (!isClick && needsClickToCommit(cashReceivedPaisa)) {
        setAmountNotice(
          `${formatPaisa(cashReceivedPaisa, { withSymbol: true })} received looks like a barcode. If it is right, click Pay.`,
        );
        return;
      }
      if (short && customer === null) {
        cashReceivedField.current?.focus();
        cashReceivedField.current?.select();
        return;
      }
      if (!canCommit) {
        return;
      }

      const bill: BillDiscount = {
        discountPaisa: billDiscountPaisa,
        approvedBy,
      };
      const paymentSplit: PaymentSplit = {
        ...split,
        tenderedPaisa: cashReceivedPaisa,
      };

      await commitWithSplit(paymentSplit, bill);
      setDiscountInput('');
      setCashReceivedInput('');
      setCashReceivedTyped(false);
      setApproval(null);
      setPinEntry({ pin: '', message: null, busy: false });
      setAmountNotice(null);
    },
    [
      lines,
      busy,
      receiptContext,
      parsedDiscount,
      waitingForOwner,
      cashReceivedPaisa,
      short,
      customer,
      canCommit,
      billDiscountPaisa,
      approvedBy,
      split,
      commitWithSplit,
    ],
  );

  // F12 commits the sale directly from anywhere on the surface (no popup modal).
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === PAY_KEY) {
        event.preventDefault();
        if (document.querySelector('[aria-modal="true"]')) {
          if (pickingCustomer) payAfterPick.current = true;
          return;
        }
        void executeSale(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [executeSale, pickingCustomer]);

  const payDisabled =
    lines.length === 0 ||
    busy ||
    !receiptContext ||
    !parsedDiscount.ok ||
    waitingForOwner ||
    (short && customer === null);

  const itemsSummary =
    lines.length === 0
      ? 'Nothing on the bill'
      : `${totals.lineCount} line${totals.lineCount === 1 ? '' : 's'} · ${totals.itemCount} unit${totals.itemCount === 1 ? '' : 's'}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3 md:gap-4 md:p-6 lg:flex-row lg:gap-6 lg:overflow-hidden lg:px-8">
        {/* Cart — Phase 10 §4's ~62%; the rail is the rest. */}
        <section
          aria-label="Cart"
          className="flex min-w-0 flex-col gap-3 md:gap-4 lg:min-h-0 lg:flex-1"
        >
          <ProductSearch
            label="Search or scan"
            hint={<>↑ goes to the cart</>}
            onSelect={onSelect}
            inputRef={searchRef}
            onEnterCart={() => {
              const last = lines[lines.length - 1];
              if (last) {
                setSelectedLineId(last.lineId);
              }
            }}
            onQuickAdd={(name, code) =>
              new Promise<boolean>((settle) => {
                // The counter's own index first (works offline); then the server,
                // which also catches a code linked since this index was built.
                const local = code ? (index?.resolveBarcode(code) ?? null) : null;
                setQuickAdd({
                  name,
                  code: code ?? null,
                  owner: local ? { name: local.product.name, hit: local } : null,
                  settle,
                });
                if (code && !local) {
                  void barcodeOwnerAction(code)
                    .then((found) => {
                      if (!found) return;
                      const hit =
                        index?.products.find((product) => product.id === found.productId) ?? null;
                      setQuickAdd((current) =>
                        current && current.code === code
                          ? {
                              ...current,
                              owner: {
                                name: found.productName,
                                hit: hit
                                  ? {
                                      product: hit,
                                      tier: MatchTier.Barcode,
                                      matchedOn: 'barcode',
                                      stockBase: index?.stockOf(hit.id) ?? null,
                                    }
                                  : null,
                              },
                            }
                          : current,
                      );
                    })
                    .catch(() => {
                      // Offline: the index check above is what there is, and the
                      // server will still refuse to attach a code it finds taken.
                    });
                }
              })
            }
            // Phase 10 §5: an unknown scan links in place. On success the
            // index is refreshed so the next scan of this code is a plain hit.
            onLinkCode={async (code, productId, unitLevelName) => {
              const outcome = await linkScannedCode(productId as Uuid, code, unitLevelName);
              if (outcome.ok) {
                refresh();
              }
              return outcome;
            }}
          />

          {/* The card's shadow needs room to fall inside the scroller. */}
          <div className="lg:-mx-2 lg:min-h-0 lg:overflow-auto lg:px-2 lg:pb-2">
            <CartTable
              lines={lines}
              selectedLineId={selectedLineId}
              activeLineId={lines[lines.length - 1]?.lineId ?? null}
              stockByProduct={stockByProduct}
              expiredByProduct={expiredByProduct}
              onSelect={setSelectedLineId}
              onChange={(lineId, patch) => {
                setLines((current) => updateLine(current, lineId, patch));
              }}
              onRemove={(lineId) => {
                setLines((current) => removeLine(current, lineId));
                focusSearch();
              }}
              onLeaveCart={focusSearch}
              onPay={() => void executeSale(false)}
            />
          </div>
        </section>

        <aside
          aria-label="Bill"
          className="flex flex-col gap-3 md:grid md:grid-cols-2 md:items-start md:gap-4 lg:flex lg:items-stretch lg:w-[340px] lg:shrink-0 lg:overflow-auto"
        >
          <div className={`${cardClass} gap-3`}>
            <span className="text-label text-ink-2">Total</span>
            {/* I6: the biggest numerals on the display. */}
            <p
              aria-label="Total"
              className="text-navy numeral text-total m-0 text-right font-semibold tracking-tight whitespace-nowrap"
            >
              {formatPaisa(totals.totalPaisa, { withSymbol: true })}
            </p>
            <div className="flex flex-col gap-1 border-b border-border pb-3">
              <p className="text-body-sm text-ink-2 m-0 flex justify-between">
                <span>Items</span>
                <b className="numeral text-navy font-medium">{itemsSummary}</b>
              </p>
              {discountOnItems > 0 ? (
                <p className="text-body-sm text-ink-2 m-0 flex justify-between">
                  <span>Discount on items</span>
                  <b className="numeral text-navy font-medium">
                    {formatPaisa(paisa(discountOnItems), { withSymbol: true })}
                  </b>
                </p>
              ) : null}
              {billDiscountPaisa > 0 ? (
                <p className="text-body-sm text-ink-2 m-0 flex justify-between" aria-label="Bill discount">
                  <span>Bill discount</span>
                  <b className="numeral text-navy font-medium">
                    -{formatPaisa(billDiscountPaisa, { withSymbol: true })}
                    {approvedBy ? ` (by ${approvedBy.name})` : ''}
                  </b>
                </p>
              ) : null}
            </div>

            {/* Side-by-side Discount & Cash received */}
            <div className="grid grid-cols-2 gap-3 pt-3.5 px-1.5">
              <div className="flex flex-col gap-1">
                <label htmlFor="bill-discount" className="flex flex-col gap-1">
                  <FieldLabel>Discount</FieldLabel>
                  <input
                    id="bill-discount"
                    ref={discountField}
                    autoComplete="off"
                    value={discountInput}
                    inputMode="decimal"
                    placeholder="Amount or %"
                    aria-label="Discount"
                    aria-invalid={parsedDiscount.ok ? undefined : true}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => {
                      setDiscountInput(event.target.value);
                      setPinEntry({ pin: '', message: null, busy: false });
                      setAmountNotice(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (parsedDiscount.ok && waitingForOwner) {
                          pinField.current?.focus();
                        } else if (parsedDiscount.ok) {
                          cashReceivedField.current?.focus();
                          cashReceivedField.current?.select();
                        }
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setDiscountInput('');
                        setPinEntry({ pin: '', message: null, busy: false });
                        focusSearch();
                      }
                    }}
                    className={`${inputClass} numeral text-field-lg text-right font-medium pr-3 pl-2.5`}
                  />
                </label>
                {!parsedDiscount.ok ? (
                  <span className="text-body-sm text-red font-medium" role="alert">
                    {parsedDiscount.reason === 'above_bill'
                      ? `More than bill (${formatPaisa(subtotalPaisa, { withSymbol: true })})`
                      : 'e.g. 50 or 10%'}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="cash-received" className="flex flex-col gap-1">
                  <FieldLabel>Cash received</FieldLabel>
                  <span className="relative block">
                    <span
                      aria-hidden="true"
                      className="text-body-sm text-ink-2 pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-medium"
                    >
                      Rs
                    </span>
                    <input
                      id="cash-received"
                      ref={cashReceivedField}
                      autoComplete="off"
                      value={cashReceivedText}
                      inputMode="decimal"
                      aria-label="Cash received"
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => {
                        setCashReceivedInput(event.target.value);
                        setCashReceivedTyped(true);
                        setAmountNotice(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === '%') {
                          event.preventDefault();
                          discountField.current?.focus();
                          discountField.current?.select();
                          return;
                        }
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          if (needsClickToCommit(cashReceivedPaisa)) {
                            setAmountNotice(
                              `${formatPaisa(cashReceivedPaisa, { withSymbol: true })} received looks like a barcode. If it is right, click Pay.`,
                            );
                            return;
                          }
                          void executeSale(false);
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          if (cashReceivedTyped) {
                            setCashReceivedTyped(false);
                            setCashReceivedInput('');
                          }
                          focusSearch();
                        }
                      }}
                      className={`${inputClass} numeral pl-8 pr-3 text-right text-field-lg font-medium`}
                    />
                  </span>
                </label>
              </div>
            </div>

            {/* Change display */}
            {split.changePaisa > 0 ? (
              <div
                className="flex items-baseline justify-between rounded-control bg-blue-50/60 px-3 py-2"
                role="status"
              >
                <span className="text-label text-ink-2 font-medium">Change</span>
                <span
                  className="text-navy numeral text-xl font-bold tracking-tight"
                  aria-label={`Change ${formatPaisa(split.changePaisa, { withSymbol: true })}`}
                >
                  {formatPaisa(split.changePaisa, { withSymbol: true })}
                </span>
              </div>
            ) : null}

            {/* Shortfall / Udhaar display */}
            {short ? (
              <div className="flex flex-col gap-1.5">
                <div
                  className="flex items-baseline justify-between rounded-control bg-amber-50/60 px-3 py-2"
                  role="status"
                >
                  <span className="text-label text-ink-2 font-medium">
                    {customer ? 'On udhaar' : 'Remaining'}
                  </span>
                  <span
                    className="text-amber-text numeral text-xl font-bold tracking-tight"
                    aria-label={`${customer ? 'On udhaar' : 'Remaining'} ${formatPaisa(split.creditPaisa, { withSymbol: true })}`}
                  >
                    {formatPaisa(split.creditPaisa, { withSymbol: true })}
                  </span>
                </div>
                {customer ? (
                  <p className="text-body-sm m-0">
                    <strong className="text-amber-text font-medium">
                      {formatPaisa(split.creditPaisa, { withSymbol: true })} goes on {customer.name}’s udhaar.
                    </strong>
                    {customer.balancePaisa !== null
                      ? ` ${positionPhrase(customer.balancePaisa + split.creditPaisa)} after this.`
                      : null}
                  </p>
                ) : (
                  <p className="text-body-sm text-red m-0 font-medium" role="alert">
                    {udhaarEnabled
                      ? `Attach a customer (${keyFor('udhaar')}) to put the rest on udhaar.`
                      : 'The cash received does not cover the bill.'}
                  </p>
                )}
              </div>
            ) : null}

            {/* Owner PIN approval box */}
            {waitingForOwner ? (
              <div className="bg-page flex flex-col gap-2 rounded-card p-3 border border-border">
                <p className="text-body-sm m-0">
                  <strong className="text-amber-text font-medium">
                    Over the shop’s limit of {capPercent}%.
                  </strong>{' '}
                  The owner enters their PIN to approve it.
                </p>
                <div className="flex flex-col gap-1">
                  <label className="flex flex-col gap-1" htmlFor="owner-pin">
                    <FieldLabel>Owner’s PIN</FieldLabel>
                    <input
                      id="owner-pin"
                      ref={pinField}
                      autoComplete="one-time-code"
                      type="password"
                      inputMode="numeric"
                      maxLength={PIN_LENGTH}
                      value={pinEntry.pin}
                      aria-label="Owner’s PIN"
                      aria-invalid={pinEntry.message ? true : undefined}
                      readOnly={pinEntry.busy}
                      onChange={(event) =>
                        setPinEntry({
                          ...pinEntry,
                          pin: event.target.value.replace(/\D/g, ''),
                          message: null,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void submitPin();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          clearDiscount();
                        }
                      }}
                      className={`${inputClass} numeral text-center text-xl tracking-[0.4em]`}
                    />
                  </label>
                  {pinEntry.message ? (
                    <span className="text-body-sm text-red font-medium" role="alert">
                      {pinEntry.message}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button kind="quiet" onClick={clearDiscount}>
                    No discount <Kbd>Esc</Kbd>
                  </Button>
                  <Button
                    onClick={() => void submitPin()}
                    disabled={pinEntry.pin.length !== PIN_LENGTH || pinEntry.busy}
                  >
                    {pinEntry.busy ? (
                      'Checking…'
                    ) : (
                      <>
                        Approve <Kbd>Enter</Kbd>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : null}

            {amountNotice ? (
              <p className="text-body-sm text-red m-0 font-medium" role="alert">
                {amountNotice}
              </p>
            ) : null}

            <Button
              kind="primary"
              block
              onClick={() => void executeSale(true)}
              disabled={payDisabled}
              className="h-14 text-[17px] font-semibold mt-4 max-md:hidden"
            >
              {busy ? (
                'Saving…'
              ) : (
                <>
                  Pay <Kbd>{PAY_KEY}</Kbd>
                </>
              )}
            </Button>
          </div>

          {customer ? (
            <div className={`${cardClass} flex-row items-center gap-3 max-md:px-4 max-md:py-3`}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-control truncate font-semibold">{customer.name}</span>
                <span className="text-body-sm text-ink-2">
                  <PositionInline balancePaisa={customer.balancePaisa} className="font-normal" />
                  {customer.phone ? (
                    <span className="max-md:hidden"> · {customer.phone}</span>
                  ) : null}
                </span>
              </div>
              <Button
                kind="quiet"
                aria-label="Remove customer from this sale"
                onClick={() => {
                  setCustomer(null);
                }}
              >
                Remove
              </Button>
            </div>
          ) : !udhaarEnabled ? null : lines.length > 0 ? (
            <div className={`${cardClass} flex-row items-center gap-3 max-md:px-4 max-md:py-3`}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-control font-semibold">Cash walk-in</span>
                <span className="text-body-sm text-ink-2">
                  <span className="max-md:hidden">To put this on udhaar, attach a customer.</span>
                  <span className="md:hidden">Attach a customer for udhaar.</span>
                </span>
              </div>
              {/* A button, not only a hint: a tablet has no udhaar key. */}
              <Button
                onClick={() => {
                  setPickingCustomer(true);
                }}
              >
                Attach <Kbd>{keyFor('udhaar')}</Kbd>
              </Button>
            </div>
          ) : (
            // With nothing to bill the key settles instead (defect C5).
            <div
              className={`${cardClass} flex-row items-center gap-3 max-md:order-last max-md:px-4 max-md:py-3`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-control font-semibold">Settle udhaar</span>
                <span className="text-body-sm text-ink-2">
                  <span className="max-md:hidden">
                    With nothing on the bill, take a customer’s payment.
                  </span>
                  <span className="md:hidden">Take a customer’s payment.</span>
                </span>
              </div>
              <Button onClick={pressUdhaarKey}>
                Settle <Kbd>{keyFor('udhaar')}</Kbd>
              </Button>
            </div>
          )}

          {/* A counter cannot number a receipt until it has heard from the
              server once (Phase 9 §3), so until then Pay is disabled. Saying
              so is I5: a disabled button with no explanation is the kind of
              thing that gets a shop phoning the founder. The retry behind this
              is in `receipt-context.tsx`. */}
          {!receiptContext ? (
            <Banner tone="attention" role="status" className="md:col-span-2">
              Getting this counter ready…
            </Banner>
          ) : null}

          {expiredPack ? (
            <Banner
              tone="refused"
              role="status"
              aria-label="Expired pack"
              lead={`Scanned pack of ${expiredPack.name} expired ${formatExpiry(expiredPack.expiry)}.`}
              className="md:col-span-2"
            >
              Check before selling.
            </Banner>
          ) : null}

          {error ? (
            <Banner tone="refused" role="alert" className="md:col-span-2">
              {error}
            </Banner>
          ) : null}

          {lastSale ? (
            <div role="status" aria-label="Last sale" className="flex flex-col gap-3 md:col-span-2">
              <div className="bg-green-50 text-body-sm text-navy flex flex-col gap-1 rounded-card px-4 py-3">
                <p className="m-0 flex items-start gap-2">
                  <BannerMark tone="done" />
                  <span className="numeral">
                    <strong className="font-semibold text-green-700">
                      Saved — {lastSale.receiptNumber}
                    </strong>{' '}
                    · {formatPaisa(paisa(lastSale.totalPaisa), { withSymbol: true })}
                    {/* Where the money went, said where the operator looks: an
                      udhaar sale read exactly like a cash one. */}
                    {(lastSale.receipt.creditPaisa ?? 0) > 0 && lastSale.receipt.customerName ? (
                      <>
                        {' · '}
                        {(lastSale.receipt.cashPaisa ?? 0) > 0
                          ? `${formatPaisa(paisa(lastSale.receipt.cashPaisa ?? 0), { withSymbol: true })} cash · `
                          : ''}
                        {formatPaisa(paisa(lastSale.receipt.creditPaisa ?? 0), {
                          withSymbol: true,
                        })}{' '}
                        on {lastSale.receipt.customerName}&rsquo;s udhaar
                      </>
                    ) : (
                      ' cash'
                    )}
                  </span>
                </p>
                {/* The two questions that follow a completed sale — "can I see
                  it?" and "can I have a receipt?" — answered where they are
                  asked. Reprinting is from the same local receipt the commit
                  built, so it needs nothing from the network either. */}
                <p className="-ml-3 m-0 flex gap-2">
                  <Button
                    kind="quiet"
                    onClick={() => {
                      print(lastSale.receipt);
                    }}
                  >
                    Print receipt
                  </Button>
                  {/* The sale's own page, where it is reviewed (Day 9: a place
                    to do, a separate place to review). */}
                  <a
                    href={`/receipts/${encodeURIComponent(lastSale.receiptNumber)}`}
                    className={`${buttonClass('quiet')} underline underline-offset-2`}
                  >
                    View sale
                  </a>
                </p>
              </div>
              {/* D2 made visible at the moment it happens, not only in the day view. */}
              {lastSale.pendingUnits > 0 ? (
                <Banner tone="attention" role="note" lead="Sold more than the system had.">
                  It is on the owner’s exception list.
                </Banner>
              ) : null}
            </div>
          ) : null}

        </aside>
      </div>

      {/* Phone: Pay in a bar above the tabs, the bill's figures beside it. */}
      <div className="bg-surface shadow-bar flex shrink-0 flex-col gap-1 px-4 py-3 md:hidden">
        <p className="text-body-sm text-ink-2 m-0 flex justify-between">
          <span>{itemsSummary}</span>
          {discountOnItems > 0 ? (
            <b className="numeral text-navy font-medium">
              {formatPaisa(paisa(discountOnItems), { withSymbol: true })} off items
            </b>
          ) : null}
        </p>
        <Button
          kind="primary"
          block
          onClick={() => void executeSale(true)}
          disabled={payDisabled}
          className="h-[52px] text-[17px]"
        >
          {busy ? 'Saving…' : `Pay ${formatPaisa(totals.totalPaisa, { withSymbol: true })}`}
        </Button>
      </div>



      {pickingCustomer ? (
        <CustomerPicker
          title="Attach a customer"
          verb={{ button: 'Attach', says: 'attaches' }}
          onPick={(hit) => {
            setCustomer(hit);
            setPickingCustomer(false);
            if (payAfterPick.current) {
              payAfterPick.current = false;
              cashReceivedField.current?.focus();
              cashReceivedField.current?.select();
            } else {
              focusSearch();
            }
          }}
          onCancel={() => {
            payAfterPick.current = false;
            setPickingCustomer(false);
            focusSearch();
          }}
        />
      ) : null}

      {quickAdd ? (
        <QuickItemForm
          initialName={quickAdd.name}
          barcode={quickAdd.code ? barcodeToStore(quickAdd.code) : null}
          owner={quickAdd.owner}
          onSellOwner={
            quickAdd.owner?.hit
              ? () => {
                  const hit = quickAdd.owner?.hit;
                  if (hit) onSelect(hit, '');
                  quickAdd.settle(true);
                  setQuickAdd(null);
                  focusSearch();
                }
              : undefined
          }
          onCreate={(draft) => {
            void (async () => {
              try {
                await createQuickItem(draft);
                quickAdd.settle(true);
              } catch {
                setError('Could not add that item. Try again.');
                quickAdd.settle(false);
              }
              setQuickAdd(null);
              focusSearch();
            })();
          }}
          onCancel={() => {
            quickAdd.settle(false);
            setQuickAdd(null);
            focusSearch();
          }}
        />
      ) : null}

      {receipt ? <ReceiptView receipt={receipt} /> : null}
    </div>
  );
}
