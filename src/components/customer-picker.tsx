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
import { PositionInline } from '@/components/balance-figure';
import { Button, Kbd } from '@/components/ui/button';
import { dialogPanelClass } from '@/components/ui/dialog';
import { FieldLabel, inputClass } from '@/components/ui/field';

/** How long typing must pause before the customer book is searched. */
const SEARCH_PAUSE_MS = 200;

export function CustomerPicker({
  title = 'Customer',
  verb = { button: 'Choose', says: 'chooses' },
  onPick,
  onCancel,
}: {
  /** Distinguishes the attach-to-sale (W2) and settle (W3) contexts on screen. */
  title?: string;
  /** What Enter does with the customer: Attach / attaches from Sale. */
  verb?: { button: string; says: string };
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
  /** Shown while an Enter waits, so the wait is visible, not a dead key. */
  const [finding, setFinding] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { capture } = useSync();
  const field = useRef<HTMLInputElement>(null);
  /** A new customer's optional phone, behind "More details" (PCN-016). */
  const [addingPhone, setAddingPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const phoneField = useRef<HTMLInputElement>(null);

  // Focus from an effect, once the field has rendered (the keyboard walks).
  useEffect(() => {
    if (addingPhone) phoneField.current?.focus();
  }, [addingPhone]);

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
    setFinding(null);
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

    const validated = validateCustomerDraft({
      name,
      phone: addingPhone && phone.trim() !== '' ? phone.trim() : null,
    });
    if (!validated.ok) {
      setError(
        validated.rejections[0]?.reason === 'phone_invalid'
          ? 'That phone number has letters in it. Fix it or leave it empty.'
          : 'A name is needed.',
      );
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
      if (finding !== null) return;
      const trimmed = term.trim();
      if (trimmed === '') return;
      if (answered.term !== trimmed) {
        // Not answered yet: act the moment it is, on that answer.
        enterFor.current = trimmed;
        setFinding(trimmed);
        return;
      }
      choose(visibleHits[active], trimmed);
    }
  }

  const trimmedTerm = term.trim();
  /** With no one by that name, Enter adds them: the Add row is the one chosen. */
  const addChosen = trimmedTerm !== '' && answered.term === trimmedTerm && visibleHits.length === 0;

  return (
    <OverlayBackdrop label={title} onDismiss={onCancel}>
      <div className={dialogPanelClass}>
        <h2 className="text-heading m-0">{title}</h2>

        <label className="flex flex-col gap-1.5">
          <FieldLabel>Name or phone</FieldLabel>
          <input
            ref={field}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
            }}
            // Once Enter is given the question is settled: keys typed while it
            // is being answered (the cash, by a quick operator) must not turn
            // the name into another customer's. Esc still cancels.
            readOnly={finding !== null}
            onKeyDown={onKeyDown}
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

        {visibleHits.length > 0 || trimmedTerm !== '' ? (
          <ul
            className="bg-page m-0 flex max-h-60 list-none flex-col overflow-auto rounded-card p-0"
            role="listbox"
            aria-label="Customers"
          >
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
                    'border-line flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left',
                    index === 0 ? '' : 'border-t',
                    index === active ? 'bg-blue-50' : 'hover:bg-mist',
                  ].join(' ')}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-control truncate font-medium">{hit.name}</span>
                    {hit.phone ? (
                      <span className="text-label text-ink-2 numeral truncate text-left font-normal">
                        {hit.phone}
                      </span>
                    ) : null}
                  </span>
                  {/* T4 — the balance is shown before more credit gets extended,
                      as a position in words, never a signed number. */}
                  <PositionInline balancePaisa={hit.balancePaisa} className="text-body-sm" />
                </button>
              </li>
            ))}

            {trimmedTerm !== '' ? (
              // Not an option: the options are customers, and a tap meant for
              // a customer must never land on adding a second one by that name.
              <li>
                <button
                  type="button"
                  onClick={() => {
                    void createInline();
                  }}
                  disabled={busy}
                  className={[
                    'border-line flex min-h-touch w-full flex-col justify-center px-4 py-2 text-left disabled:opacity-40',
                    visibleHits.length > 0 ? 'border-t' : '',
                    addChosen ? 'bg-blue-50' : 'hover:bg-mist',
                  ].join(' ')}
                >
                  <span className="text-control font-medium text-blue-600">
                    {busy ? 'Adding…' : `Add “${trimmedTerm}” as a new customer`}
                  </span>
                  {addChosen && !busy ? (
                    <span className="text-label text-ink-2 font-normal">
                      Nobody by that name yet. Starts settled up.
                    </span>
                  ) : null}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        {/* PCN-016: an optional phone number for a new customer, out of the
            way of the fast path — Enter in the name still adds at once. */}
        {addChosen ? (
          addingPhone ? (
            <label className="flex flex-col gap-1.5">
              <FieldLabel>Phone</FieldLabel>
              <input
                ref={phoneField}
                value={phone}
                inputMode="tel"
                autoComplete="off"
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void createInline();
                  }
                  if (event.key === 'Escape') {
                    onCancel();
                  }
                }}
                className={`${inputClass} numeral`}
              />
            </label>
          ) : (
            <Button
              kind="quiet"
              aria-expanded={false}
              className="-ml-3 self-start"
              onClick={() => {
                setAddingPhone(true);
              }}
            >
              More details — phone number
            </Button>
          )
        ) : null}

        {error ? (
          <p className="text-body-sm text-red m-0 font-medium" role="alert">
            {error}
          </p>
        ) : null}

        <p className="text-body-sm text-ink-2 m-0 max-md:hidden">
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> choose · <Kbd>Enter</Kbd>{' '}
          {addChosen ? `adds and ${verb.says}` : verb.says}
        </p>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
          <Button kind="quiet" onClick={onCancel}>
            Cancel <Kbd>Esc</Kbd>
          </Button>
          <Button
            kind="primary"
            disabled={
              trimmedTerm === '' || finding !== null || busy || answered.term !== trimmedTerm
            }
            onClick={() => {
              if (addChosen) void createInline();
              else choose(visibleHits[active], trimmedTerm);
            }}
          >
            {addChosen ? `Add and ${verb.button.toLowerCase()}` : verb.button} <Kbd>Enter</Kbd>
          </Button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
