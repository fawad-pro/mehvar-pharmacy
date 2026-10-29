'use client';

/**
 * Settle Udhaar — W3, the udhaar key on an empty cart (defect C5).
 *
 *   "Trigger: customer pays down debt, usually without buying. Path:
 *    settlement key → customer → amount → commit → receipt (mini-statement:
 *    previous balance, paid, new balance)." Under 10 seconds; partial amounts
 *    are the norm.
 *
 * Global, because paying down a debt has nothing to do with what screen the
 * operator happened to be on — AppShell owns this overlay and the udhaar key
 * falls back to it whenever the Sale surface hasn't taken the key for itself
 * (empty cart).
 */

import { useEffect, useRef, useState } from 'react';

import type { CustomerHit } from '@/app/(counter)/customers/actions';
import { paisaFromRupeeInput } from '@/domain/sales/cart';
import { miniStatement } from '@/domain/udhaar/settlement';
import { settlementEffect } from '@/domain/udhaar/position';
import { PositionInline } from '@/components/balance-figure';
import { Banner } from '@/components/ui/banner';
import { Button, Kbd } from '@/components/ui/button';
import { dialogPanelClass } from '@/components/ui/dialog';
import { FieldLabel, inputClass } from '@/components/ui/field';
import { CustomerPicker } from '@/components/customer-picker';
import { OverlayBackdrop } from '@/components/overlay-backdrop';
import { ReceiptView } from '@/components/receipt-view';
import { useReceiptContext } from '@/client/receipt/receipt-context';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import type { ReceiptData } from '@/client/print/receipt';
import { useSync } from '@/client/sync/provider';
import { needsClickToCommit } from '@/client/scan/amount-guard';
import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';
import { uuidv7 } from '@/lib/uuid';

type Step =
  | { name: 'pick' }
  | { name: 'amount'; customer: CustomerHit }
  | {
      name: 'done';
      customer: CustomerHit;
      receiptNumber: string;
      statement: { previousBalancePaisa: number; amountPaisa: number; newBalancePaisa: number };
      /** Kept for "Print again". */
      slip: ReceiptData;
    };

