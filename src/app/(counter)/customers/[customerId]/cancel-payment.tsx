'use client';

/**
 * [PCN-013] Cancel an udhaar payment typed wrong, and print the slip that says
 * so. The customer holds a slip for the original; this one is numbered from
 * the counter's own sequence, exactly as a settlement's is, and prints only
 * once the server has recorded the cancellation — unlike a settlement, this
 * is not an outbox record, so there is nothing local to print from first.
 *
 * Rendered for every payment row, cancelled or not, so that it stays mounted
 * when the refresh after a cancellation turns its row into "cancelled": the
 * slip it is about to print lives in its state.
 */

import { CancelEntryButton } from '@/components/cancel-entry-button';
import { ReceiptView } from '@/components/receipt-view';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import { useReceiptContext } from '@/client/receipt/receipt-context';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import type { Uuid } from '@/lib/uuid';

import { cancelPaymentAction } from '../actions';

export function CancelPayment({
  paymentId,
  amountPaisa,
  customerName,
  reversed,
}: {
  paymentId: string;
  amountPaisa: number;
  customerName: string;
  reversed: boolean;
}) {
  const receiptContext = useReceiptContext();
  const { receipt, print } = usePrintReceipt();

  return (
    <>
      {reversed ? null : (
        <CancelEntryButton
          what={`the ${formatPaisa(paisa(amountPaisa), { withSymbol: true })} payment`}
          run={async () => {
            if (!receiptContext) {
              return { ok: false, message: 'This counter is still getting ready. Try again.' };
            }
            const receiptNumber = receiptContext.nextReceiptNumber();
            const outcome = await cancelPaymentAction(paymentId as Uuid, receiptNumber).catch(
              () => ({
                ok: false as const,
                message: 'Cancelling needs a connection to the shop’s computer. Try again.',
              }),
            );
            if (!outcome.ok) {
              receiptContext.skipReceiptNumber(receiptNumber);
              return outcome;
            }
            // Awaited, so "cancelled" shows once the page takes keys again.
            await print({
              receiptNumber,
              dateTime: new Date(),
              salesmanName: receiptContext.salesmanName,
              tenantHeaderLines: receiptContext.tenantHeaderLines,
              tenantFooterLine: receiptContext.tenantFooterLine,
              customerName,
              cancellation: { againstReceiptNumber: outcome.againstReceiptNumber },
              miniStatement: outcome.statement,
            });
            return { ok: true };
          }}
        />
      )}
      {receipt ? <ReceiptView receipt={receipt} /> : null}
    </>
  );
}
