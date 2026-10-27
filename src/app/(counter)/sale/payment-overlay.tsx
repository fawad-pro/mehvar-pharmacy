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
 * [PCN-014] The bill discount lives here, as the amount to collect: `%` (the
 * key a line discount already uses) or the "Bill discount" button opens it,
 * the salesperson types what the customer will pay, and Enter applies it. The
 * fast path is untouched — F12, Enter still sells at the full amount. When
 * all discounts together pass the shop's limit, the owner's PIN is asked for
 * here, and the screen then says who approved. Whatever the discount, the
 * figure to take is the largest thing on the screen.
 */

import { useEffect, useRef, useState } from 'react';

import { PIN_LENGTH } from '@/auth/pin-policy';
import {
  billDiscountFromCollect,
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

type Editing =
  | { step: 'collect'; input: string; message: string | null }
  | { step: 'pin'; discountPaisa: Paisa; pin: string; message: string | null; busy: boolean };

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
  const [bill, setBill] = useState<BillDiscount>({ discountPaisa: ZERO_PAISA, approvedBy: null });
  const [editing, setEditing] = useState<Editing | null>(null);
  const totalPaisa = subtractPaisa(subtotalPaisa, bill.discountPaisa);
  const [tenderedInput, setTenderedInput] = useState(() => (subtotalPaisa / 100).toFixed(2));
  /** Until the cashier types a tendered amount, it follows the amount to collect. */
  const [tenderedTyped, setTenderedTyped] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  /** Why Enter did not commit: an amount too large to be cash (see amount-guard). */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (editing === null) {
      field.current?.focus();
      field.current?.select();
    }
  }, [editing]);

  const tenderedPaisa = paisaFromRupeeInput(tenderedInput);
  const split = splitPayment(totalPaisa, tenderedPaisa);
  const short = split.creditPaisa > 0;
  const canCommit = !short || customerName !== null;

  function commit(): void {
    if (!canCommit || busy || editing !== null) {
      return;
    }
    onCommit({ ...split, tenderedPaisa }, bill);
  }

  function apply(discountPaisa: Paisa, approvedBy: BillDiscount['approvedBy']): void {
    setBill({ discountPaisa, approvedBy });
    setEditing(null);
    if (!tenderedTyped) {
      setTenderedInput((subtractPaisa(subtotalPaisa, discountPaisa) / 100).toFixed(2));
    }
  }

  function openDiscount(): void {
    setNotice(null);
    setEditing({ step: 'collect', input: (totalPaisa / 100).toFixed(2), message: null });
  }

  function submitCollect(input: string): void {
    const result = billDiscountFromCollect(subtotalPaisa, input);
    if (!result.ok) {
      setEditing({
        step: 'collect',
        input,
        message:
          result.reason === 'above_bill'
            ? `That is more than the bill (${formatPaisa(subtotalPaisa)}). Type what the customer will pay.`
            : 'Type the amount the customer will pay, in rupees.',
      });
      return;
    }
    const needsOwner = billDiscountNeedsApproval({
      grossPaisa,
      itemDiscountPaisa,
      billDiscountPaisa: result.discountPaisa,
      capPercent,
    });
    if (needsOwner) {
      setEditing({
        step: 'pin',
        discountPaisa: result.discountPaisa,
        pin: '',
        message: null,
        busy: false,
      });
      return;
    }
    apply(result.discountPaisa, null);
  }

  async function submitPin(state: Extract<Editing, { step: 'pin' }>): Promise<void> {
    if (state.pin.length !== PIN_LENGTH || state.busy) return;
    setEditing({ ...state, busy: true, message: null });
    const approval = await approveBillDiscountAction(state.pin).catch(() => null);
    if (approval === null) {
      setEditing({
        ...state,
        pin: '',
        busy: false,
        message:
          'The owner’s PIN needs a connection to the shop’s computer. Sell at the full amount, or within the limit.',
      });
      return;
    }
    if (!approval.ok) {
      setEditing({ ...state, pin: '', busy: false, message: approval.message });
      return;
    }
    apply(state.discountPaisa, { id: approval.ownerId, name: approval.ownerName });
  }

  const discounted = bill.discountPaisa > 0;

  return (
    // No onDismiss: Esc, deliberately pressed, is the only way out of this one.
    <OverlayBackdrop label="Payment">
      <div className="bg-paper w-full max-w-sm rounded-lg p-5 shadow-xl">
        <h2 className="text-green-900 mb-4 text-lg font-semibold">Payment</h2>

        {/* The one figure to take, always the largest: "Collect" once a bill
            discount is given, so nobody reads the old bill as the price. */}
        <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">
          {discounted ? 'Collect' : 'Amount Due'}
        </p>
        <p
          className="text-green-900 numeral text-total leading-none font-semibold"
          aria-label={discounted ? 'Collect' : 'Amount due'}
        >
          {formatPaisa(totalPaisa)}
        </p>
        {discounted ? (
          <p className="text-ink/60 numeral mt-1 text-sm" aria-label="Bill discount">
            Bill {formatPaisa(subtotalPaisa)} · Discount {formatPaisa(bill.discountPaisa)}
            {bill.approvedBy ? (
              <span className="text-ink/50 block text-xs">Approved by {bill.approvedBy.name}</span>
            ) : null}
          </p>
        ) : null}

        {customerName ? (
          <p className="text-ink/50 mt-1 text-sm">Billing to {customerName}</p>
        ) : null}

        {editing?.step === 'collect' ? (
          <div className="border-line mt-4 rounded border p-3">
            <label className="text-ink/60 mb-1 block text-xs" htmlFor="collect">
              Amount to collect
            </label>
            <input
              autoComplete="off"
              id="collect"
              autoFocus
              value={editing.input}
              inputMode="decimal"
              onFocus={(event) => event.target.select()}
              onChange={(event) =>
                setEditing({ step: 'collect', input: event.target.value, message: null })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitCollect(editing.input);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(null);
                }
              }}
              className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 text-2xl outline-none"
            />
            <p className="text-ink/50 mt-1 text-xs">
              Bill {formatPaisa(subtotalPaisa)}. Enter to apply, Esc to leave it as it was.
            </p>
            {editing.message ? (
              <p className="text-red mt-1 text-sm" role="alert">
                {editing.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {editing?.step === 'pin' ? (
          <div className="border-line mt-4 rounded border p-3">
            <p className="text-sm">
              Discount {formatPaisa(editing.discountPaisa)} is over the shop&rsquo;s limit of{' '}
              {capPercent}%. The owner enters their PIN to approve it.
            </p>
            <label className="text-ink/60 mt-2 mb-1 block text-xs" htmlFor="owner-pin">
              Owner&rsquo;s PIN
            </label>
            <input
              id="owner-pin"
              autoFocus
              // A PIN, never a saved login: `off` is ignored on credential
              // fields, `one-time-code` is not (password-autofill.test.ts).
              autoComplete="one-time-code"
              type="password"
              inputMode="numeric"
              maxLength={PIN_LENGTH}
              value={editing.pin}
              // Read-only, not disabled, while it is checked: a disabled field
              // loses focus, and Esc after a wrong PIN then reached nothing.
              readOnly={editing.busy}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  pin: event.target.value.replace(/\D/g, ''),
                  message: null,
                })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submitPin(editing);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(null);
                }
              }}
              className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 text-2xl tracking-[0.5em] outline-none"
            />
            <p className="text-ink/50 mt-1 text-xs">Esc to sell without this discount.</p>
            {editing.message ? (
              <p className="text-red mt-1 text-sm" role="alert">
                {editing.message}
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="text-ink/60 mt-4 mb-1 block text-xs" htmlFor="tendered">
          Cash tendered
        </label>
        <input
          autoComplete="off"
          id="tendered"
          ref={field}
          value={tenderedInput}
          inputMode="decimal"
          disabled={editing !== null}
          onChange={(event) => {
            setTenderedInput(event.target.value);
            setTenderedTyped(true);
            setNotice(null);
          }}
          onKeyDown={(event) => {
            if (event.key === '%') {
              event.preventDefault();
              openDiscount();
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
          className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 text-2xl outline-none"
        />

        {notice ? (
          <p className="text-red mt-2 text-sm" role="alert">
            {notice}
          </p>
        ) : null}

        {split.changePaisa > 0 ? (
          <div className="mt-3 text-center">
            <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Change</p>
            {/* Phase 10 §4: change rendered enormous. */}
            <p className="text-green-900 numeral text-change leading-none font-semibold">
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
            <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Remaining</p>
            <p className="text-amber numeral text-change leading-none font-semibold">
              {formatPaisa(split.creditPaisa)}
            </p>
          </div>
        ) : null}

        {short ? (
          customerName ? (
            <p className="text-amber mt-3 text-sm">
              {formatPaisa(split.creditPaisa)} goes on {customerName}’s udhaar.
            </p>
          ) : (
            <p className="text-red mt-3 text-sm" role="alert">
              Attach a customer ({keyFor('udhaar')}) to put the rest on udhaar.
            </p>
          )
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onCancel} className="text-ink/60 min-h-touch text-sm">
            Esc to cancel
          </button>
          <button
            type="button"
            onClick={openDiscount}
            disabled={editing !== null || busy}
            className="border-line min-h-touch rounded border px-3 text-sm"
          >
            {discounted ? 'Change discount — %' : 'Bill discount — %'}
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!canCommit || busy || editing !== null}
            className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Commit — Enter'}
          </button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
