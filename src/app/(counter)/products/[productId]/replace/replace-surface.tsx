'use client';

/**
 * [PCN-012] "Replace this product" — the new pack, then each batch counted in
 * it. Counts are pre-filled from the old count, unit for unit by name ("3 box"
 * stays 3 box of the new box), so the owner checks the shelf and corrects
 * what differs. Nothing moves until they confirm.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useCatalog } from '@/client/search/provider';
import { parsePackLevels } from '@/domain/catalog/product';
import { unitsFromEnteredPrices } from '@/domain/catalog/units';
import { parseRupeeInput } from '@/domain/sales/cart';
import { baseQty } from '@/lib/branded';
import {
  decomposeQuantity,
  describeQuantity,
  levelToBaseUnits,
  type PackLevel,
} from '@/lib/quantity';

import { replaceProductAction } from '../../actions';

interface Unit {
  name: string;
  factor: number;
}

export interface ReplaceProductView {
  id: string;
  name: string;
  baseUnitName: string;
  packLevels: PackLevel[];
  packLevelsText: string;
  unitPriceRupees: Record<string, string>;
  barcodes: { barcode: string; unitLevelName: string }[];
}

export interface ReplaceBatchView {
  batchId: string;
  batchNumber: string | null;
  expiryDate: string | null;
  qtyRemainingBase: number;
}

const WHOLE = /^\d+$/;
const fieldClass =
  'border-line focus:border-green-600 h-touch mt-1 w-full rounded border px-3 outline-none';

/** The old count in the new units: same-named units keep their count, the rest go loose. */
function prefill(
  product: ReplaceProductView,
  batch: ReplaceBatchView,
  structure: readonly Unit[],
): Record<string, string> {
  const counts: Record<string, number> = {};
  let loose = 0;
  for (const { level, count } of decomposeQuantity(
    baseQty(batch.qtyRemainingBase),
    product.baseUnitName,
    product.packLevels,
  )) {
    if (structure.some((unit) => unit.name === level.name)) {
      counts[level.name] = (counts[level.name] ?? 0) + count;
    } else {
      loose += count * level.factor;
    }
  }
  const base = structure[0]?.name;
  if (base !== undefined && loose > 0) counts[base] = (counts[base] ?? 0) + loose;
  return Object.fromEntries(structure.map((unit) => [unit.name, String(counts[unit.name] ?? 0)]));
}

