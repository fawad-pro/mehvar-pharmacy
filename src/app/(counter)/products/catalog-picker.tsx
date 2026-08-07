'use client';

/**
 * "Which medicine are you adding?" — the first question, not the ninth field.
 *
 * WHAT WAS WRONG
 *
 * Adding Panadol meant typing nine fields: name, strength, form, manufacturer,
 * salt, base unit, pack levels, price, MRP. Mehvar already knew eight of them —
 * the bundled catalogue ships with hand-checked pack structures and reference
 * MRPs for exactly these medicines — and had no way to say so. Nothing in the
 * product read `global_products` at all, so the catalogue was a table nobody
 * could reach: built, correct, and by the only definition that counts, not
 * built.
 *
 * WHAT REPLACES IT
 *
 * Type two letters, pick the medicine, enter your price. Everything a pack can
 * know is filled in; the one field it cannot know — what this shop charges — is
 * the one left to type, because that is the only field that is genuinely the
 * pharmacy's (Phase 6 §2, T3).
 *
 * THE PART THAT PREVENTS DUPLICATES
 *
 * A shop searching for "panadol" usually already stocks Panadol. Offering to
 * create it again is precisely the duplicate the identity model exists to
 * prevent, so an already-stocked medicine is shown as a link to the product
 * they have, not as something to add. That check matches on identity rather
 * than on the catalogue link, so a product typed by hand months ago is still
 * recognised.
 *
 * Nothing here is mandatory. "Enter it myself" is always present and always
 * one key away: a shop stocks soap and baby food and a local syrup nobody has
 * catalogued, and a picker that made those feel like the awkward path would be
 * wrong about what a Pakistani pharmacy sells (P2).
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { formatForm } from '@/domain/catalog/form';
import { formatStrength, parseStrength } from '@/domain/catalog/strength';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

import { searchCatalogAction } from './actions';

interface Suggestion {
  globalProductId: string;
  name: string;
  manufacturer: string | null;
  formulaText: string | null;
  form: string | null;
  strength: string | null;
  packLevels: readonly { name: string; factor: number }[];
  referenceMrpPaisa: number | null;
  quality: 'verified' | 'reference';
  alreadyStockedId: string | null;
}

export interface PickedMedicine {
  globalProductId: string;
  name: string;
  manufacturer: string;
  form: string;
  strength: string;
  formulaText: string;
  baseUnitName: string;
  packLevels: string;
  mrpRupees: string;
}

/**
 * Strength shown as the pack writes it, with the canonical reading beside it
 * only when they differ.
 *
 * Two entries reading "0.5g" and "500mg" are the same medicine, and an operator
 * scanning a list should not have to do that conversion in their head — but
 * replacing the label with the canonical form would hide what is printed on the
 * box, which is the authority (D4).
 */
function strengthLabel(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = parseStrength(raw);
  if (!parsed) return raw;
  const canonical = formatStrength(parsed);
  return canonical === raw.trim() ? raw.trim() : `${raw.trim()} (${canonical})`;
}

