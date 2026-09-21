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
import {
  defaultUnitLevel,
  parseQuantityQuery,
  resolveQuantity,
} from '@/client/search/quantity-grammar';
import { useReceiptContext } from '@/client/receipt/receipt-context';
import { useRegisterUdhaarKeyHandler } from '@/client/keyboard/udhaar-key-context';
import { keyFor } from '@/client/keyboard/registry';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import type { ReceiptData } from '@/client/print/receipt';
import { CaptureBlockedError, useSync } from '@/client/sync/provider';
import type { SearchHit } from '@/client/search/catalog-index';
import { ProductSearch } from '@/components/product-search';
import { CustomerPicker } from '@/components/customer-picker';
import { QuickItemForm, type QuickItemDraft } from '@/components/quick-item-form';
import { ReceiptView } from '@/components/receipt-view';
import type { CustomerHit } from '@/app/(counter)/customers/actions';
import { miniStatement } from '@/domain/udhaar/settlement';
// From the pure module, never from `commit-sale.ts`: that one reaches the
// database, and importing it here would pull `server-only` into the browser.
import { validateSaleCommand, type SaleRejection } from '@/domain/sales/sale-command';
import {
  addToCart,
  cartTotals,
  isPriceOverridden,
  lineTotal,
  parseDiscountInput,
  removeLine,
  updateLine,
  type CartLine,
} from '@/domain/sales/cart';
import { baseQty, paisa, ZERO_PAISA } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity } from '@/lib/quantity';
import { uuidv7 } from '@/lib/uuid';

