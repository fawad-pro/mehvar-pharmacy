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
import { defaultUnitLevel, parseQuantityQuery } from '@/client/search/quantity-grammar';
import { MatchTier, type SearchHit } from '@/client/search/catalog-index';
import { looksLikeScannedCode } from '@/domain/catalog/barcode';
import { findUnit, unitsOf } from '@/domain/catalog/units';
import { formatPaisa } from '@/lib/money';
import { describeQuantity, unitLevels } from '@/lib/quantity';
import { baseQty, paisa } from '@/lib/branded';

const RESULT_LIMIT = 10;

/** What linking an unknown code produced — declared here, not imported from a server action file. */
export type LinkOutcome = { ok: true } | { ok: false; message: string };

type CodeOption = 'link' | 'add';

export function ProductSearch({
  onSelect,
  autoFocus = true,
  inputRef,
  onEnterCart,
  onQuickAdd,
  onLinkCode,
}: {
  /** Receives the chosen hit and the raw query, so quantity grammar survives. */
  onSelect: (hit: SearchHit, rawQuery: string) => void;
  autoFocus?: boolean;
  /** Lets the sale surface return focus here after a commit (Phase 7 rule 1). */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** ArrowUp on an empty query moves into the cart (Phase 10 §4). */
  onEnterCart?: () => void;
  /**
   * W6 — Enter on a search that found nothing opens the quick item. Resolves
   * true once the item actually landed in the cart, which is when the box
   * clears; a cancelled quick-add leaves the typing alone, because the operator
   * is most likely about to correct a spelling.
   */
  onQuickAdd?: (name: string) => Promise<boolean>;
  /**
   * Phase 10 §5 / Phase 6 §4 — links an unknown scanned code to a product, at
   * the unit the code is printed on. Absent where linking is not offered.
   */
  onLinkCode?: (code: string, productId: string, unitLevelName: string) => Promise<LinkOutcome>;
}) {
  const { index, status, productCount, refresh } = useCatalog();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // An unknown scanned code (Phase 10 §5's inline prompt). `codeChosen` says
  // the operator moved onto an option: the scanner's own Enter, which arrives
  // with the code, must not act on its behalf.
  const [codeChosen, setCodeChosen] = useState(false);
  const [linking, setLinking] = useState<{ code: string } | null>(null);
  const [linkTarget, setLinkTarget] = useState<SearchHit | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const ownRef = useRef<HTMLInputElement>(null);
  const field = inputRef ?? ownRef;

  // The catalog index lives in the counter layout and survives navigation, so
  // a barcode linked or a product edited on another screen was invisible here
  // until a full reload — a fresh code scanned as unknown and offered a quick
  // item. Arriving with an index already built (never on first load, which is
  // fetching one anyway) pulls the incremental changes since it was built.
  const hadIndexOnArrival = useRef(index !== null);
  useEffect(() => {
    if (hadIndexOnArrival.current) {
      refresh();
    }
    // Once per arrival: re-running when `refresh` changes identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // A scanned code that matched no barcode is an unknown CODE: whatever the
  // name search would make of a run of digits is noise, and offering to add the
  // code itself as a product is how junk products were made. While linking,
  // the box is a plain product search.
  const unknownCode =
    linking === null &&
    looksLikeScannedCode(parsed.query) &&
    !hits.some((hit) => hit.tier === MatchTier.Barcode);
  const visibleHits = unknownCode ? [] : hits;
  const codeOptions: CodeOption[] = unknownCode
    ? [...(onLinkCode ? (['link'] as const) : []), ...(onQuickAdd ? (['add'] as const) : [])]
    : [];

  function resetBox(): void {
    setQuery('');
    setActive(0);
    setCodeChosen(false);
    field.current?.focus();
  }

  function choose(hit: SearchHit | undefined): void {
    if (!hit) {
      return;
    }
    if (linking) {
      // The product the code belongs to; the unit comes next.
      setLinkTarget(hit);
      setLinkError(null);
      return;
    }
    onSelect(hit, query);
    resetBox();
  }

  function runCodeOption(option: CodeOption | undefined): void {
    if (option === 'link') {
      setLinking({ code: parsed.query });
      setLinkTarget(null);
      setLinkError(null);
      resetBox();
    } else if (option === 'add') {
      // Never the code as the name: the operator types what the product is.
      void quickAdd('');
    }
  }

  function cancelLinking(): void {
    setLinking(null);
    setLinkTarget(null);
    setLinkError(null);
    resetBox();
  }

  async function link(unitLevelName: string): Promise<void> {
    if (!linking || !linkTarget || !onLinkCode) {
      return;
    }
    const outcome = await onLinkCode(linking.code, linkTarget.product.id, unitLevelName).catch(
      (): LinkOutcome => ({
        ok: false,
        message: 'Needs internet — linking a code is saved on the server. Try again shortly.',
      }),
    );
    if (!outcome.ok) {
      setLinkError(outcome.message);
      return;
    }
    // The scan was a sale: the product lands at the unit the code is on.
    onSelect({ ...linkTarget, tier: MatchTier.Barcode, matchedOn: 'barcode', unitLevelName }, '');
    setLinking(null);
    setLinkTarget(null);
    setLinkError(null);
    resetBox();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape' && linking) {
      event.preventDefault();
      cancelLinking();
      return;
    }
    if (unknownCode && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      // The first press lands on the first option; later presses move.
      setActive((current) =>
        !codeChosen
          ? 0
          : event.key === 'ArrowDown'
            ? Math.min(current + 1, codeOptions.length - 1)
            : Math.max(current - 1, 0),
      );
      setCodeChosen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, visibleHits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      // At the top of the list — or with nothing typed — ArrowUp leaves search
      // and enters the cart, which is how a line gets edited without the mouse.
      if (active === 0 || visibleHits.length === 0) {
        onEnterCart?.();
        return;
      }
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (unknownCode) {
        // Only an option the operator moved onto. The Enter a scanner sends
        // with an unknown code does nothing but leave the prompt showing.
        if (codeChosen) {
          runCodeOption(codeOptions[active]);
        }
        return;
      }
      if (visibleHits.length === 0 && parsed.query !== '' && !linking) {
        // W6: "from an empty search result, one key". The key is Enter, because
        // it is the one the operator's finger is already on and because P2 says
        // a missing product is never a dead end.
        void quickAdd();
        return;
      }
      // A scanner types its digits and presses Enter. When exactly one result
      // came back it is unambiguous, so Enter takes it whatever the cursor says
      // — that is the "scan anywhere adds the item" behaviour of I1.
      choose(visibleHits[visibleHits.length === 1 ? 0 : active]);
    }
  }

  async function quickAdd(name: string = parsed.query): Promise<void> {
    if (!onQuickAdd || parsed.query === '') {
      return;
    }
    const added = await onQuickAdd(name);
    if (added) {
      // Same reset choosing a hit performs: the item is in the cart, so the box
      // is ready for the next one (Phase 7 rule 1).
      resetBox();
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
          setCodeChosen(false);
          setLinkTarget(null);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search or scan…"
        aria-autocomplete="list"
        aria-controls="product-search-results"
        aria-expanded={visibleHits.length > 0 || codeOptions.length > 0}
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

      {linking ? (
        <div className="border-green-600 bg-green-100/40 mt-2 rounded border px-3 py-2 text-sm">
          <p role="status">
            Linking code <span className="numeral font-medium">{linking.code}</span> — find the
            product it belongs to.{' '}
            <button type="button" onClick={cancelLinking} className="text-ink/60 underline">
              Cancel (Esc)
            </button>
          </p>
          {linkTarget ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-medium">{linkTarget.product.name}:</span>
              <span className="text-ink/70">which unit is this code printed on?</span>
              {/* Largest first: a code on a pack is far more often the box's. */}
              {unitLevels(linkTarget.product.baseUnitName, linkTarget.product.packLevels)
                .reverse()
                .map((level, position) => (
                  <button
                    key={level.name}
                    type="button"
                    autoFocus={position === 0}
                    onClick={() => {
                      void link(level.name);
                    }}
                    className="bg-green-600 text-paper min-h-touch rounded px-4 font-medium"
                  >
                    Link to {level.name}
                  </button>
                ))}
            </div>
          ) : null}
          {linkError ? (
            <p className="text-red mt-1" role="alert">
              {linkError}
            </p>
          ) : null}
        </div>
      ) : null}

      {parsed.query !== '' && unknownCode ? (
        <ul
          id="product-search-results"
          role="listbox"
          aria-label="Unknown code"
          className="border-line bg-paper absolute z-20 mt-1 max-h-[60vh] w-full overflow-auto rounded border shadow-lg"
        >
          <li className="px-3 py-2 text-sm">
            <span className="font-medium">This code is not linked to a product yet</span>
            <span className="text-ink/60 numeral block truncate text-xs">{parsed.query}</span>
          </li>
          {codeOptions.map((option, position) => (
            <li
              key={option}
              role="option"
              aria-selected={codeChosen && position === active}
              onClick={() => {
                runCodeOption(option);
              }}
              onMouseEnter={() => {
                setActive(position);
                setCodeChosen(true);
              }}
              className={`cursor-pointer px-3 py-2 ${codeChosen && position === active ? 'bg-green-100/60' : ''}`}
            >
              <span className="text-green-600 block font-medium">
                {option === 'link' ? 'Link it to a product' : 'Add a new product'}
              </span>
              <span className="text-ink/50 block text-xs">
                {option === 'link'
                  ? 'Find the product and choose the unit — the next scan adds it directly'
                  : 'Type its name and price — the code is not used as a name'}
              </span>
            </li>
          ))}
          {codeOptions.length === 0 ? (
            <li className="text-ink/60 px-3 py-2 text-xs">
              Link it from the product’s page on the Products screen.
            </li>
          ) : null}
        </ul>
      ) : parsed.query !== '' ? (
        <ul
          id="product-search-results"
          role="listbox"
          aria-label="Search results"
          className="border-line bg-paper absolute z-20 mt-1 max-h-[60vh] w-full overflow-auto rounded border shadow-lg"
        >
          {visibleHits.length === 0 && linking ? (
            // Linking attaches a code to a product that exists; offering to
            // invent one here would be the junk-product path again.
            <li className="text-ink/60 px-3 py-2 text-sm">
              No product matches — check the spelling, or press Esc to cancel linking.
            </li>
          ) : visibleHits.length === 0 ? (
            // P2: an empty result is never an error state — it is W6's trigger,
            // and the quick-add is the first-class result rather than a
            // consolation message under one.
            <li>
              <button
                type="button"
                onClick={() => {
                  onQuickAdd?.(parsed.query);
                }}
                className="hover:bg-green-100/50 flex w-full items-center gap-3 px-3 py-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-green-600 block truncate font-medium">
                    Add “{parsed.query}” and keep selling
                  </span>
                  <span className="text-ink/50 block truncate text-xs">
                    Name and price only — the owner completes it later
                  </span>
                </span>
                <kbd className="text-ink/40 shrink-0 text-xs">Enter</kbd>
              </button>
            </li>
          ) : (
            visibleHits.map((hit, position) => (
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

        <OnHand stockBase={hit.stockBase} product={product} />
        <StockBadge stockBase={hit.stockBase} product={product} />

        {/* Paisa crosses the wire as a plain number; it becomes branded again
            at this boundary rather than being cast (Phase 11 §2).
            [PCN-012] The price of the unit Enter will add — the scanned
            barcode's unit, or the counter's default — never a per-tablet
            figure for a product sold by the strip. */}
        <UnitPrice hit={hit} />
      </button>
    </li>
  );
}

function UnitPrice({ hit }: { hit: SearchHit }) {
  const { product } = hit;
  const units = unitsOf({
    baseUnitName: product.baseUnitName,
    packLevels: product.packLevels,
    pricePerBasePaisa: product.pricePaisa,
    units: product.units,
  });
  const unit =
    findUnit(
      units,
      hit.unitLevelName ?? defaultUnitLevel(product.baseUnitName, product.packLevels),
    ) ?? units[0];
  return (
    <span className="numeral w-28 shrink-0 text-right tabular-nums">
      {formatPaisa(paisa(unit?.pricePaisa ?? product.pricePaisa))}
      {unit && units.length > 1 ? (
        <span className="text-ink/50 text-xs"> / {unit.name}</span>
      ) : null}
    </span>
  );
}

/**
 * The compact "on hand" figure — every row, regardless of level.
 *
 * Distinct from `StockBadge` below, which is deliberately silent for a
 * comfortable stock level (I7 — colour only with meaning). This is plain
 * information, not a warning, so it says the same thing whether there are 3
 * units or 300; the colour semantics stay exactly `StockBadge`'s job.
 */
function OnHand({
  stockBase,
  product,
}: {
  stockBase: number | null;
  product: SearchHit['product'];
}) {
  if (stockBase === null) {
    return null;
  }

  return (
    <span className="text-ink/40 numeral shrink-0 text-xs">
      On hand: {describeQuantity(baseQty(stockBase), product.baseUnitName, [...product.packLevels])}
    </span>
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