export function ReplaceSurface({
  product,
  batches,
}: {
  product: ReplaceProductView;
  batches: ReplaceBatchView[];
}) {
  const router = useRouter();
  const { refresh: refreshCatalog } = useCatalog();
  const [name, setName] = useState(product.name);
  const [baseUnit, setBaseUnit] = useState(product.baseUnitName);
  const [packLevels, setPackLevels] = useState(product.packLevelsText);
  const [prices, setPrices] = useState<Record<string, string>>({ ...product.unitPriceRupees });
  // Only batches the owner has typed into; the rest show the pre-fill.
  const [typed, setTyped] = useState<Record<string, Record<string, string>>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const structure: Unit[] = [
    { name: baseUnit.trim(), factor: 1 },
    ...parsePackLevels(packLevels).filter(
      (level) => Number.isSafeInteger(level.factor) && level.factor > 1,
    ),
  ].filter((unit) => unit.name !== '');
  const largestFirst = [...structure].reverse();
  const typedPaisa = structure.map((unit) => parseRupeeInput(prices[unit.name] ?? ''));
  const suggested = unitsFromEnteredPrices(structure, typedPaisa) ?? [];

  const countsOf = (batch: ReplaceBatchView) =>
    typed[batch.batchId] ?? prefill(product, batch, structure);
  const totalOf = (batch: ReplaceBatchView): number | null => {
    const counts = countsOf(batch);
    let total = 0;
    for (const unit of structure) {
      const raw = (counts[unit.name] ?? '0').trim() || '0';
      if (!WHOLE.test(raw)) return null;
      total += levelToBaseUnits(Number(raw), unit);
    }
    return total;
  };

  const names = new Set(structure.map((unit) => unit.name));
  const unlinking = product.barcodes.filter((code) => !names.has(code.unitLevelName));

  async function confirm(): Promise<void> {
    if (busy) return;
    const totals = batches.map((batch) => ({ batch, total: totalOf(batch) }));
    if (totals.some(({ total }) => total === null || total <= 0)) {
      setError(
        'Count every batch in whole numbers, above zero. If a batch is gone, write it off on Adjust first.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await replaceProductAction(product.id, {
      name,
      baseUnitName: baseUnit,
      packLevels,
      unitPrices: structure.map((unit) => prices[unit.name] ?? ''),
      batches: totals.map(({ batch, total }) => ({
        batchId: batch.batchId,
        expectedRemainingBase: batch.qtyRemainingBase,
        newQtyBase: total ?? 0,
      })),
      note,
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    // The action's revalidation re-renders this route as "already replaced",
    // so the result is shown where the owner goes next: the new product.
    refreshCatalog();
    const unlinked = outcome.unlinkedBarcodes
      .map((code) => `${code.barcode}:${code.unitLevelName}`)
      .join(',');
    router.push(
      `/products/${outcome.newProductId}?replaced=${batches.length}${unlinked ? `&unlinked=${encodeURIComponent(unlinked)}` : ''}`,
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <legend className="text-ink/60 mb-2 text-xs tracking-[0.14em] uppercase">
          The right pack
        </legend>
        <label className="text-ink/70 text-xs">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="text-ink/70 text-xs">
          Base unit
          <input
            value={baseUnit}
            onChange={(event) => setBaseUnit(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="text-ink/70 text-xs">
          Pack levels
          <input
            value={packLevels}
            placeholder="strip:14, box:140"
            onChange={(event) => setPackLevels(event.target.value)}
            className={fieldClass}
          />
        </label>
        {structure.map((unit, index) => (
          <label key={unit.name} className="text-ink/70 text-xs">
            Price per {unit.name}
            <input
              inputMode="decimal"
              value={prices[unit.name] ?? ''}
              placeholder={
                typedPaisa[index] === null && suggested[index]
                  ? (suggested[index].pricePaisa / 100).toFixed(2)
                  : undefined
              }
              onChange={(event) =>
                setPrices((current) => ({ ...current, [unit.name]: event.target.value }))
              }
              className={`${fieldClass} numeral`}
            />
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink/60 mb-2 text-xs tracking-[0.14em] uppercase">
          Count each batch in the new pack
        </legend>
        {batches.length === 0 ? (
          <p className="text-ink/60 text-sm">No stock on hand — nothing to move.</p>
        ) : null}
        {batches.map((batch) => {
          const counts = countsOf(batch);
          const total = totalOf(batch);
          return (
            <div
              key={batch.batchId}
              role="group"
              aria-label={`Batch ${batch.batchNumber ?? ''} ${batch.expiryDate ? `expiring ${batch.expiryDate}` : ''}`.trim()}
              className="border-line flex flex-wrap items-end gap-3 rounded border p-3"
            >
              <div className="min-w-40 text-sm">
                <p className="font-medium">
                  {batch.batchNumber ? `Batch ${batch.batchNumber}` : 'Batch'}
                  {batch.expiryDate ? ` · exp ${batch.expiryDate}` : ''}
                </p>
                <p className="text-ink/60 text-xs">
                  Recorded:{' '}
                  {describeQuantity(
                    baseQty(batch.qtyRemainingBase),
                    product.baseUnitName,
                    product.packLevels,
                  )}
                </p>
              </div>
              {largestFirst.map((unit) => (
                <label key={unit.name} className="text-ink/70 w-20 text-xs">
                  {unit.name}
                  <input
                    inputMode="numeric"
                    value={counts[unit.name] ?? '0'}
                    onChange={(event) =>
                      setTyped((current) => ({
                        ...current,
                        [batch.batchId]: { ...counts, [unit.name]: event.target.value },
                      }))
                    }
                    className={`${fieldClass} numeral`}
                  />
                </label>
              ))}
              <p className="text-ink/60 ml-auto text-xs" aria-live="polite">
                {total === null ? 'Whole numbers only' : `= ${total} ${structure[0]?.name ?? ''}`}
              </p>
            </div>
          );
        })}
      </fieldset>

      {unlinking.length > 0 ? (
        <p className="text-amber text-sm">
          {unlinking.length === 1 ? 'One barcode is' : `${unlinking.length} barcodes are`} on a unit
          the new pack does not have ({unlinking.map((code) => code.unitLevelName).join(', ')}). It
          will be unlinked and listed, so you can link it again.
        </p>
      ) : null}

      <label className="text-ink/70 text-xs">
        Why
        <input
          value={note}
          placeholder="e.g. strips hold 14, not 10"
          onChange={(event) => setNote(event.target.value)}
          className={fieldClass}
        />
      </label>

      {error ? (
        <p className="text-red text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={busy}
          className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
        >
          {busy ? 'Replacing…' : 'Replace and move the stock'}
        </button>
      </div>
    </form>
  );
}
