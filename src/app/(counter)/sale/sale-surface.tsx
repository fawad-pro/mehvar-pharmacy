'use client';

/**
 * The Sale surface — Phase 10 §4, "the 80% surface".
 *
 *   "Search bar, full width, top. Cart, left ~62%. Right rail ~38%: totals
 *    stacked large-to-small, TOTAL in the display's biggest numerals (I6)."
 *
 * Day 3 delivers the cart and a cash commit. The payment overlay with tendered
 * amount and change, the udhaar path, and the printed receipt are Day 4; Enter
 * here commits the exact amount, which is what W1's "amount tendered (defaults
 * to exact)" resolves to when nobody types a different figure.
 *
 * Focus discipline is the thing to preserve when this file grows: focus lives in
 * search (Phase 7 rule 1), returns there after every commit, and every cart edit
 * is reachable without the mouse.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCatalog } from '@/client/search/provider';
import {
  defaultUnitLevel,
  parseQuantityQuery,
  resolveQuantity,
} from '@/client/search/quantity-grammar';
import {
  nextReceiptNumber,
  seedReceiptCounter,
  skipReceiptNumber,
} from '@/client/print/receipt-number';
import type { SearchHit } from '@/client/search/catalog-index';
import { ProductSearch } from '@/components/product-search';
import {
  addToCart,
  cartTotals,
  isPriceOverridden,
  removeLine,
  splitPayment,
  updateLine,
  type CartLine,
} from '@/domain/sales/cart';
import { paisa, ZERO_PAISA } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';

import { CartTable } from './cart-table';
import { commitCashSale, receiptCounterHint } from './actions';

interface Committed {
  receiptNumber: string;
  totalPaisa: number;
  pendingByProduct: Record<string, number>;
}

export function SaleSurface({ tenantId }: { tenantId: string }) {
  const { index, refresh } = useCatalog();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Committed | null>(null);
  const [devicePrefix, setDevicePrefix] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Seeded once: a re-imaged machine must not restart its receipt sequence at 1
  // and collide with everything it has already printed (Phase 9 §3).
  useEffect(() => {
    void receiptCounterHint().then((hint) => {
      if (hint) {
        seedReceiptCounter(tenantId, hint.prefix, hint.highest);
        setDevicePrefix(hint.prefix);
      }
    });
  }, [tenantId]);

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

  const commit = useCallback(async () => {
    if (lines.length === 0 || busy || !devicePrefix) {
      return;
    }
    setBusy(true);
    setError(null);

    const split = splitPayment(totals.totalPaisa, totals.totalPaisa);

    // Two attempts: the second exists only for a receipt number that turned out
    // to be taken (two devices sharing a prefix, or a restored backup).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const receiptNumber = nextReceiptNumber(tenantId, devicePrefix);
      const outcome = await commitCashSale({
        saleId: uuidv7(),
        receiptNumber,
        lines: lines.map((line) => ({
          lineId: line.lineId,
          productId: line.productId,
          qtyBase: line.qtyBase,
          enteredUnitLevel: line.enteredUnitLevel,
          unitPricePaisa: line.unitPricePaisa,
          lineDiscountPaisa: line.lineDiscountPaisa,
          priceOverridden: isPriceOverridden(line),
        })),
        invoiceDiscountPaisa: totals.invoiceDiscountPaisa,
        cashPaisa: split.cashPaisa,
        changePaisa: split.changePaisa,
        clientCommittedAt: new Date().toISOString(),
      });

      if (outcome.ok) {
        setLines([]);
        setLastSale({
          receiptNumber: outcome.receiptNumber,
          totalPaisa: outcome.totalPaisa,
          pendingByProduct: outcome.pendingByProduct,
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
      skipReceiptNumber(tenantId, devicePrefix, receiptNumber);
    }

    setError('Could not save the sale. Try again.');
    setBusy(false);
  }, [lines, busy, devicePrefix, tenantId, totals, refresh, focusSearch]);

  // F12 pays, per Phase 10 §4's payment overlay trigger. The overlay itself is
  // Day 4; today the key commits the exact amount.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'F12') {
        event.preventDefault();
        void commit();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [commit]);

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
            onClick={() => {
              void commit();
            }}
            disabled={lines.length === 0 || busy || !devicePrefix}
            className="bg-green-600 text-paper min-h-touch mt-auto rounded text-lg font-medium disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Cash — F12'}
          </button>
          <p className="text-ink/40 text-center text-xs">
            Payment overlay, change and udhaar arrive in Session 4.
          </p>
        </aside>
      </div>
    </div>
  );
}
