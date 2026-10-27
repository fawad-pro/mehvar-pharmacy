'use client';

/**
 * The customer picker — W2's "seconds" requirement.
 *
 *   "New-customer-inline is mandatory: udhaar is extended mid-rush, not
 *    pre-registered." And T4: a balance is shown before more credit is
 *    extended, not after.
 *
 * One component serves both places a customer needs picking: attaching one to
 * a sale (the udhaar key with items in the cart, W2) and finding one to
 * settle (the udhaar key on an empty cart, W3). Type-ahead first; a name that
 * matches nothing offers "Add <name>" as the natural next step rather than a
 * separate form.
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { searchCustomersAction, type CustomerHit } from '@/app/(counter)/customers/actions';
import { CaptureBlockedError, useSync } from '@/client/sync/provider';
import { validateCustomerDraft } from '@/domain/udhaar/customer';
import { uuidv7 } from '@/lib/uuid';
import { OverlayBackdrop } from '@/components/overlay-backdrop';
import { BalanceInline } from '@/components/balance-figure';

/** How long typing must pause before the customer book is searched. */
const SEARCH_PAUSE_MS = 200;

export function CustomerPicker({
  title = 'Customer',
  onPick,
  onCancel,
}: {
  /** Distinguishes the attach-to-sale (W2) and settle (W3) contexts on screen. */
  title?: string;
  onPick: (customer: CustomerHit) => void;
  onCancel: () => void;
}) {
  const [term, setTerm] = useState('');
  /**
   * Results carry the term they answer. Enter acts on the answer for what is
   * typed NOW: acting on an earlier one made the same keys pick Rashid Sahib
   * on a fast connection and create a second "Rashid" on a slow one, putting
   * the udhaar on a customer who did not exist.
   */
  const [answered, setAnswered] = useState<{ term: string; hits: CustomerHit[] }>({
    term: '',
    hits: [],
  });
  /** The term an Enter is waiting on, until its answer arrives. */
  const enterFor = useRef<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { capture } = useSync();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === '') {
      return;
    }
    let cancelled = false;
    // A pause after the last key, as the catalogue picker has: Next sends
    // server actions one at a time, so a search per keystroke on a slow
    // connection queued every letter of a name ahead of the answer Enter
    // waits for.
    const timer = window.setTimeout(() => {
      searchCustomersAction(trimmed).then(
        (result) => {
          if (cancelled) return;
          setAnswered({ term: trimmed, hits: result });
          setActive(0);
          answerArrived(trimmed, result);
        },
        () => {
          // Offline (ADR-3): the customer book lives on the server, so lookup is
          // one of the things that stops working. What remains is the thing that
          // matters mid-rush — the inline create below is still right there, so
          // W2 continues rather than dead-ending (P2). No answer is an empty one.
          if (cancelled) return;
          setAnswered({ term: trimmed, hits: [] });
          answerArrived(trimmed, []);
        },
      );
    }, SEARCH_PAUSE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  const answerArrived = useEffectEvent((answeredTerm: string, found: CustomerHit[]) => {
    if (enterFor.current !== answeredTerm) return;
    enterFor.current = null;
    choose(found[0], answeredTerm);
  });

  // A stale list from a previous term never renders.
  const visibleHits = answered.term === term.trim() && term.trim() !== '' ? answered.hits : [];

  /** Enter's meaning: the highlighted customer, or a new one by this name. */
  function choose(hit: CustomerHit | undefined, name: string): void {
    if (hit) {
      onPick(hit);
    } else {
      void createInline(name);
    }
  }

  /**
   * W2's inline create — "udhaar is extended mid-rush, not pre-registered".
   *
   * Captured through the outbox rather than committed directly, because a new
   * customer during a disruption is part of W2 and ADR-3 makes W2 work through
   * one. The counter mints the id, so the sale queued a moment later can
   * reference this customer before either has reached the server; FIFO delivery
   * is what guarantees the customer lands first.
   */
  async function createInline(name: string = term.trim()): Promise<void> {
    if (name === '' || busy) {
      return;
    }

    const validated = validateCustomerDraft({ name, phone: null });
    if (!validated.ok) {
      setError('A name is needed.');
      return;
    }

    setBusy(true);
    setError(null);

    const id = uuidv7();
    try {
      await capture({
        kind: 'customer',
        payload: { id, name: validated.value.name, phone: validated.value.phone },
      });
    } catch (error) {
      // A restricted installation (PCN-006) may not add a new customer. Other
      // throws mean the machine could not persist it.
      setError(
        error instanceof CaptureBlockedError
          ? error.message
          : 'This machine could not save the customer. Try again.',
      );
      setBusy(false);
      return;
    }

    setBusy(false);
    onPick({ id, name: validated.value.name, phone: validated.value.phone, balancePaisa: 0 });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      onCancel();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, visibleHits.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const trimmed = term.trim();
      if (trimmed === '') return;
      if (answered.term !== trimmed) {
        // Not answered yet: act the moment it is, on that answer.
        enterFor.current = trimmed;
        return;
      }
      choose(visibleHits[active], trimmed);
    }
  }

  return (
    <OverlayBackdrop label={title} onDismiss={onCancel}>
      <div className="bg-paper w-full max-w-sm rounded-lg p-5 shadow-xl">
        <h2 className="text-green-900 mb-4 text-lg font-semibold">{title}</h2>

        <input
          ref={field}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          placeholder="Name or phone…"
          className="border-line focus:border-green-600 h-touch w-full rounded border px-3 text-lg outline-none"
        />

        <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-auto" role="listbox">
          {visibleHits.map((hit, index) => (
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
                <span>
                  <span className="font-medium">{hit.name}</span>
                  {hit.phone ? <span className="text-ink/50 ml-2 text-xs">{hit.phone}</span> : null}
                </span>
                {/* T4 — the balance is shown before more credit gets extended. */}
                {/* Position, never a signed number: an advance reads "advance". */}
                <span className="text-sm">
                  <BalanceInline balancePaisa={hit.balancePaisa} />
                </span>
              </button>
            </li>
          ))}

          {term.trim() !== '' ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  void createInline();
                }}
                disabled={busy}
                className="text-green-600 hover:bg-green-100/50 min-h-touch w-full rounded px-3 text-left font-medium disabled:opacity-40"
              >
                {busy ? 'Adding…' : `+ Add “${term.trim()}” as a new customer`}
              </button>
            </li>
          ) : null}
        </ul>

        {error ? (
          <p className="text-red mt-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={onCancel} className="text-ink/60 text-sm">
            Esc to cancel
          </button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
