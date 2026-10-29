'use client';

/**
 * Supplier type-ahead with inline create — W7.
 *
 * Same shape as the customer picker, and for the same reason: the distributor's
 * name is typed while their delivery man waits, so "not in the list" must be a
 * key away rather than a trip to a settings screen.
 *
 * Unlike the customer picker this one is online-only, because purchases are
 * (ADR-3). It says so rather than pretending.
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { createSupplierAction, searchSuppliersAction, type SupplierHit } from './actions';
import { OverlayBackdrop } from '@/components/overlay-backdrop';
import { Button, Kbd } from '@/components/ui/button';
import { dialogPanelClass } from '@/components/ui/dialog';
import { FieldLabel, inputClass } from '@/components/ui/field';
import { supplierPositionKind, supplierPositionPhrase } from '@/domain/suppliers/supplier-position';

/** How long typing must pause before suppliers are searched (as for customers). */
const SEARCH_PAUSE_MS = 200;

export function SupplierPicker({
  onPick,
  onCancel,
}: {
  onPick: (supplier: SupplierHit) => void;
  onCancel: () => void;
}) {
  const [term, setTerm] = useState('');
  /**
   * Results carry the term they answer, and Enter acts only on the answer for
   * what is typed now — the customer picker's rule. On a slow answer, an
   * earlier list put a delivery, and what it costs, on the wrong supplier, or
   * an empty one created a duplicate of a supplier who already exists.
   */
  const [answered, setAnswered] = useState<{ term: string | null; hits: SupplierHit[] }>({
    term: null,
    hits: [],
  });
  /** The term an Enter is waiting on, until its answer arrives. */
  const enterFor = useRef<string | null>(null);
  /** Shown while an Enter waits; the field holds still meanwhile. */
  const [finding, setFinding] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const asked = term.trim();
    // The customer picker's pause after the last key, for its reason; the
    // first list, for nothing typed, loads at once.
    const timer = window.setTimeout(
      () => {
        void searchSuppliersAction(term)
          .then((result) => {
            if (!cancelled) {
              setAnswered({ term: asked, hits: result });
              setActive(0);
              answerArrived(asked, result);
            }
          })
          .catch(() => {
            if (!cancelled) {
              setError('Needs internet — selling keeps working.');
              // No answer is coming: the field is the operator's again.
              enterFor.current = null;
              setFinding(null);
            }
          });
      },
      asked === '' ? 0 : SEARCH_PAUSE_MS,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  const hits = answered.term === term.trim() ? answered.hits : [];

  const answerArrived = useEffectEvent((answeredTerm: string, found: SupplierHit[]) => {
    if (enterFor.current !== answeredTerm) return;
    enterFor.current = null;
    setFinding(null);
    choose(found[0], answeredTerm);
  });

  /** Enter's meaning: the highlighted supplier, or a new one by this name. */
  function choose(hit: SupplierHit | undefined, name: string): void {
    if (hit) {
      onPick(hit);
    } else {
      void createInline(name);
    }
  }

  async function createInline(name: string = term.trim()): Promise<void> {
    if (name === '' || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createSupplierAction(name).catch(() => ({
      ok: false as const,
      message: 'Needs internet — selling keeps working.',
    }));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onPick(result.supplier);
  }

  const trimmedTerm = term.trim();
  /** With no supplier by that name, Enter adds one: the Add row is the one chosen. */
  const addChosen = trimmedTerm !== '' && answered.term === trimmedTerm && hits.length === 0;

  return (
    <OverlayBackdrop label="Supplier" onDismiss={onCancel}>
      <div className={dialogPanelClass}>
        <h2 className="text-heading m-0">Supplier</h2>

        <label className="flex flex-col gap-1.5">
          <FieldLabel>Name or phone</FieldLabel>
          <input
            ref={field}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onCancel();
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((current) => Math.min(current + 1, hits.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                if (finding !== null) return;
                if (answered.term !== trimmedTerm) {
                  // Not answered yet: act the moment it is, on that answer.
                  enterFor.current = trimmedTerm;
                  setFinding(trimmedTerm);
                  return;
                }
                choose(hits[active], trimmedTerm);
              }
            }}
            // The customer picker's rule: the invoice number typed next must
            // not become part of the supplier's name.
            readOnly={finding !== null}
            autoComplete="off"
            placeholder="Name or phone…"
            className={inputClass}
          />
        </label>

        {finding ? (
          <p className="text-body-sm text-ink-2 m-0" role="status">
            Finding &ldquo;{finding}&rdquo;…
          </p>
        ) : null}

        {hits.length > 0 || trimmedTerm !== '' ? (
          <ul
            className="bg-page m-0 flex max-h-60 list-none flex-col overflow-auto rounded-card p-0"
            role="listbox"
            aria-label="Suppliers"
          >
            {hits.map((hit, index) => (
              <li key={hit.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(hit);
                  }}
                  onMouseEnter={() => {
                    setActive(index);
                  }}
                  className={[
                    'border-line flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left',
                    index === 0 ? '' : 'border-t',
                    index === active ? 'bg-blue-50' : 'hover:bg-mist',
                  ].join(' ')}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-control truncate font-medium">{hit.name}</span>
                    {hit.phone ? (
                      <span className="text-label text-ink-2 numeral truncate font-normal">
                        {hit.phone}
                      </span>
                    ) : null}
                  </span>
                  {/* PCN-016: what is owed is seen before a delivery adds to it. */}
                  <SupplierPosition balancePaisa={hit.balancePaisa} className="text-body-sm" />
                </button>
              </li>
            ))}

            {trimmedTerm !== '' ? (
              // Not an option: a tap meant for a supplier must never land on
              // adding a second one by that name.
              <li>
                <button
                  type="button"
                  onClick={() => void createInline()}
                  disabled={busy}
                  className={[
                    'border-line flex min-h-touch w-full flex-col justify-center px-4 py-2 text-left disabled:opacity-40',
                    hits.length > 0 ? 'border-t' : '',
                    addChosen ? 'bg-blue-50' : 'hover:bg-mist',
                  ].join(' ')}
                >
                  <span className="text-control font-medium text-blue-600">
                    {busy ? 'Adding…' : `Add “${trimmedTerm}” as a new supplier`}
                  </span>
                  {addChosen && !busy ? (
                    <span className="text-label text-ink-2 font-normal">
                      No supplier by that name yet. Starts settled up.
                    </span>
                  ) : null}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        {error ? (
          <p className="text-body-sm text-red m-0 font-medium" role="alert">
            {error}
          </p>
        ) : null}

        <p className="text-body-sm text-ink-2 m-0 max-md:hidden">
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> choose · <Kbd>Enter</Kbd> {addChosen ? 'adds it' : 'picks it'},
          then the invoice number
        </p>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
          <Button kind="quiet" onClick={onCancel}>
            Cancel <Kbd>Esc</Kbd>
          </Button>
          <Button
            kind="primary"
            disabled={
              finding !== null ||
              busy ||
              answered.term !== trimmedTerm ||
              (hits.length === 0 && !addChosen)
            }
            onClick={() => {
              choose(hits[active], trimmedTerm);
            }}
          >
            {addChosen ? 'Add supplier' : 'Choose'} <Kbd>Enter</Kbd>
          </Button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}

/** A supplier balance in words and its colour: owing is attention, settled is done. */
export function SupplierPosition({
  balancePaisa,
  midSentence = false,
  className = '',
}: {
  balancePaisa: number;
  /** "… after this you owe Rs 500.00": the phrase starts lower case. */
  midSentence?: boolean;
  className?: string;
}) {
  const phrase = supplierPositionPhrase(balancePaisa);
  const kind = supplierPositionKind(balancePaisa);
  const tone =
    kind === 'you_owe' ? 'text-amber-text' : kind === 'settled' ? 'text-green-700' : 'text-navy';
  return (
    <span className={`numeral font-semibold whitespace-nowrap ${tone} ${className}`}>
      {midSentence ? phrase.charAt(0).toLowerCase() + phrase.slice(1) : phrase}
    </span>
  );
}
