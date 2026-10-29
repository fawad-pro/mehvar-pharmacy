'use client';

/**
 * The payment overlay — Phase 10 §4.
 *
 *   "F12/Space opens the payment overlay: amount tendered (defaults to exact),
 *    change rendered enormous. A customer attached splits cash/credit; nothing
 *    attached means the whole shortfall has nowhere to go, so it is refused
 *    the same way the domain refuses it (`credit_without_customer`) rather
 *    than silently discounting the sale."
 *
 * Enter commits, Esc returns to the cart — no other path out.
 *
 * [PCN-014, PCN-015] The bill discount is a field on this screen, always in
 * view, taking what a line discount takes: what comes off, "80" or "10%". It
 * applies as it is typed — the largest figure becomes what to collect — so
 * there is no step between what the screen says and what Commit charges. `%`
 * from Cash tendered goes to it. The fast path is untouched: F12, Enter still
 * sells at the full amount. When all discounts together pass the shop's
 * limit, the owner's PIN is asked for beneath it and Commit waits for it; the
 * screen then says who approved.
 */

import { useEffect, useRef, useState } from 'react';

import { PIN_LENGTH } from '@/auth/pin-policy';
import {
  billDiscountFromInput,
  billDiscountNeedsApproval,
  paisaFromRupeeInput,
  splitPayment,
} from '@/domain/sales/cart';
import { keyFor } from '@/client/keyboard/registry';
import { OverlayBackdrop } from '@/components/overlay-backdrop';
import { positionPhrase } from '@/components/balance-figure';
import { Button, Kbd } from '@/components/ui/button';
import { dialogPanelClass } from '@/components/ui/dialog';
import { FieldLabel, inputClass } from '@/components/ui/field';
import { needsClickToCommit } from '@/client/scan/amount-guard';
import { formatPaisa, subtractPaisa } from '@/lib/money';
import { ZERO_PAISA, type Paisa } from '@/lib/branded';

import { approveBillDiscountAction } from './actions';

export interface PaymentSplit {
  cashPaisa: Paisa;
  creditPaisa: Paisa;
  changePaisa: Paisa;
  tenderedPaisa: Paisa;
}

/** [PCN-014] The bill discount the sale is committed with, and who approved it. */
export interface BillDiscount {
  discountPaisa: Paisa;
  approvedBy: { id: string; name: string } | null;
}

/** The owner's PIN, while it is typed and checked. */
interface PinEntry {
  pin: string;
  message: string | null;
  busy: boolean;
}

