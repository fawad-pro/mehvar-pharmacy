'use client';

/**
 * Settle Udhaar — W3, F8 on an empty cart (defect C5).
 *
 *   "Trigger: customer pays down debt, usually without buying. Path:
 *    settlement key → customer → amount → commit → receipt (mini-statement:
 *    previous balance, paid, new balance)." Under 10 seconds; partial amounts
 *    are the norm.
 *
 * Global, because paying down a debt has nothing to do with what screen the
 * operator happened to be on — AppShell owns this overlay and F8 falls back to
 * it whenever the Sale surface hasn't taken the key for itself (empty cart).
 */

import { useEffect, useRef, useState } from 'react';

import type { CustomerHit } from '@/app/(counter)/customers/actions';
import { paisaFromRupeeInput } from '@/domain/sales/cart';
import { miniStatement } from '@/domain/udhaar/settlement';
import { settlementEffect } from '@/domain/udhaar/position';
import { BalanceInline } from '@/components/balance-figure';
import { CustomerPicker } from '@/components/customer-picker';
import { ReceiptView } from '@/components/receipt-view';
import { useReceiptContext } from '@/client/receipt/receipt-context';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import { useSync } from '@/client/sync/provider';
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

    setBusy(false);
    setStep({ name: 'done', customer, receiptNumber, statement });

    print({
      receiptNumber,
      dateTime: new Date(),
      salesmanName: receiptContext.salesmanName,
      tenantHeaderLines: receiptContext.tenantHeaderLines,
      tenantFooterLine: receiptContext.tenantFooterLine,
      customerName: customer.name,
      miniStatement: statement,
    });
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
        <div
          className="bg-ink/40 fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Settle udhaar"
        >
          <div className="bg-paper w-full max-w-sm rounded-lg p-5 shadow-xl">
            <h2 className="text-green-900 mb-1 text-lg font-semibold">Settle udhaar</h2>
            <p className="text-ink/60 mb-4 text-sm">{step.customer.name}</p>

            {step.name === 'amount' ? (
              <>
                {/* Partial payment is the norm (W3), so the amount is free
                    entry — which makes "half of what?" a question the screen
                    has to answer at the moment the figure is typed, not one
                    the cashier carries in their head from the picker. */}
                <div className="border-line mb-3 flex items-baseline justify-between rounded border px-3 py-2">
                  <span className="text-ink/60 text-xs tracking-[0.1em] uppercase">Before</span>
                  <BalanceInline balancePaisa={step.customer.balancePaisa} />
                </div>

                <label className="text-ink/60 mb-1 block text-xs" htmlFor="settle-amount">
                  Amount paid
                </label>
                <input
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
                      void commit(step.customer);
                    }
                    if (event.key === 'Escape') {
                      onClose();
                    }
                  }}
                  className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 text-2xl outline-none"
                  placeholder="0"
                />

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
                  if (effect.overpaidPaisa === 0) {
                    return (
                      <p className="text-ink/60 mt-2 text-sm">
                        Leaves{' '}
                        {effect.resulting.kind === 'settled' ? (
                          <strong className="text-green-900">nothing owing</strong>
                        ) : (
                          <strong className="text-amber">
                            {formatPaisa(paisa(effect.resulting.amountPaisa), { withSymbol: true })}{' '}
                            still owing
                          </strong>
                        )}
                        .
                      </p>
                    );
                  }
                  return (
                    <p className="text-ink/70 border-line mt-2 rounded border border-dashed p-2 text-sm">
                      That is more than is owed.{' '}
                      {effect.clearsPaisa > 0 ? (
                        <>
                          {formatPaisa(paisa(effect.clearsPaisa), { withSymbol: true })} clears the
                          balance and{' '}
                        </>
                      ) : null}
                      <strong>
                        {formatPaisa(paisa(effect.overpaidPaisa), { withSymbol: true })}
                      </strong>{' '}
                      will be held as an advance against future purchases.
                    </p>
                  );
                })()}

                {error ? (
                  <p className="text-red mt-2 text-sm" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="mt-4 flex items-center justify-between">
                  <button type="button" onClick={onClose} className="text-ink/60 text-sm">
                    Esc to cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void commit(step.customer)}
                    disabled={paisaFromRupeeInput(amount) <= 0 || busy || !receiptContext}
                    className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
                  >
                    {busy ? 'Saving…' : 'Settle — Enter'}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* The dispute-ender (T4/T5). Balances speak the position
                    vocabulary; only "Paid" is a plain amount, because it is a
                    transaction rather than a position. */}
                <div className="border-line bg-green-100/50 flex flex-col gap-1 rounded border p-3 text-sm">
                  <BalanceRow
                    label="Before"
                    balancePaisa={step.statement.previousBalancePaisa}
                  />
                  <Row label="Paid" amountPaisa={Math.abs(step.statement.amountPaisa)} />
                  <BalanceRow label="Now" balancePaisa={step.statement.newBalancePaisa} bold />
                </div>
                <p className="text-ink/50 mt-2 text-xs">Receipt {step.receiptNumber}</p>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium"
                  >
                    Done — Esc
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {receipt ? <ReceiptView receipt={receipt} /> : null}
    </>
  );
}

function BalanceRow({
  label,
  balancePaisa,
  bold = false,
}: {
  label: string;
  balancePaisa: number;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <BalanceInline balancePaisa={balancePaisa} />
    </div>
  );
}

function Row({
  label,
  amountPaisa,
  bold = false,
}: {
  label: string;
  amountPaisa: number;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="numeral">{formatPaisa(paisa(amountPaisa))}</span>
    </div>
  );
}
