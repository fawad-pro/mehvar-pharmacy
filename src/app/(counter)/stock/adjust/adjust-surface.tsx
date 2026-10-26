'use client';

/**
 * Stock adjustment — W8, and W9's opening-stock flow.
 *
 *   "Path: adjustment → product → quantity ± → mandatory coded reason
 *    (+ optional note) → commit."
 *
 * The direction is chosen first, because it decides everything after it: stock
 * *leaving* must name the batch it leaves from (FEFO and expiry tracking would
 * otherwise be guessing), while stock *arriving* creates its own batch and has
 * no batch to name. That is `validateAdjustment`'s rule, shown as two different
 * forms rather than one form that rejects half of what it accepts.
 *
 * W9's opening stock is the same screen with "adding" pre-selected: "a guided
 * variant of W7 without a supplier invoice — walk the shelves, search/create
 * products, enter quantity + expiry + price". Building it as a mode rather than
 * a separate screen keeps one code path for the arithmetic that materializes a
 * batch, which is the part that must not diverge.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ProductSearch } from '@/components/product-search';
import { QuickItemForm, type QuickItemDraft } from '@/components/quick-item-form';
import type { SearchHit } from '@/client/search/catalog-index';
import { useCatalog } from '@/client/search/provider';
import { useSync } from '@/client/sync/provider';
import { paisaFromRupeeInput, parseRupeeInput } from '@/domain/sales/cart';
import { unitsOf, type ProductUnit } from '@/domain/catalog/units';
import {
  ADJUSTMENT_REASONS,
  REASON_LABELS,
  isNegativeOnly,
  type AdjustmentReason,
  type BatchOnHand,
} from '@/domain/inventory/adjustment';
import { baseQty, packFactor, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { costOfBaseUnits, levelToBaseUnits, scalePriceBetweenUnits } from '@/lib/quantity';
import { uuidv7 } from '@/lib/uuid';

import { adjustStockAction, batchesOnHandAction, lastPurchaseCostAction } from './actions';

type Direction = 'remove' | 'add';

interface Chosen {
  productId: string;
  productName: string;
  baseUnitName: string;
  pricePaisa: number;
  /** [PCN-012] Every unit, largest first: stock arriving is counted as the shelf holds it. */
  units: ProductUnit[];
}

/** [PCN-012] Units largest first — how a shelf is counted: boxes, then strips, then loose. */
function largestFirst(units: readonly ProductUnit[]): ProductUnit[] {
  return [...units].reverse();
}

