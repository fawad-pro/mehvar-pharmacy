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

import { useCatalog } from '@/client/search/provider';
import { parseQuantityQuery } from '@/client/search/quantity-grammar';
import { lastSaleUnit, rememberSaleUnit } from '@/client/sale/last-unit';
import { useReceiptContext } from '@/client/receipt/receipt-context';
import { useRegisterUdhaarKeyHandler } from '@/client/keyboard/udhaar-key-context';
import { keyFor } from '@/client/keyboard/registry';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import type { ReceiptData } from '@/client/print/receipt';
import { CaptureBlockedError, useSync } from '@/client/sync/provider';
import { MatchTier, type SearchHit } from '@/client/search/catalog-index';
import { ProductSearch } from '@/components/product-search';
import { CustomerPicker } from '@/components/customer-picker';
import { QuickItemForm, type QuickItemDraft } from '@/components/quick-item-form';
import { ReceiptView } from '@/components/receipt-view';
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
import { formatPaisa } from '@/lib/money';
import { nominalPricePerBase } from '@/lib/quantity';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { CartTable } from './cart-table';
import { PaymentOverlay, type BillDiscount, type PaymentSplit } from './payment-overlay';

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
  const [paying, setPaying] = useState(false);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  /** The last scanned pack, when its own 2D code says it has expired. */
  const [expiredPack, setExpiredPack] = useState<{ name: string; expiry: string } | null>(null);
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
  const { receipt, print, clear: clearPrinted } = usePrintReceipt();
  const { capture } = useSync();

  // Defect C5: the udhaar key belongs to Sale only while the cart has
  // something to bill. An empty cart leaves it unregistered, so AppShell's
  // Settle Udhaar fallback runs instead.
  useRegisterUdhaarKeyHandler(
    lines.length > 0
      ? () => {
          setPickingCustomer(true);
        }
      : null,
  );

  // The cart's figures before payment: the subtotal is already net of every
  // line's own discount (`lineTotal` subtracts it). [PCN-014] A bill discount
  // is given on the payment screen, which owns it until the sale commits.
  const totals = useMemo(() => cartTotals(lines), [lines]);

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
    searchRef.current?.focus();
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
      setPaying(false);
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

  const openPayment = useCallback(() => {
    if (lines.length === 0 || busy || paying) {
      return;
    }
    setPaying(true);
  }, [lines, busy, paying]);

  // F12 opens the payment overlay from anywhere on the surface (Phase 10 §4).
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'F12') {
        event.preventDefault();
        openPayment();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [openPayment]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-line shrink-0 border-b p-3">
        <ProductSearch
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
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Cart — Phase 10 §4's ~62%. */}
        <div className="min-h-0 flex-[62] overflow-auto">
          <CartTable
            lines={lines}
            selectedLineId={selectedLineId}
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
            onPay={openPayment}
          />
        </div>

        {/* Right rail — Phase 10 §4's ~38%. */}
        <aside className="border-line flex flex-[38] flex-col gap-4 border-l p-4">
          <div>
            <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Total</p>
            {/* I6: the biggest numerals on the display. */}
            <p className="text-green-900 numeral text-total leading-none font-semibold">
              {formatPaisa(totals.totalPaisa)}
            </p>
            <p className="text-ink/50 mt-1 text-sm">
              {totals.lineCount} line{totals.lineCount === 1 ? '' : 's'} · {totals.itemCount} unit
              {totals.itemCount === 1 ? '' : 's'}
            </p>
          </div>

          {customer ? (
            <div className="border-line bg-green-100/50 flex items-center justify-between rounded border p-2 text-sm">
              <span>
                <span className="font-medium">{customer.name}</span>
                {customer.balancePaisa > 0 ? (
                  <span className="text-amber ml-2 numeral">
                    {formatPaisa(paisa(customer.balancePaisa))} owed
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => {
                  setCustomer(null);
                }}
                className="text-ink/50 text-xs"
              >
                remove
              </button>
            </div>
          ) : (
            <p className="text-ink/40 text-xs">{keyFor('udhaar')} — attach a customer for udhaar</p>
          )}

          {/* A counter cannot number a receipt until it has heard from the
              server once (Phase 9 §3), so until then Pay is disabled. Saying
              so is I5: a disabled button with no explanation is the kind of
              thing that gets a shop phoning the founder. The retry behind this
              is in `receipt-context.tsx`. */}
          {!receiptContext ? (
            <p className="text-amber text-xs" role="status">
              Getting this counter ready…
            </p>
          ) : null}

          {expiredPack ? (
            <p className="text-amber text-sm font-medium" role="status" aria-label="Expired pack">
              Scanned pack of {expiredPack.name} expired on{' '}
              {new Date(`${expiredPack.expiry}T00:00:00`).toLocaleDateString('en-PK', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}{' '}
              — check before selling.
            </p>
          ) : null}

          {error ? (
            <p className="text-red text-sm" role="alert">
              {error}
            </p>
          ) : null}

          {lastSale ? (
            <div
              className="border-line bg-green-100/50 rounded border p-3 text-sm"
              role="status"
              aria-label="Last sale"
            >
              <p className="text-green-900 font-medium">Saved — {lastSale.receiptNumber}</p>
              <p className="numeral text-ink/70">
                {formatPaisa(paisa(lastSale.totalPaisa), { withSymbol: true })}
              </p>
              {/* Where the money went, said where the operator looks: an
                  udhaar sale read exactly like a cash one. */}
              {(lastSale.receipt.creditPaisa ?? 0) > 0 && lastSale.receipt.customerName ? (
                <p className="numeral text-ink/70">
                  {(lastSale.receipt.cashPaisa ?? 0) > 0
                    ? `${formatPaisa(paisa(lastSale.receipt.cashPaisa ?? 0), { withSymbol: true })} cash · `
                    : ''}
                  {formatPaisa(paisa(lastSale.receipt.creditPaisa ?? 0), { withSymbol: true })} on{' '}
                  {lastSale.receipt.customerName}&rsquo;s udhaar
                </p>
              ) : null}
              {/* D2 made visible at the moment it happens, not only in the day view. */}
              {lastSale.pendingUnits > 0 ? (
                <p className="text-amber mt-1">
                  Sold more than the system had. It is on the owner’s exception list.
                </p>
              ) : null}
              {/* The two questions that follow a completed sale — "can I see
                  it?" and "can I have a receipt?" — answered where they are
                  asked. Reprinting is from the same local receipt the commit
                  built, so it needs nothing from the network either. */}
              <p className="mt-2 flex gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    print(lastSale.receipt);
                  }}
                  className="text-green-600 font-medium underline-offset-2 hover:underline"
                >
                  Print receipt
                </button>
                <a
                  href="/returns"
                  className="text-green-600 font-medium underline-offset-2 hover:underline"
                >
                  View sale
                </a>
              </p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={openPayment}
            disabled={lines.length === 0 || busy || !receiptContext}
            className="bg-green-600 text-paper min-h-touch mt-auto rounded text-lg font-medium disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Pay — F12'}
          </button>
        </aside>
      </div>

      {paying ? (
        <PaymentOverlay
          subtotalPaisa={totals.subtotalPaisa}
          grossPaisa={grossSubtotalPaisa(lines)}
          itemDiscountPaisa={totalLineDiscountPaisa(lines)}
          capPercent={receiptContext?.billDiscountCapPercent ?? DEFAULT_BILL_DISCOUNT_CAP_PERCENT}
          customerName={customer?.name ?? null}
          busy={busy}
          onCancel={() => {
            setPaying(false);
            focusSearch();
          }}
          onCommit={(split, bill) => {
            void commitWithSplit(split, bill);
          }}
        />
      ) : null}

      {pickingCustomer ? (
        <CustomerPicker
          title="Attach customer"
          onPick={(hit) => {
            setCustomer(hit);
            setPickingCustomer(false);
            focusSearch();
          }}
          onCancel={() => {
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