import { CartTable } from './cart-table';
import { PaymentOverlay, type PaymentSplit } from './payment-overlay';

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
  /** Fixed PKR ("50") or a percentage ("10%") — one field, `parseDiscountInput`
   *  resolves it to the one underlying `invoiceDiscountPaisa` amount. */
  const [discountInput, setDiscountInput] = useState('');
  const [paying, setPaying] = useState(false);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  /** W6's pending mini-form: the typed name, plus the resolver the search awaits. */
  const [quickAdd, setQuickAdd] = useState<{
    name: string;
    settle: (added: boolean) => void;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const receiptContext = useReceiptContext();
  const { receipt, print } = usePrintReceipt();
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

  // The subtotal is independent of any invoice discount (`cartTotals` sums line
  // totals before applying one), so it is safe to compute once and use it both
  // to resolve a "10%" entry and to build the final, discount-aware totals.
  const subtotalPaisa = useMemo(() => cartTotals(lines).subtotalPaisa, [lines]);
  const discountPaisa = useMemo(
    () => parseDiscountInput(discountInput, subtotalPaisa),
    [discountInput, subtotalPaisa],
  );
  const totals = useMemo(
    () => cartTotals(lines, discountPaisa),
    [lines, discountPaisa],
  );

  const stockByProduct = useMemo(() => {
    const stock: Record<string, number | null> = {};
    for (const line of lines) {
      stock[line.productId] = index?.stockOf(line.productId) ?? null;
    }
    return stock;
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
  const onSelect = useCallback((hit: SearchHit, rawQuery: string) => {
    const { count } = parseQuantityQuery(rawQuery);
    const level =
      hit.unitLevelName ?? defaultUnitLevel(hit.product.baseUnitName, hit.product.packLevels);
    const qtyBase = resolveQuantity(count, level, hit.product.baseUnitName, hit.product.packLevels);

    setLines((current) =>
      addToCart(current, {
        lineId: uuidv7(),
        productId: hit.product.id,
        name: hit.product.name,
        baseUnitName: hit.product.baseUnitName,
        packLevels: hit.product.packLevels,
        qtyBase,
        enteredUnitLevel: level,
        unitPricePaisa: paisa(hit.product.pricePaisa),
        catalogPricePaisa: paisa(hit.product.pricePaisa),
        lineDiscountPaisa: ZERO_PAISA,
      }),
    );
    setLastSale(null);
    setError(null);
  }, []);

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
    async (split: PaymentSplit) => {
      if (lines.length === 0 || busy || !receiptContext) {
        return;
      }

      const soldLines = lines;
      const soldTotals = totals;
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
          unitPricePaisa: line.unitPricePaisa,
          lineDiscountPaisa: line.lineDiscountPaisa,
          priceOverridden: isPriceOverridden(line),
        })),
        invoiceDiscountPaisa: soldTotals.invoiceDiscountPaisa,
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
          quantityLabel: describeQuantity(line.qtyBase, line.baseUnitName, [...line.packLevels]),
          amountPaisa: lineTotal(line),
        })),
        subtotalPaisa: soldTotals.subtotalPaisa,
        discountPaisa: soldTotals.invoiceDiscountPaisa,
        totalPaisa: soldTotals.totalPaisa,
        cashPaisa: split.cashPaisa,
        tenderedPaisa: split.tenderedPaisa,
        changePaisa: split.changePaisa,
        creditPaisa: split.creditPaisa,
        ...(soldCustomer ? { customerName: soldCustomer.name } : {}),
        ...(split.creditPaisa > 0 && soldCustomer
          ? { miniStatement: miniStatement(soldCustomer.balancePaisa, split.creditPaisa) }
          : {}),
        ...(pendingUnits > 0
          ? { pendingNote: 'Sold more than the system had. It is on the owner’s exception list.' }
          : {}),
      };

      setLines([]);
      setCustomer(null);
      setDiscountInput('');
      setPaying(false);
      setLastSale({
        receiptNumber,
        totalPaisa: soldTotals.totalPaisa,
        pendingUnits,
        receipt: receiptData,
      });

      // The sale is already committed and the receipt already built; whether
      // paper comes out is a shop's preference, not a step in the workflow.
      // A shop that prints on request rather than by default still has the
      // receipt one key away, from local state, exactly as before.
      if (receiptContext.autoPrintReceipt) {
        print(receiptData);
      }

      // Stock moved, so the index's advisory snapshot is stale. Harmless to ask
      // for while offline: the refresh fails and the cached catalog stands.
      refresh();
      setBusy(false);
      focusSearch();
    },
    [lines, busy, receiptContext, totals, customer, index, capture, refresh, focusSearch, print],
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

      addLocalProduct(product);

      setLines((current) =>
        addToCart(current, {
          lineId: uuidv7(),
          productId: product.id,
          name: product.name,
          baseUnitName: product.baseUnitName,
          packLevels: [],
          qtyBase: baseQty(1),
          enteredUnitLevel: product.baseUnitName,
          unitPricePaisa: paisa(product.pricePaisa),
          catalogPricePaisa: paisa(product.pricePaisa),
          lineDiscountPaisa: ZERO_PAISA,
        }),
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
          onQuickAdd={(name) =>
            new Promise<boolean>((settle) => {
              setQuickAdd({ name, settle });
            })
          }
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Cart — Phase 10 §4's ~62%. */}
        <div className="min-h-0 flex-[62] overflow-auto">
          <CartTable
            lines={lines}
            selectedLineId={selectedLineId}
            stockByProduct={stockByProduct}
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
            {/* Phase 10 §4: "TOTAL, then discount, then item count." Shown only
                once a discount actually applies — furniture that is always
                there stops being read. */}
            {totals.invoiceDiscountPaisa > 0 ? (
              <p className="text-amber numeral mt-1 text-sm">
                Discount −{formatPaisa(paisa(totals.invoiceDiscountPaisa))}
              </p>
            ) : null}
            <p className="text-ink/50 mt-1 text-sm">
              {totals.lineCount} line{totals.lineCount === 1 ? '' : 's'} · {totals.itemCount} unit
              {totals.itemCount === 1 ? '' : 's'}
            </p>
            <label className="mt-2 block text-xs">
              <span className="text-ink/60">Discount</span>
              <input
                type="text"
                inputMode="decimal"
                value={discountInput}
                onChange={(event) => {
                  setDiscountInput(event.target.value);
                }}
                placeholder="e.g. 50 or 10%"
                autoComplete="off"
                className="border-line focus:border-green-600 h-touch numeral mt-1 w-full rounded border px-3 text-sm outline-none"
              />
            </label>
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
            <p className="text-ink/40 text-xs">
              {keyFor('udhaar')} — attach a customer for udhaar
            </p>
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
          totalPaisa={totals.totalPaisa}
          customerName={customer?.name ?? null}
          busy={busy}
          onCancel={() => {
            setPaying(false);
            focusSearch();
          }}
          onCommit={(split) => {
            void commitWithSplit(split);
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
