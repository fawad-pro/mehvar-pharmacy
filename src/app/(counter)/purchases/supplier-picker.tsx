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

  return (
    <OverlayBackdrop label="Supplier" onDismiss={onCancel}>
      <div className="bg-paper w-full max-w-sm rounded-lg p-5 shadow-xl">
        <h2 className="text-green-900 mb-4 text-lg font-semibold">Supplier</h2>

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
              const trimmed = term.trim();
              if (answered.term !== trimmed) {
                // Not answered yet: act the moment it is, on that answer.
                enterFor.current = trimmed;
                setFinding(trimmed);
                return;
              }
              choose(hits[active], trimmed);
            }
          }}
          // The customer picker's rule: the invoice number typed next must
          // not become part of the supplier's name.
          readOnly={finding !== null}
          autoComplete="off"
          placeholder="Name or phone…"
          className="border-line focus:border-green-600 h-touch w-full rounded border px-3 text-lg outline-none"
        />

        {finding ? (
          <p className="text-ink/60 mt-2 text-sm" role="status">
            Finding &ldquo;{finding}&rdquo;…
          </p>
        ) : null}

        <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-auto" role="listbox">
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
                  'flex min-h-touch w-full items-center justify-between rounded px-3 text-left',
                  index === active ? 'bg-green-100' : 'hover:bg-green-100/50',
                ].join(' ')}
              >
                <span className="font-medium">{hit.name}</span>
                {hit.phone ? <span className="text-ink/50 text-xs">{hit.phone}</span> : null}
              </button>
            </li>
          ))}

          {term.trim() !== '' ? (
            <li>
              <button
                type="button"
                onClick={() => void createInline()}
                disabled={busy}
                className="text-green-600 hover:bg-green-100/50 min-h-touch w-full rounded px-3 text-left font-medium disabled:opacity-40"
              >
                {busy ? 'Adding…' : `+ Add “${term.trim()}” as a new supplier`}
              </button>
            </li>
          ) : null}
        </ul>

        {error ? (
          <p className="text-red mt-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4">
          <button type="button" onClick={onCancel} className="text-ink/60 text-sm">
            Esc to cancel
          </button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