export function AdjustSurface({ openingStock = false }: { openingStock?: boolean }) {
  const { refresh, addLocalProduct } = useCatalog();
  const { capture } = useSync();
  /** W6's mini-form, reused: the typed name plus the resolver search awaits. */
  const [quickAdd, setQuickAdd] = useState<{
    name: string;
    settle: (added: boolean) => void;
  } | null>(null);
  const [direction, setDirection] = useState<Direction>(openingStock ? 'add' : 'remove');
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [batches, setBatches] = useState<BatchOnHand[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  /** [PCN-012] Counts per unit when stock arrives, keyed by unit key. */
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<AdjustmentReason>(openingStock ? 'opening_stock' : 'damage');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  // Batches only matter when stock is leaving.
  useEffect(() => {
    if (!chosen || direction === 'add') {
      return;
    }
    let cancelled = false;
    void batchesOnHandAction(chosen.productId)
      .then((rows) => {
        if (!cancelled) {
          setBatches(rows);
          // FEFO-ordered, so the first is the one the operator most likely means.
          setBatchId(rows[0]?.batchId ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Needs internet — selling keeps working.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chosen, direction]);

  /**
   * A product chosen: counted in its own units, costed per its largest unit,
   * that cost pre-filled from the last purchase when there was one (PCN-012
   * decision 5) and its price from the product.
   */
  const choose = useCallback((product: Omit<Chosen, 'units'> & { units: ProductUnit[] }) => {
    const costUnit = product.units[0];
    setChosen(product);
    setPrice(((costUnit?.pricePaisa ?? product.pricePaisa) / 100).toFixed(2));
    setQty('');
    setCounts({});
    setCost('');
    setError(null);
    setDone(null);
    qtyRef.current?.focus();
    void lastPurchaseCostAction(product.productId)
      .then((last) => {
        if (!last || !costUnit) return;
        const from = last.unitKey
          ? product.units.find((unit) => unit.key === last.unitKey)
          : { factor: 1 };
        if (!from) return;
        const prefill = scalePriceBetweenUnits(
          paisa(last.costPaisa),
          packFactor(from.factor),
          packFactor(costUnit.factor),
        );
        // Only into an empty field: never over what the operator has typed.
        setCost((current) => (current === '' ? (prefill / 100).toFixed(2) : current));
      })
      .catch(() => {
        // Offline: the field stays empty and is asked for, as before.
      });
  }, []);

  const onSelect = useCallback(
    (hit: SearchHit) => {
      choose({
        productId: hit.product.id,
        productName: hit.product.name,
        baseUnitName: hit.product.baseUnitName,
        pricePaisa: hit.product.pricePaisa,
        units: largestFirst(
          unitsOf({
            baseUnitName: hit.product.baseUnitName,
            packLevels: hit.product.packLevels,
            pricePerBasePaisa: hit.product.pricePaisa,
            units: hit.product.units,
          }),
        ),
      });
    },
    [choose],
  );

  /**
   * Creating a product from here is what makes W9 usable at all.
   *
   * Opening stock is walked on the day the catalog is emptiest — "search/create
   * products" is W9's own wording — so a shelf item that is not yet known must
   * become known without leaving the screen. Same outbox path and same
   * completion queue as the counter's quick item (W6): named and priced now,
   * enriched later.
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

      await capture({
        kind: 'quick_item',
        payload: {
          id: product.id,
          name: product.name,
          pricePaisa: product.pricePaisa,
          baseUnitName: product.baseUnitName,
        },
      });

      addLocalProduct(product);

      choose({
        productId: product.id,
        productName: product.name,
        baseUnitName: product.baseUnitName,
        pricePaisa: product.pricePaisa,
        units: unitsOf({
          baseUnitName: product.baseUnitName,
          packLevels: [],
          pricePerBasePaisa: product.pricePaisa,
          units: null,
        }),
      });
    },
    [capture, addLocalProduct, choose],
  );

  // Derived, not synchronised. Which reasons are legal follows from the
  // direction, and the chosen reason is only honoured while it remains one of
  // them — so the form can never offer a combination `validateAdjustment`
  // would refuse, without an effect keeping two pieces of state in step.
  const availableReasons = ADJUSTMENT_REASONS.filter((candidate) =>
    direction === 'add' ? !isNegativeOnly(candidate) : candidate !== 'opening_stock',
  );
  const effectiveReason: AdjustmentReason = availableReasons.includes(reason)
    ? reason
    : (availableReasons[0] ?? 'count_correction');

  // Likewise: stock being added creates its own batch, so there is nothing to
  // pick from and a stale list from a previous product must not show.
  const visibleBatches = direction === 'add' ? [] : batches;

  // [PCN-012] Stock arriving, counted per unit: the base units it comes to,
  // and — costed per the largest unit — exactly what it cost, rounded once.
  const costUnit = chosen?.units[0];
  const countedBase = chosen
    ? chosen.units.reduce((sum, unit) => {
        const count = Number((counts[unit.key] ?? '').trim() || '0');
        return Number.isSafeInteger(count) && count >= 0
          ? sum + levelToBaseUnits(count, { name: unit.name, factor: unit.factor })
          : Number.NaN;
      }, 0)
    : 0;
  const costPerUnitPaisa = parseRupeeInput(cost);
  const costTotalPaisa =
    costUnit && costPerUnitPaisa !== null && Number.isSafeInteger(countedBase) && countedBase > 0
      ? costOfBaseUnits(costPerUnitPaisa, packFactor(costUnit.factor), baseQty(countedBase))
      : null;

  async function commit(): Promise<void> {
    if (!chosen || busy) {
      return;
    }
    const magnitude = direction === 'add' ? countedBase : Number(qty.trim());
    if (!Number.isSafeInteger(magnitude) || magnitude <= 0) {
      setError(
        direction === 'add'
          ? 'Enter how many are on the shelf, as whole numbers.'
          : 'Enter how many units.',
      );
      return;
    }
    // Decision 5: stock that appears must carry its cost, or every margin it
    // touches is computed against nothing. A free item is entered as 0.
    if (direction === 'add' && (costPerUnitPaisa === null || costTotalPaisa === null)) {
      setError(
        `Enter what this stock cost per ${costUnit?.name ?? 'unit'} — type 0 if it was free.`,
      );
      return;
    }

    setBusy(true);
    setError(null);

    const outcome = await adjustStockAction({
      adjustmentId: uuidv7(),
      productId: chosen.productId,
      qtyBaseDelta: direction === 'add' ? magnitude : -magnitude,
      reason: effectiveReason,
      batchId: direction === 'add' ? null : batchId,
      note: note.trim() === '' ? null : note.trim(),
      ...(direction === 'add' && costUnit && costTotalPaisa !== null
        ? {
            costTotalPaisa,
            // Nominal per base unit (rounded up); the batch's total is exact.
            unitCostPaisa: Math.ceil(costTotalPaisa / magnitude),
            pricePerBaseUnitPaisa: scalePriceBetweenUnits(
              paisaFromRupeeInput(price) || paisa(costUnit.pricePaisa),
              packFactor(costUnit.factor),
              packFactor(1),
            ),
            expiryDate: expiry.trim() === '' ? null : expiry.trim(),
            batchNumber: null,
          }
        : {}),
    }).catch(() => ({
      ok: false as const,
      message: 'Needs internet — selling keeps working.',
    }));

    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }

    setDone(
      outcome.resolvedPendingBase > 0
        ? `Saved. ${outcome.resolvedPendingBase} unit${outcome.resolvedPendingBase === 1 ? '' : 's'} already sold are now accounted for.`
        : 'Saved.',
    );
    setChosen(null);
    setQty('');
    setCounts({});
    setNote('');
    refresh();
    searchRef.current?.focus();
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-green-900 text-2xl font-semibold">
        {openingStock ? 'Opening stock' : 'Adjust stock'}
      </h1>

      {openingStock ? (
        <p className="text-ink/60 text-sm">
          Walk the shelves and enter what is there. Each entry becomes a batch with its own expiry
          and price.
        </p>
      ) : (
        <div className="flex gap-2" role="group" aria-label="Direction">
          {(['remove', 'add'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setDirection(option);
              }}
              aria-pressed={direction === option}
              className={[
                'min-h-touch rounded border px-4 text-sm',
                direction === option
                  ? 'border-green-600 bg-green-100 text-green-900 font-medium'
                  : 'border-line text-ink/60',
              ].join(' ')}
            >
              {option === 'remove' ? 'Remove stock' : 'Add stock'}
            </button>
          ))}
        </div>
      )}

      <ProductSearch
        onSelect={onSelect}
        inputRef={searchRef}
        // Only where stock is arriving: you cannot remove units of something
        // that has never existed, so offering to invent it there would be
        // offering a wrong answer.
        {...(direction === 'add'
          ? {
              onQuickAdd: (name: string) =>
                new Promise<boolean>((settle) => {
                  setQuickAdd({ name, settle });
                }),
            }
          : {})}
      />

      {chosen ? (
        <div
          className="border-line flex flex-col gap-3 rounded border p-3"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit();
            }
          }}
        >
          <p className="font-medium">{chosen.productName}</p>

          <div className="flex flex-wrap items-end gap-3">
            {direction === 'add' ? (
              // [PCN-012] Counted as the shelf holds it, largest first, in the
              // product's own words: "2 box, 3 strip, 4 tab".
              <fieldset className="flex flex-wrap items-end gap-2">
                <legend className="text-ink/60 mb-1 text-xs">
                  {openingStock ? 'On the shelf' : 'Units to add'}
                </legend>
                {chosen.units.map((unit, index) => (
                  <label key={unit.key} className="w-24">
                    <span className="text-ink/60 block text-xs capitalize">{unit.name}</span>
                    <input
                      ref={index === 0 ? qtyRef : undefined}
                      value={counts[unit.key] ?? ''}
                      inputMode="numeric"
                      placeholder="0"
                      onChange={(event) => {
                        const next = event.target.value;
                        setCounts((current) => ({ ...current, [unit.key]: next }));
                      }}
                      className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 text-lg outline-none"
                    />
                  </label>
                ))}
              </fieldset>
            ) : (
              <div className="w-32">
                <label className="text-ink/60 mb-1 block text-xs" htmlFor="adjust-qty">
                  Units to remove
                </label>
                <input
                  id="adjust-qty"
                  ref={qtyRef}
                  value={qty}
                  inputMode="numeric"
                  onChange={(event) => {
                    setQty(event.target.value);
                  }}
                  className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 text-lg outline-none"
                />
              </div>
            )}

            <div className="min-w-48 flex-1">
              <label className="text-ink/60 mb-1 block text-xs" htmlFor="adjust-reason">
                Reason
              </label>
              <select
                id="adjust-reason"
                value={effectiveReason}
                onChange={(event) => {
                  setReason(event.target.value as AdjustmentReason);
                }}
                className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
              >
                {availableReasons.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {REASON_LABELS[candidate]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {direction === 'remove' ? (
            <div>
              <label className="text-ink/60 mb-1 block text-xs" htmlFor="adjust-batch">
                From batch
              </label>
              {visibleBatches.length === 0 ? (
                <p className="text-amber text-sm">
                  Nothing on hand for this product — there is no batch to take from.
                </p>
              ) : (
                <select
                  id="adjust-batch"
                  value={batchId ?? ''}
                  onChange={(event) => {
                    setBatchId(event.target.value);
                  }}
                  className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
                >
                  {visibleBatches.map((batch) => (
                    <option key={batch.batchId} value={batch.batchId}>
                      {batch.batchNumber ?? 'no batch no.'} · expires {batch.expiryDate ?? '—'} ·{' '}
                      {batch.qtyRemainingBase} {chosen.baseUnitName} left
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-28">
                <label className="text-ink/60 mb-1 block text-xs" htmlFor="adjust-cost">
                  Cost per {costUnit?.name ?? 'unit'}
                </label>
                <input
                  id="adjust-cost"
                  value={cost}
                  inputMode="decimal"
                  onChange={(event) => {
                    setCost(event.target.value);
                  }}
                  className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
                />
              </div>
              <div className="w-28">
                <label className="text-ink/60 mb-1 block text-xs" htmlFor="adjust-price">
                  Sells for (per {costUnit?.name ?? 'unit'})
                </label>
                <input
                  id="adjust-price"
                  value={price}
                  inputMode="decimal"
                  onChange={(event) => {
                    setPrice(event.target.value);
                  }}
                  className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
                />
              </div>
              <div className="w-44">
                <label className="text-ink/60 mb-1 block text-xs" htmlFor="adjust-expiry">
                  Expiry
                </label>
                <input
                  id="adjust-expiry"
                  type="date"
                  value={expiry}
                  onChange={(event) => {
                    setExpiry(event.target.value);
                  }}
                  className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
                />
              </div>
              {/* What the count comes to, said before saving. */}
              {countedBase > 0 ? (
                <p className="text-ink/60 w-full text-sm" role="status">
                  {countedBase} {chosen.baseUnitName} in all
                  {costTotalPaisa !== null
                    ? ` · costs ${formatPaisa(paisa(costTotalPaisa), { withSymbol: true })}`
                    : ''}
                </p>
              ) : null}
            </div>
          )}

          <div>
            <label className="text-ink/60 mb-1 block text-xs" htmlFor="adjust-note">
              Note (optional)
            </label>
            <input
              id="adjust-note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
            />
          </div>

          {error ? (
            <p className="text-red text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between">
            <p className="text-ink/50 text-xs">
              {/* T1 — say plainly that this is visible, rather than blocking it. */}
              Recorded against your name and shown in the owner’s day view.
            </p>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={busy || (direction === 'remove' && visibleBatches.length === 0)}
              className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save — Enter'}
            </button>
          </div>
        </div>
      ) : null}

      {done ? (
        <p className="text-green-900 text-sm" role="status">
          {done}
        </p>
      ) : null}

      {chosen && direction === 'add' ? (
        <p className="text-ink/50 text-xs">
          {formatPaisa(paisa(chosen.pricePaisa))} is the catalog price — change “sells for” if this
          batch differs.
        </p>
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
              qtyRef.current?.focus();
            })();
          }}
          onCancel={() => {
            quickAdd.settle(false);
            setQuickAdd(null);
            searchRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
