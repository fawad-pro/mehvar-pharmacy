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
      <div className="bg-surface w-full max-w-[400px] rounded-dialog p-6 shadow-dialog max-md:max-w-none max-md:rounded-b-none max-md:px-4 max-md:pt-5">
        <h2 className="text-navy mb-4 text-lg font-semibold">Payment</h2>

        {/* The one figure to take, always the largest: "Collect" once a bill
            discount is given, so nobody reads the old bill as the price. */}
        <p className="text-ink-2 text-xs tracking-[0.14em] uppercase">
          {discounted ? 'Collect' : 'Amount Due'}
        </p>
        <p
          className="text-navy numeral text-total leading-none font-semibold"
          aria-label={discounted ? 'Collect' : 'Amount due'}
        >
          {formatPaisa(totalPaisa)}
        </p>
        {discounted ? (
          <p className="text-ink-2 numeral mt-1 text-sm" aria-label="Bill discount">
            Bill {formatPaisa(subtotalPaisa)} · Discount {formatPaisa(discountPaisa)}
            {approvedBy ? (
              <span className="text-ink-2 block text-xs">Approved by {approvedBy.name}</span>
            ) : null}
          </p>
        ) : null}

        {customerName ? <p className="text-ink-2 mt-1 text-sm">Billing to {customerName}</p> : null}

        {/* In view from the start, empty, saying what to type: the same words
            a line discount takes. A button to find first, and a box asking
            for the new total, is what a salesperson could not work out. */}
        <label className="text-ink-2 mt-4 mb-1 block text-xs" htmlFor="bill-discount">
          Discount on the bill
        </label>
        <input
          autoComplete="off"
          id="bill-discount"
          ref={discountField}
          value={discountInput}
          inputMode="decimal"
          placeholder="e.g. 50 or 10%"
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
          className="border-border focus:border-blue-600 numeral h-touch w-full rounded-control border px-3 text-lg"
        />
        {!parsed.ok ? (
          <p className="text-red mt-1 text-sm" role="alert">
            {parsed.reason === 'above_bill'
              ? `That is more than the bill (${formatPaisa(subtotalPaisa)}).`
              : 'Type what comes off, like 50 or 10%.'}
          </p>
        ) : null}

        {waitingForOwner ? (
          <div className="bg-surface shadow-card mt-2 rounded-card p-3">
            <p className="text-sm">
              Discount {formatPaisa(discountPaisa)} is over the shop&rsquo;s limit of {capPercent}%.
              The owner enters their PIN to approve it.
            </p>
            <label className="text-ink-2 mt-2 mb-1 block text-xs" htmlFor="owner-pin">
              Owner&rsquo;s PIN
            </label>
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
              className="border-border focus:border-blue-600 numeral h-touch w-full rounded-control border px-3 text-2xl tracking-[0.5em]"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={clearDiscount}
                className="text-ink-2 min-h-touch text-sm"
              >
                No discount — Esc
              </button>
              <button
                type="button"
                onClick={() => void submitPin()}
                disabled={pinEntry.pin.length !== PIN_LENGTH || pinEntry.busy}
                className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch rounded-control px-4 text-sm disabled:opacity-40"
              >
                {pinEntry.busy ? 'Checking…' : 'Approve'}
              </button>
            </div>
            {pinEntry.message ? (
              <p className="text-red mt-1 text-sm" role="alert">
                {pinEntry.message}
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="text-ink-2 mt-4 mb-1 block text-xs" htmlFor="tendered">
          Cash tendered
        </label>
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
          className="border-border focus:border-blue-600 numeral h-touch w-full rounded-control border px-3 text-2xl"
        />

        {notice ? (
          <p className="text-red mt-2 text-sm" role="alert">
            {notice}
          </p>
        ) : null}

        {split.changePaisa > 0 ? (
          <div className="mt-3 text-center">
            <p className="text-ink-2 text-xs tracking-[0.14em] uppercase">Change</p>
            {/* Phase 10 §4: change rendered enormous. */}
            <p className="text-navy numeral text-change leading-none font-semibold">
              {formatPaisa(split.changePaisa)}
            </p>
          </div>
        ) : null}

        {/* The same calculator, the other direction: tendering less than the
            total shows the shortfall immediately, so the cashier never reaches
            for a separate calculator to know what is short before deciding
            what to do about it (attach a customer, or ask for more cash). */}
        {short ? (
          <div className="mt-3 text-center">
            <p className="text-ink-2 text-xs tracking-[0.14em] uppercase">Remaining</p>
            <p className="text-amber-text numeral text-change leading-none font-semibold">
              {formatPaisa(split.creditPaisa)}
            </p>
          </div>
        ) : null}

        {/* With a customer attached and the whole bill tendered, the screen
            said nothing about udhaar: knowing to type what they pay now (0
            for all of it) had to be taught. Said here, where it is done. */}
        {customerName && !short && split.changePaisa === 0 ? (
          <p className="text-ink-2 mt-3 text-sm">
            Paid in full. For udhaar, type what {customerName} pays now — 0 puts it all on udhaar.
          </p>
        ) : null}

        {short ? (
          customerName ? (
            <p className="text-amber-text mt-3 text-sm">
              {formatPaisa(split.creditPaisa)} goes on {customerName}’s udhaar.
            </p>
          ) : (
            <p className="text-red mt-3 text-sm" role="alert">
              Attach a customer ({keyFor('udhaar')}) to put the rest on udhaar.
            </p>
          )
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onCancel} className="text-ink-2 min-h-touch text-sm">
            Esc to cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!canCommit || busy}
            className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch rounded-control px-5 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Commit — Enter'}
          </button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