export function SettleUdhaarOverlay({
  initialCustomer,
  onClose,
}: {
  /**
   * Skips the picker when the customer is already known — opening this from a
   * customer's own page, where their name and balance are on screen, should
   * not ask who is paying.
   */
  initialCustomer?: CustomerHit;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(
    initialCustomer ? { name: 'amount', customer: initialCustomer } : { name: 'pick' },
  );
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receiptContext = useReceiptContext();
  const { receipt, print } = usePrintReceipt();
  const { capture } = useSync();
  const amountField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step.name === 'amount') {
      amountField.current?.focus();
    }
  }, [step]);

  /**
   * Captures the settlement — ADR-3 lists settlements among the four events
   * that keep working through a disruption, so this takes the same queue-first
   * path a sale does.
   *
   * The mini-statement is computed from the balance the picker showed, which is
   * the client's last-known figure rather than the server's. That is the same
   * trade the sale receipt makes, and Phase 5 invariant 3 is what makes it
   * safe: the balance is a derivation over records, so whatever this slip says,
   * the customer's real balance is always recomputable and always right.
   */
  async function commit(customer: CustomerHit): Promise<void> {
    const amountPaisa = paisaFromRupeeInput(amount);
    if (amountPaisa <= 0 || busy || !receiptContext) {
      return;
    }
    setBusy(true);
    setError(null);

    const receiptNumber = receiptContext.nextReceiptNumber();
    const statement = miniStatement(customer.balancePaisa, -amountPaisa);

    try {
      await capture({
        kind: 'settlement',
        payload: {
          paymentId: uuidv7(),
          receiptNumber,
          customerId: customer.id,
          amountPaisa,
          clientCommittedAt: new Date().toISOString(),
        },
      });
    } catch {
      receiptContext.skipReceiptNumber(receiptNumber);
      setError('This machine could not save the payment. Do not mark it paid — get help.');
      setBusy(false);
      return;
    }

    // Printed before "Done" shows: the page takes no keys while printing,
    // and Done is when the next key is pressed (the Sale screen's rule).
    const slip: ReceiptData = {
      receiptNumber,
      dateTime: new Date(),
      salesmanName: receiptContext.salesmanName,
      tenantHeaderLines: receiptContext.tenantHeaderLines,
      tenantFooterLine: receiptContext.tenantFooterLine,
      customerName: customer.name,
      miniStatement: statement,
    };
    await print(slip);
    setBusy(false);
    setStep({ name: 'done', customer, receiptNumber, statement, slip });
  }

  return (
    <>
      {step.name === 'pick' ? (
        <CustomerPicker
          title="Settle udhaar"
          onPick={(customer) => {
            setStep({ name: 'amount', customer });
          }}
          onCancel={onClose}
        />
      ) : (
        <OverlayBackdrop label="Settle udhaar" onEscape={onClose}>
          <div className={dialogPanelClass}>
            <h2 className="text-heading m-0">
              {step.name === 'amount' ? 'Settle udhaar' : 'Settled'}
            </h2>

            {step.name === 'amount' ? (
              <>
                {/* Partial payment is the norm (W3), so the amount is free
                    entry — which makes "half of what?" a question the screen
                    has to answer at the moment the figure is typed, not one
                    the cashier carries in their head from the picker. */}
                <div className="bg-page flex items-center gap-3 rounded-card px-4 py-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-control truncate font-semibold">
                      {step.customer.name}
                    </span>
                    {step.customer.phone ? (
                      <span className="text-body-sm text-ink-2 numeral text-left">
                        {step.customer.phone}
                      </span>
                    ) : null}
                  </span>
                  <PositionInline
                    balancePaisa={step.customer.balancePaisa}
                    className="text-control"
                  />
                </div>

                <label className="flex flex-col gap-1.5">
                  <FieldLabel>Amount paid</FieldLabel>
                  <span className="relative block">
                    <span
                      aria-hidden="true"
                      className="text-body-sm text-ink-2 pointer-events-none absolute inset-y-0 left-3.5 flex items-center"
                    >
                      Rs
                    </span>
                    <input
                      autoComplete="off"
                      id="settle-amount"
                      ref={amountField}
                      value={amount}
                      inputMode="decimal"
                      onChange={(event) => {
                        setAmount(event.target.value);
                        setError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          const typed = paisaFromRupeeInput(amount);
                          if (needsClickToCommit(typed)) {
                            setError(
                              `${formatPaisa(typed, { withSymbol: true })} looks like a barcode. If it is right, click Settle.`,
                            );
                            return;
                          }
                          void commit(step.customer);
                        }
                        if (event.key === 'Escape') {
                          onClose();
                        }
                      }}
                      className={`${inputClass} numeral text-field-lg pl-11 text-right font-medium`}
                      placeholder="0.00"
                    />
                  </span>
                </label>

                {/* What this amount will actually do, said before it is
                    committed. Overpayment is legal (W3 caps nothing) and is
                    recorded exactly as asked — but unannounced it produced the
                    single most confusing thing in the product: a balance that
                    appeared to move the wrong way after a payment. The rule is
                    "never surprise", not "never allow". */}
                {(() => {
                  const typed = paisaFromRupeeInput(amount);
                  if (typed <= 0) return null;
                  const effect = settlementEffect(step.customer.balancePaisa, typed);
                  const after = (
                    <>
                      After this:{' '}
                      <PositionInline balancePaisa={step.customer.balancePaisa - typed} />
                    </>
                  );
                  if (effect.overpaidPaisa === 0) {
                    return (
                      <p className="bg-page text-body-sm m-0 rounded-card px-4 py-3">{after}</p>
                    );
                  }
                  return (
                    <p className="bg-page text-body-sm m-0 rounded-card px-4 py-3">
                      That is more than {step.customer.name} owes.{' '}
                      {effect.clearsPaisa > 0 ? (
                        <>
                          {formatPaisa(paisa(effect.clearsPaisa), { withSymbol: true })} clears the
                          udhaar and{' '}
                        </>
                      ) : null}
                      <strong className="font-semibold">
                        {formatPaisa(paisa(effect.overpaidPaisa), { withSymbol: true })} is kept as
                        an advance
                      </strong>{' '}
                      for the next purchase.
                      <br />
                      {after}
                    </p>
                  );
                })()}

                {error ? (
                  <p className="text-body-sm text-red m-0 font-medium" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
                  <Button kind="quiet" onClick={onClose}>
                    Cancel <Kbd>Esc</Kbd>
                  </Button>
                  <Button
                    kind="primary"
                    onClick={() => void commit(step.customer)}
                    disabled={paisaFromRupeeInput(amount) <= 0 || busy || !receiptContext}
                  >
                    {busy ? (
                      'Saving…'
                    ) : (
                      <>
                        Settle <Kbd>Enter</Kbd>
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Banner tone="done" role="status" lead={`Saved — ${step.receiptNumber}.`}>
                  The slip has printed.
                </Banner>
                {/* The dispute-ender (T4/T5). Balances speak the position
                    vocabulary; only "Paid" is a plain amount, because it is a
                    transaction rather than a position. */}
                <div
                  className="bg-page text-control flex flex-col gap-1.5 rounded-card p-4"
                  aria-label={`${step.customer.name}’s udhaar`}
                >
                  <p className="m-0 flex justify-between gap-3">
                    <span>{step.customer.name}, before</span>
                    <PositionInline balancePaisa={step.statement.previousBalancePaisa} />
                  </p>
                  <p className="m-0 flex justify-between gap-3">
                    <span>Paid</span>
                    <b className="numeral font-medium">
                      {formatPaisa(paisa(Math.abs(step.statement.amountPaisa)), {
                        withSymbol: true,
                      })}
                    </b>
                  </p>
                  <p className="border-line m-0 flex justify-between gap-3 border-t pt-1.5 font-semibold">
                    <span>Now</span>
                    <PositionInline balancePaisa={step.statement.newBalancePaisa} />
                  </p>
                </div>

                <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
                  <Button
                    kind="quiet"
                    onClick={() => {
                      void print(step.slip);
                    }}
                  >
                    Print again
                  </Button>
                  <Button
                    kind="primary"
                    // Focus moves here when the payment is recorded, so Esc
                    // and Enter reach the dialog rather than the page.
                    autoFocus
                    onClick={onClose}
                  >
                    Done <Kbd>Enter</Kbd>
                  </Button>
                </div>
              </>
            )}
          </div>
        </OverlayBackdrop>
      )}

      {receipt ? <ReceiptView receipt={receipt} /> : null}
    </>
  );
}