export function CatalogPicker({
  onPick,
  onSkip,
}: {
  onPick: (medicine: PickedMedicine) => void;
  onSkip: () => void;
}) {
  const [term, setTerm] = useState('');
  /*
   * Results carry the term they answer.
   *
   * That makes "are we still searching?" a derived fact rather than a second
   * piece of state to keep in step — and a stale response arriving late can
   * simply be recognised as stale instead of overwriting a newer one.
   */
  const [answered, setAnswered] = useState<{
    term: string;
    rows: Suggestion[];
    catalogLoaded: boolean;
  }>({ term: '', rows: [], catalogLoaded: true });
  const [highlighted, setHighlighted] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  const trimmed = term.trim();

  useEffect(() => {
    if (trimmed.length < 2) return;

    // Debounced: this is a server query, unlike the counter's own search, and a
    // keystroke-per-request would make it feel slower than typing.
    const timer = window.setTimeout(() => {
      void searchCatalogAction(trimmed).then((result) => {
        setAnswered({
          term: trimmed,
          rows: [...result.matches],
          catalogLoaded: result.catalogLoaded,
        });
        setHighlighted(0);
      });
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  // Only trust results that answer what is currently typed.
  const results = answered.term === trimmed ? answered.rows : [];
  const searching = trimmed.length >= 2 && answered.term !== trimmed;
  /** The catalogue is not there at all — a setup problem, not a search problem. */
  const catalogueMissing = answered.term === trimmed && !answered.catalogLoaded;
  const addable = results.filter((row) => row.alreadyStockedId === null);

  function choose(row: Suggestion): void {
    if (row.alreadyStockedId) return;
    onPick({
      globalProductId: row.globalProductId,
      name: row.name,
      manufacturer: row.manufacturer ?? '',
      form: row.form ?? '',
      strength: row.strength ?? '',
      formulaText: row.formulaText ?? '',
      // The base unit is the smallest level the pack knows about.
      baseUnitName: row.packLevels[0]?.name ?? '',
      packLevels: row.packLevels
        .slice(1)
        .map((level) => `${level.name}:${level.factor}`)
        .join(', '),
      mrpRupees:
        row.referenceMrpPaisa === null ? '' : (row.referenceMrpPaisa / 100).toFixed(2),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor="catalog-search" className="text-ink block text-sm font-medium">
          Which medicine?
        </label>
        <p className="text-ink/60 mt-0.5 text-sm leading-snug">
          Search Mehvar&rsquo;s catalogue by brand, salt or company — the pack size and MRP come
          with it.
        </p>
        <input
          id="catalog-search"
          ref={field}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlighted((current) => Math.min(current + 1, addable.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlighted((current) => Math.max(current - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const row = addable[highlighted];
              if (row) choose(row);
            }
          }}
          placeholder="Panadol, paracetamol, GSK…"
          autoComplete="off"
          className="border-line focus:border-green-600 h-touch mt-1.5 w-full rounded border px-3 outline-none"
        />
      </div>

      {/* An empty catalogue and an unmatched search look identical to an
          operator and are completely different problems. Saying "nothing
          matches" when the catalogue was never loaded sends someone to try
          another spelling forever. */}
      {catalogueMissing ? (
        <div className="border-amber/50 bg-amber/5 rounded border p-3 text-sm" role="status">
          <p className="text-amber font-medium">Mehvar&rsquo;s medicine catalogue is not loaded.</p>
          <p className="text-ink/70 mt-1">
            No search will find anything until it is. Run{' '}
            <code className="numeral">npm run catalog:seed</code> (or{' '}
            <code className="numeral">npm run db:setup</code>, which includes it). You can still
            enter products yourself below.
          </p>
        </div>
      ) : null}

      {!catalogueMissing && trimmed.length >= 2 && !searching && results.length === 0 ? (
        <p className="text-ink/60 text-sm">
          Nothing in the catalogue matches &ldquo;{trimmed}&rdquo;. That is normal for local
          products and general goods — enter it yourself below.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="border-line divide-line divide-y rounded border">
          {results.map((row) => {
            const detail = [
              strengthLabel(row.strength),
              formatForm(row.form),
              row.manufacturer,
            ]
              .filter(Boolean)
              .join(' · ');

            if (row.alreadyStockedId) {
              return (
                <li key={row.globalProductId} className="bg-green-100/30 px-3 py-2 text-sm">
                  <span className="text-ink/70 font-medium">{row.name}</span>
                  <span className="text-ink/50"> {detail}</span>
                  {/* Not offered as something to add. Adding it again is the
                      duplicate this whole subsystem exists to prevent, so the
                      row leads to the product they already have. */}
                  <Link
                    href={`/products/${row.alreadyStockedId}`}
                    className="text-green-700 ml-2 underline"
                  >
                    already stocked — open it
                  </Link>
                </li>
              );
            }

            const position = addable.indexOf(row);
            return (
              <li key={row.globalProductId}>
                <button
                  type="button"
                  onClick={() => {
                    choose(row);
                  }}
                  className={`min-h-touch flex w-full flex-wrap items-baseline gap-x-2 px-3 py-2 text-left text-sm ${
                    position === highlighted ? 'bg-green-100' : 'hover:bg-green-100/50'
                  }`}
                >
                  <span className="text-green-900 font-medium">{row.name}</span>
                  <span className="text-ink/60">{detail}</span>
                  {row.formulaText ? (
                    <span className="text-ink/50 text-xs">{row.formulaText}</span>
                  ) : null}
                  <span className="text-ink/50 ml-auto text-xs">
                    {row.packLevels.length > 1
                      ? row.packLevels
                          .slice(1)
                          .map((level) => `1 ${level.name} = ${level.factor} ${row.packLevels[0]?.name ?? ''}`)
                          .join(', ')
                      : null}
                    {row.referenceMrpPaisa !== null ? (
                      <span className="ml-2">
                        MRP {formatPaisa(paisa(row.referenceMrpPaisa))}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={onSkip}
        className="text-ink/60 self-start text-sm underline"
      >
        Not in the list — enter it myself
      </button>
    </div>
  );
}