export function PaymentOverlay({
  subtotalPaisa,
  grossPaisa,
  itemDiscountPaisa,
  capPercent,
  customerName,
  customerBalancePaisa = null,
  busy,
  onCancel,
  onCommit,
}: {
  /** The bill after item discounts — what a bill discount comes off. */
  subtotalPaisa: Paisa;
  /** The bill before any discount — what the limit is a share of. */
  grossPaisa: Paisa;
  itemDiscountPaisa: Paisa;
  capPercent: number;
  customerName: string | null;
  /** What the attached customer owes before this sale, to say what they will owe after it. */
  customerBalancePaisa?: number | null;
  busy: boolean;
  onCancel: () => void;
  onCommit: (split: PaymentSplit, bill: BillDiscount) => void;
}) {
  const [discountInput, setDiscountInput] = useState('');
  /** Who approved which discount. Only good for that exact amount. */
  const [approval, setApproval] = useState<{
    discountPaisa: Paisa;
    by: { id: string; name: string };
  } | null>(null);
  const [pinEntry, setPinEntry] = useState<PinEntry>({ pin: '', message: null, busy: false });
  const [tenderedInput, setTenderedInput] = useState('');
  /** Until the cashier types a tendered amount, it follows the amount to collect. */
  const [tenderedTyped, setTenderedTyped] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const discountField = useRef<HTMLInputElement>(null);
  const pinField = useRef<HTMLInputElement>(null);
  /** Why Enter did not commit: an amount too large to be cash (see amount-guard). */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const parsed = billDiscountFromInput(subtotalPaisa, discountInput);
  const discountPaisa = parsed.ok ? parsed.discountPaisa : ZERO_PAISA;
  const needsOwner = billDiscountNeedsApproval({
    grossPaisa,
    itemDiscountPaisa,
    billDiscountPaisa: discountPaisa,
    capPercent,
  });
  const approvedBy =
    approval !== null && approval.discountPaisa === discountPaisa ? approval.by : null;
  const waitingForOwner = needsOwner && approvedBy === null;
  const totalPaisa = subtractPaisa(subtotalPaisa, discountPaisa);
  const tenderedText = tenderedTyped ? tenderedInput : (totalPaisa / 100).toFixed(2);
  const tenderedPaisa = paisaFromRupeeInput(tenderedText);
  const split = splitPayment(totalPaisa, tenderedPaisa);
  const short = split.creditPaisa > 0;
  const canCommit = parsed.ok && !waitingForOwner && (!short || customerName !== null);

  function commit(): void {
    if (!parsed.ok) {
      discountField.current?.focus();
      return;
    }
    if (waitingForOwner) {
      pinField.current?.focus();
      return;
    }
    if (!canCommit || busy) {
      return;
    }
    onCommit({ ...split, tenderedPaisa }, { discountPaisa, approvedBy });
  }

  function focusTendered(): void {
    field.current?.focus();
    field.current?.select();
  }

  /** Back to no discount, as Esc in the PIN promises. */
  function clearDiscount(): void {
    setDiscountInput('');
    setPinEntry({ pin: '', message: null, busy: false });
    focusTendered();
  }

  async function submitPin(): Promise<void> {
    if (pinEntry.pin.length !== PIN_LENGTH || pinEntry.busy) return;
    const asked = discountPaisa;
    setPinEntry({ ...pinEntry, busy: true, message: null });
    const answer = await approveBillDiscountAction(pinEntry.pin).catch(() => null);
    if (answer === null) {
      setPinEntry({
        pin: '',
        busy: false,
        message:
          'The owner’s PIN needs a connection to the shop’s computer. Sell at the full amount, or within the limit.',
      });
      return;
    }
    if (!answer.ok) {
      setPinEntry({ pin: '', busy: false, message: answer.message });
      return;
    }
    setApproval({ discountPaisa: asked, by: { id: answer.ownerId, name: answer.ownerName } });
    setPinEntry({ pin: '', message: null, busy: false });
    focusTendered();
  }

  const discounted = discountPaisa > 0;

  return (
    // No onDismiss: Esc, deliberately pressed, is the only way out of this one.
    <OverlayBackdrop label="Payment">
      <div className={dialogPanelClass}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-heading m-0">Payment</h2>
          {customerName ? (
            <span className="text-body-sm text-ink-2 truncate">Billing to {customerName}</span>
          ) : null}
        </div>

        {/* The one figure to take, always the largest: "Collect" once a bill
            discount is given, so nobody reads the old bill as the price. */}
        <div className="flex flex-col gap-1">
          <span className="text-label text-ink-2">{discounted ? 'Collect' : 'Amount due'}</span>
          <p
            className="text-navy numeral text-total m-0 text-right font-semibold tracking-tight whitespace-nowrap"
            aria-label={discounted ? 'Collect' : 'Amount due'}
          >
            {formatPaisa(totalPaisa, { withSymbol: true })}
          </p>
          {discounted ? (
            <p
              className="text-body-sm text-ink-2 numeral m-0 text-right"
              aria-label="Bill discount"
            >
              Bill {formatPaisa(subtotalPaisa, { withSymbol: true })} · Discount{' '}
              {formatPaisa(discountPaisa, { withSymbol: true })}
              {approvedBy ? <span className="block">Approved by {approvedBy.name}</span> : null}
            </p>
          ) : null}
        </div>

        {/* In view from the start, empty, saying what to type: the same words
            a line discount takes. A button to find first, and a box asking
            for the new total, is what a salesperson could not work out. */}
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>Discount on the bill</FieldLabel>
            <input
              autoComplete="off"
              id="bill-discount"
              ref={discountField}
              value={discountInput}
              inputMode="decimal"
              placeholder="e.g. 50 or 10%"
              aria-invalid={parsed.ok ? undefined : true}
              onFocus={(event) => event.target.select()}
              onChange={(event) => {
                setDiscountInput(event.target.value);
                setPinEntry({ pin: '', message: null, busy: false });
                setNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (parsed.ok && waitingForOwner) {
                    pinField.current?.focus();
                  } else if (parsed.ok) {
                    focusTendered();
                  }
                }
                if (event.key === 'Escape') {
                  onCancel();
                }
              }}
              className={`${inputClass} numeral text-field-lg text-right font-medium`}
            />
          </label>
          {!parsed.ok ? (
            <span className="text-body-sm text-red font-medium" role="alert">
              {parsed.reason === 'above_bill'
                ? `That is more than the bill (${formatPaisa(subtotalPaisa, { withSymbol: true })}).`
                : 'Type what comes off, like 50 or 10%.'}
            </span>
          ) : (
            <span className="text-body-sm text-ink-2 max-md:hidden">
              <Kbd>%</Kbd> in Cash tendered jumps here. Applied as you type.
            </span>
          )}
        </div>

        {waitingForOwner ? (
          <div className="bg-page flex flex-col gap-3 rounded-card p-4">
            <p className="text-body-sm m-0">
              <strong className="text-amber-text font-medium">
                Over the shop&rsquo;s limit of {capPercent}%.
              </strong>{' '}
              Discount {formatPaisa(discountPaisa, { withSymbol: true })} is more than that. The
              owner enters their PIN to approve it.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1.5">
                <FieldLabel>Owner&rsquo;s PIN</FieldLabel>
                <input
                  id="owner-pin"
                  ref={pinField}
                  // A PIN, never a saved login: `off` is ignored on credential
                  // fields, `one-time-code` is not (password-autofill.test.ts).
                  autoComplete="one-time-code"
                  type="password"
                  inputMode="numeric"
                  maxLength={PIN_LENGTH}
                  value={pinEntry.pin}
                  aria-invalid={pinEntry.message ? true : undefined}
                  // Read-only, not disabled, while it is checked: a disabled field
                  // loses focus, and Esc after a wrong PIN then reached nothing.
                  readOnly={pinEntry.busy}
                  onChange={(event) =>
                    setPinEntry({
                      ...pinEntry,
                      pin: event.target.value.replace(/\D/g, ''),
                      message: null,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitPin();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      clearDiscount();
                    }
                  }}
                  className={`${inputClass} numeral text-center text-2xl tracking-[0.5em]`}
                />
              </label>
              {pinEntry.message ? (
                <span className="text-body-sm text-red font-medium" role="alert">
                  {pinEntry.message}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button kind="quiet" onClick={clearDiscount}>
                No discount <Kbd>Esc</Kbd>
              </Button>
              <Button
                onClick={() => void submitPin()}
                disabled={pinEntry.pin.length !== PIN_LENGTH || pinEntry.busy}
              >
                {pinEntry.busy ? (
                  'Checking…'
                ) : (
                  <>
                    Approve <Kbd>Enter</Kbd>
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <FieldLabel>Cash tendered</FieldLabel>
          <span className="relative block">
            <span
              aria-hidden="true"
              className="text-body-sm text-ink-2 pointer-events-none absolute inset-y-0 left-3.5 flex items-center"
            >
              Rs
            </span>
            <input
              autoComplete="off"
              id="tendered"
              ref={field}
              value={tenderedText}
              inputMode="decimal"
              onChange={(event) => {
                setTenderedInput(event.target.value);
                setTenderedTyped(true);
                setNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === '%') {
                  event.preventDefault();
                  discountField.current?.focus();
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (needsClickToCommit(tenderedPaisa)) {
                    setNotice(
                      `${formatPaisa(tenderedPaisa, { withSymbol: true })} tendered looks like a barcode. If it is right, click Commit.`,
                    );
                    return;
                  }
                  commit();
                }
                if (event.key === 'Escape') {
                  onCancel();
                }
              }}
              className={`${inputClass} numeral pl-11 text-right text-2xl font-medium`}
            />
          </span>
        </label>

        {notice ? (
          <p className="text-body-sm text-red m-0 font-medium" role="alert">
            {notice}
          </p>
        ) : null}

        {split.changePaisa > 0 ? (
          // Phase 10 §4: change rendered enormous — once change is owed it is
          // the largest figure on the screen (PCN-016).
          <div className="flex flex-col items-center gap-1 py-2" role="status">
            <span className="text-label text-ink-2">Change</span>
            <p
              className="text-navy numeral text-change m-0 flex items-baseline gap-2 font-semibold tracking-tight whitespace-nowrap"
              aria-label={`Change ${formatPaisa(split.changePaisa, { withSymbol: true })}`}
            >
              <small className="text-stat text-ink-2">Rs</small>
              {formatPaisa(split.changePaisa)}
            </p>
          </div>
        ) : null}

        {/* The same calculator, the other direction: tendering less than the
            total shows the shortfall immediately, so the cashier never reaches
            for a separate calculator to know what is short before deciding
            what to do about it (attach a customer, or ask for more cash). */}
        {short ? (
          <div className="flex flex-col items-center gap-1 py-2" role="status">
            <span className="text-label text-ink-2">
              {customerName ? 'On udhaar' : 'Remaining'}
            </span>
            <p className="text-amber-text numeral text-change m-0 flex items-baseline gap-2 font-semibold tracking-tight whitespace-nowrap">
              <small className="text-stat text-ink-2">Rs</small>
              {formatPaisa(split.creditPaisa)}
            </p>
          </div>
        ) : null}

        {/* With a customer attached and the whole bill tendered, the screen
            said nothing about udhaar: knowing to type what they pay now (0
            for all of it) had to be taught. Said here, where it is done. */}
        {customerName && !short && split.changePaisa === 0 ? (
          <p className="text-body-sm text-ink-2 m-0">
            Paid in full. For udhaar, type what {customerName} pays now — 0 puts it all on udhaar.
          </p>
        ) : null}

        {!customerName && !short && split.changePaisa === 0 && parsed.ok ? (
          <p className="text-body-sm text-ink-2 m-0">Exact amount. Type more for change.</p>
        ) : null}

        {short ? (
          customerName ? (
            <p className="text-body-sm m-0">
              <strong className="text-amber-text font-medium">
                {formatPaisa(split.creditPaisa, { withSymbol: true })} goes on {customerName}’s
                udhaar.
              </strong>
              {customerBalancePaisa !== null
                ? ` ${positionPhrase(customerBalancePaisa + split.creditPaisa)} after this.`
                : null}
            </p>
          ) : (
            <p className="text-body-sm text-red m-0 font-medium" role="alert">
              Attach a customer ({keyFor('udhaar')}) to put the rest on udhaar.
            </p>
          )
        ) : null}

        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
          <Button kind="quiet" onClick={onCancel}>
            Cancel <Kbd>Esc</Kbd>
          </Button>
          <Button kind="primary" onClick={commit} disabled={!canCommit || busy}>
            {busy ? (
              'Saving…'
            ) : (
              <>
                Commit <Kbd>Enter</Kbd>
              </>
            )}
          </Button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
