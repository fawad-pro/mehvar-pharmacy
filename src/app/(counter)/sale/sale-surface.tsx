'use client';

/**
 * The Sale surface — Phase 10 §4, "the 80% surface".
 *
 *   "Search bar, full width, top. Cart, left ~62%. Right rail ~38%: totals
 *    stacked large-to-small, TOTAL in the display's biggest numerals (I6)."
 *
 * Day 4 adds the payment overlay (tendered/change, split cash-credit), the
 * udhaar attach (F8, defect C5), and the printed receipt (ADR-6). Focus
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
import { useRegisterF8Handler } from '@/client/keyboard/f8-context';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import type { SearchHit } from '@/client/search/catalog-index';
import { ProductSearch } from '@/components/product-search';
import { CustomerPicker } from '@/components/customer-picker';
import { ReceiptView } from '@/components/receipt-view';
import type { CustomerHit } from '@/app/(counter)/customers/actions';
import { miniStatement } from '@/domain/udhaar/settlement';
import {
  addToCart,
  cartTotals,
  isPriceOverridden,
  lineTotal,
  removeLine,
  updateLine,
  type CartLine,
} from '@/domain/sales/cart';
import { paisa, ZERO_PAISA } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity } from '@/lib/quantity';
import { uuidv7 } from '@/lib/uuid';

import { CartTable } from './cart-table';
import { PaymentOverlay, type PaymentSplit } from './payment-overlay';
import { commitCashSale } from './actions';

interface Committed {
  receiptNumber: string;
  totalPaisa: number;
  pendingByProduct: Record<string, number>;
}

export function SaleSurface() {
  const { index, refresh } = useCatalog();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Committed | null>(null);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [paying, setPaying] = useState(false);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const receiptContext = useReceiptContext();
  const { receipt, print } = usePrintReceipt();

  // Defect C5: F8 belongs to Sale only while the cart has something to bill.
  // An empty cart leaves F8 unregistered, so AppShell's Settle Udhaar fallback
  // runs instead.
  useRegisterF8Handler(
    lines.length > 0
      ? () => {
          setPickingCustomer(true);
        }
      : null,
  );

  const totals = useMemo(() => cartTotals(lines), [lines]);

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

  const commitWithSplit = useCallback(
    async (split: PaymentSplit) => {
      if (lines.length === 0 || busy || !receiptContext) {
        return;
      }
      setBusy(true);
      setError(null);

      const soldLines = lines;
      const soldTotals = totals;
      const soldCustomer = customer;

      // Two attempts: the second exists only for a receipt number that turned
      // out to be taken (two devices sharing a prefix, or a restored backup).
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const receiptNumber = receiptContext.nextReceiptNumber();
        const outcome = await commitCashSale({
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
          tenderedPaisa: split.tenderedPaisa,
          changePaisa: split.changePaisa,
          clientCommittedAt: new Date().toISOString(),
        });

        if (outcome.ok) {
          setLines([]);
          setCustomer(null);
          setPaying(false);
          setLastSale({
            receiptNumber: outcome.receiptNumber,
            totalPaisa: outcome.totalPaisa,
            pendingByProduct: outcome.pendingByProduct,
          });

          const pendingUnits = Object.values(outcome.pendingByProduct).reduce(
            (sum, qty) => sum + qty,
            0,
          );

          print({
            receiptNumber: outcome.receiptNumber,
            dateTime: new Date(),
            salesmanName: receiptContext.salesmanName,
            tenantHeaderLines: receiptContext.tenantHeaderLines,
            tenantFooterLine: receiptContext.tenantFooterLine,
            lines: soldLines.map((line) => ({
              name: line.name,
              quantityLabel: describeQuantity(line.qtyBase, line.baseUnitName, [
                ...line.packLevels,
              ]),
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
            ...(outcome.balanceBeforePaisa !== undefined
              ? { miniStatement: miniStatement(outcome.balanceBeforePaisa, split.creditPaisa) }
              : {}),
            ...(pendingUnits > 0
              ? { pendingNote: 'Sold more than the system had. It is on the owner’s exception list.' }
              : {}),
          });

          // Stock moved, so the index's advisory snapshot is stale.
          refresh();
          setBusy(false);
          focusSearch();
          return;
        }

        if (!outcome.retryWithNewReceipt) {
          setError(outcome.message);
          setBusy(false);
          return;
        }
        receiptContext.skipReceiptNumber(receiptNumber);
      }

      setError('Could not save the sale. Try again.');
      setBusy(false);
    },
    [lines, busy, receiptContext, totals, customer, refresh, focusSearch, print],
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
            <p className="text-ink/40 text-xs">F8 — attach a customer for udhaar</p>
          )}

          {error ? (
            <p className="text-red text-sm" role="alert">
              {error}
            </p>
          ) : null}

          {lastSale ? (
            <div className="border-line bg-green-100/50 rounded border p-3 text-sm" role="status">
              <p className="text-green-900 font-medium">Saved — {lastSale.receiptNumber}</p>
              <p className="numeral text-ink/70">
                {formatPaisa(paisa(lastSale.totalPaisa), { withSymbol: true })}
              </p>
              {/* D2 made visible at the moment it happens, not only in the day view. */}
              {Object.keys(lastSale.pendingByProduct).length > 0 ? (
                <p className="text-amber mt-1">
                  Sold more than the system had. It is on the owner’s exception list.
                </p>
              ) : null}
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

      {receipt ? <ReceiptView receipt={receipt} /> : null}
    </div>
  );
}
