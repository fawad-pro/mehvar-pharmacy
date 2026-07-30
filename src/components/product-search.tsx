'use client';

/**
 * The search bar and its results — Phase 10 §5.
 *
 *   "Results begin rendering from the first keystroke; matching is local, so
 *    latency is imperceptible. Arrow keys navigate, Enter adds, typing continues
 *    to refine. No mouse required ever; mouse works anyway."
 *
 * Focus lives here (Phase 7 rule 1: "search is the home position; every workflow
 * begins and ends with focus there"), so the input reclaims focus on mount and
 * after every selection.
 *
 * The cart is Day 3. This component's job is to produce a chosen product and
 * hand it to `onSelect`; what happens next is the sale screen's business.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useCatalog } from '@/client/search/provider';
import { parseQuantityQuery } from '@/client/search/quantity-grammar';
import { MatchTier, type SearchHit } from '@/client/search/catalog-index';
import { formatPaisa } from '@/lib/money';
import { describeQuantity } from '@/lib/quantity';
import { baseQty, paisa } from '@/lib/branded';

const RESULT_LIMIT = 10;

export function ProductSearch({
  onSelect,
  autoFocus = true,
  inputRef,
  onEnterCart,
}: {
  /** Receives the chosen hit and the raw query, so quantity grammar survives. */
  onSelect: (hit: SearchHit, rawQuery: string) => void;
  autoFocus?: boolean;
  /** Lets the sale surface return focus here after a commit (Phase 7 rule 1). */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** ArrowUp on an empty query moves into the cart (Phase 10 §4). */
  onEnterCart?: () => void;
}) {
  const { index, status, productCount } = useCatalog();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ownRef = useRef<HTMLInputElement>(null);
  const field = inputRef ?? ownRef;

  useEffect(() => {
    if (autoFocus) {
      field.current?.focus();
    }
    // `field` is a stable ref object; re-running on it would refocus on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  // Recomputed per keystroke, which is affordable precisely because the index
  // bounds the work (see catalog-index.ts). No debounce: a debounce would add
  // latency to hide cost that is not there.
  // Searched on the text with any quantity prefix removed, so "3*pana" finds
  // Panadol rather than nothing (Phase 10 §4).
  const parsed = useMemo(() => parseQuantityQuery(query), [query]);
  const hits = useMemo<SearchHit[]>(
    () => (index && parsed.query !== '' ? index.search(parsed.query, RESULT_LIMIT) : []),
    [index, parsed.query],
  );

  function choose(hit: SearchHit | undefined): void {
    if (!hit) {
      return;
    }
    onSelect(hit, query);
    setQuery('');
    setActive(0);
    field.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      // At the top of the list — or with nothing typed — ArrowUp leaves search
      // and enters the cart, which is how a line gets edited without the mouse.
      if (active === 0 || hits.length === 0) {
        onEnterCart?.();
        return;
      }
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // A scanner types its digits and presses Enter. When exactly one result
      // came back it is unambiguous, so Enter takes it whatever the cursor says
      // — that is the "scan anywhere adds the item" behaviour of I1.
      choose(hits[hits.length === 1 ? 0 : active]);
    }
  }

  return (
    <div className="relative">
      <label className="sr-only" htmlFor="product-search">
        Search products
      </label>
      <input
        id="product-search"
        ref={field}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          // The highlight returns to the top result as the query narrows.
          // Done here rather than in an effect: it is a consequence of the
          // edit, not a synchronisation with anything outside React.
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search or scan…"
        aria-autocomplete="list"
        aria-controls="product-search-results"
        aria-expanded={hits.length > 0}
        role="combobox"
        className="border-line focus:border-green-600 h-touch w-full rounded border px-3 text-lg outline-none"
      />

      {parsed.hasExplicitCount ? (
        <p className="text-green-600 mt-1 text-xs">
          Quantity {parsed.count} — searching “{parsed.query}”
        </p>
      ) : null}

      <p className="text-ink/40 mt-1 text-xs">
        {status === 'loading'
          ? 'Loading catalog…'
          : status === 'unavailable'
            ? 'Catalog not loaded — check the connection.'
            : status === 'stale'
              ? `${productCount} products (offline copy)`
              : `${productCount} products`}
      </p>

      {parsed.query !== '' ? (
        <ul
          id="product-search-results"
          role="listbox"
          aria-label="Search results"
          className="border-line bg-paper absolute z-20 mt-1 max-h-[60vh] w-full overflow-auto rounded border shadow-lg"
        >
          {hits.length === 0 ? (
            // P2: an empty result is never an error state. Day 3 puts the
            // quick-add row here as the first-class result (W6).
            <li className="text-ink/60 p-3 text-sm">
              Nothing found. Check the spelling, or scan the pack.
            </li>
          ) : (
            hits.map((hit, position) => (
              <ResultRow
                key={hit.product.id}
                hit={hit}
                active={position === active}
                onPick={() => {
                  choose(hit);
                }}
                onHover={() => {
                  setActive(position);
                }}
              />
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Phase 10 §5's result row: "name + strength (primary), form + manufacturer
 * (secondary), price (right-aligned, tabular), stock badge (green/amber/zero-red
 * only when meaningful — semantic color rule)".
 */
function ResultRow({
  hit,
  active,
  onPick,
  onHover,
}: {
  hit: SearchHit;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const { product } = hit;
  const secondary = [product.form, product.manufacturer].filter(Boolean).join(' · ');

  return (
    <li role="option" aria-selected={active}>
      <button
        type="button"
        onClick={onPick}
        onMouseEnter={onHover}
        tabIndex={-1}
        className={[
          'flex w-full items-center gap-3 px-3 py-2 text-left',
          active ? 'bg-green-100' : '',
        ].join(' ')}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-medium">{product.name}</span>
            {product.strength ? <span className="text-ink/70"> {product.strength}</span> : null}
          </span>
          <span className="text-ink/50 block truncate text-xs">
            {secondary}
            {/* Phase 10 §5: a salt match is "labelled as such — substitution
                support". The salesman must know why an unasked-for brand is on
                screen. */}
            {hit.matchedOn === 'formula' ? (
              <span className="text-green-600"> · same salt</span>
            ) : null}
            {hit.matchedOn === 'barcode' ? (
              <span className="text-green-600"> · scanned</span>
            ) : null}
            {hit.tier === MatchTier.Fuzzy ? (
              <span className="text-ink/40"> · close match</span>
            ) : null}
          </span>
        </span>

        <StockBadge stockBase={hit.stockBase} product={product} />

        {/* Paisa crosses the wire as a plain number; it becomes branded again
            at this boundary rather than being cast (Phase 11 §2). */}
        <span className="numeral w-20 shrink-0 tabular-nums">
          {formatPaisa(paisa(product.pricePaisa))}
        </span>
      </button>
    </li>
  );
}

/**
 * I7 — semantic colour only with meaning. Amber is caution, red is zero. A
 * comfortable stock level says nothing at all, because a badge on every row is
 * noise and stops meaning anything.
 */
function StockBadge({
  stockBase,
  product,
}: {
  stockBase: number | null;
  product: SearchHit['product'];
}) {
  if (stockBase === null) {
    return null;
  }

  if (stockBase <= 0) {
    // D2: a zero-stock line still sells. The badge is exposure, not a block.
    return <span className="text-red shrink-0 text-xs font-medium">none</span>;
  }

  const natural = describeQuantity(baseQty(stockBase), product.baseUnitName, [
    ...product.packLevels,
  ]);
  const low = stockBase <= (product.packLevels[0]?.factor ?? 1);

  return low ? <span className="text-amber shrink-0 text-xs">{natural}</span> : null;
}
