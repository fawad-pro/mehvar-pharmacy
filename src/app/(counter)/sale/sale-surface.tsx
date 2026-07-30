'use client';

/**
 * The Sale surface as of Day 2 — search only.
 *
 * Phase 10 §4 divides this screen into three zones: the search bar across the
 * top, the cart on the left, the totals rail on the right. Day 2 delivers the
 * first, and Day 3 builds the other two on top of the selection this hands over.
 *
 * The "selected" panel below is scaffolding, not product surface: it exists so
 * the search is demonstrably wired end to end, and it is replaced wholesale by
 * the cart.
 */

import { useState } from 'react';

import type { SearchHit } from '@/client/search/catalog-index';
import { ProductSearch } from '@/components/product-search';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { unitLevels } from '@/lib/quantity';

export function SaleSurface() {
  const [selected, setSelected] = useState<SearchHit | null>(null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <ProductSearch onSelect={setSelected} />

      {selected ? (
        <section aria-label="Selected product" className="border-line bg-paper rounded border p-4">
          <p className="text-ink/40 text-xs tracking-[0.14em] uppercase">Selected</p>
          <h2 className="text-green-900 mt-1 text-xl font-semibold">
            {selected.product.name}
            {selected.product.strength ? (
              <span className="text-ink/60 font-normal"> {selected.product.strength}</span>
            ) : null}
          </h2>

          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Fact label="Price per {unit}" unit={selected.product.baseUnitName}>
              {formatPaisa(paisa(selected.product.pricePaisa), { withSymbol: true })}
            </Fact>
            <Fact label="Sold as">
              {unitLevels(selected.product.baseUnitName, [...selected.product.packLevels])
                .map((level) =>
                  level.factor === 1 ? level.name : `${level.name} (${level.factor})`,
                )
                .join(' · ')}
            </Fact>
            <Fact label="In stock">
              {selected.stockBase === null
                ? '—'
                : `${selected.stockBase} ${selected.product.baseUnitName}`}
            </Fact>
            <Fact label="Salt">{selected.product.formulaText ?? '—'}</Fact>
          </dl>

          <p className="text-ink/40 border-line mt-4 border-t pt-3 text-sm">
            The cart, quantity grammar and payment arrive in Session 3 (Day 3).
          </p>
        </section>
      ) : (
        // Phase 10 §8: an empty state teaches the key that fills it.
        <p className="text-ink/50 p-6 text-center text-sm">
          Type a few letters, or scan a pack. Try “panadol”, “pandol”, or a salt like “ibuprofen”.
        </p>
      )}
    </div>
  );
}

function Fact({
  label,
  unit,
  children,
}: {
  label: string;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-ink/50 text-xs">{unit ? label.replace('{unit}', unit) : label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
