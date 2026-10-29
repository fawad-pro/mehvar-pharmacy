import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { findReceipt } from '@/db/receipt-queries';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { storedLineGrossPaisa } from '@/domain/sales/sale-command';
import { describeQuantity } from '@/lib/quantity';

import { ReceiptActions } from './receipt-actions';

/**
 * One receipt, in full.
 *
 * THE SEPARATION THIS PAGE MAKES
 *
 * Looking at a sale used to mean opening Returns and searching for it, so the
 * two acts were the same act. Here they are not: this page shows, and the one
 * button that changes anything says "Start a return" and goes somewhere else.
 * A pharmacist checking what a customer bought last Tuesday never touches the
 * refund path.
 *
 * It also answers the question the old flow could not: **what has happened to
 * this receipt since?** A sale carries the returns made against it, and every
 * line states how much of it came back. That is T4 — a figure expands into the
 * transactions that produced it — applied to the receipt rather than to a
 * customer balance.
 */
export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ receiptNumber: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const { receiptNumber } = await params;
  const wanted = decodeURIComponent(receiptNumber);
  const receipt = await findReceipt(scopeFor(session), wanted);
  if (!receipt) {
    // Not "removed": the usual reason is a sale this counter has not sent
    // yet, reached from "View sale" a moment after it was made offline.
    return <NotYetHere receiptNumber={wanted} />;
  }

  const heading =
    receipt.kind === 'sale'
      ? 'Sale'
      : receipt.kind === 'settlement'
        ? 'Payment'
        : receipt.kind === 'payment_cancelled'
          ? 'Payment cancelled'
          : 'Return';

  // [PCN-012] What the line actually charged: the stored amount when there is
  // one, per-base price × base quantity for a line from before PCN-012.
  const lineGross = storedLineGrossPaisa;
  const lineTotal = (
    line: Parameters<typeof storedLineGrossPaisa>[0] & { lineDiscountPaisa: number },
  ) => lineGross(line) - line.lineDiscountPaisa;

  // Subtotal is the GROSS figure — before any line's own discount — never a
  // sum of `lineTotal`, which is already net. Summing net totals made
  // "Subtotal" print the identical number as "Total" whenever a line carried
  // a discount, the same bug the live receipt had (sale-surface.tsx).
  const subtotalPaisa = (receipt.lines ?? []).reduce((sum, line) => sum + lineGross(line), 0);
  const lineDiscountTotalPaisa = (receipt.lines ?? []).reduce(
    (sum, line) => sum + line.lineDiscountPaisa,
    0,
  );

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Link href="/receipts" className="text-blue-600 text-sm">
        ← Receipts
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-ink-2 text-xs tracking-[0.14em] uppercase">{heading}</p>
          <h1 className="text-navy numeral text-2xl font-semibold">{receipt.receiptNumber}</h1>
          <p className="text-ink-2 mt-1 text-sm">
            {receipt.createdAt.toLocaleString('en-PK', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}{' '}
            · {receipt.salesmanName}
            {/* Stated rather than hidden: a sale captured offline and synced
                later is a normal thing that happened, and the operator who was
                selling through an outage should be able to confirm it landed. */}
            {receipt.origin === 'offline' ? (
              <span className="text-ink-2 ml-1 text-xs">captured offline</span>
            ) : null}
          </p>
        </div>

        <ReceiptActions
          kind={receipt.kind}
          receiptNumber={receipt.receiptNumber}
          saleId={receipt.kind === 'sale' ? receipt.id : null}
        />
      </header>

      {receipt.customerName ? (
        <p className="text-sm">
          <span className="text-ink-2">Customer: </span>
          {receipt.customerId ? (
            <Link
              href={`/customers/${receipt.customerId}`}
              className="text-blue-600 font-medium hover:underline"
            >
              {receipt.customerName}
            </Link>
          ) : (
            <span className="font-medium">{receipt.customerName}</span>
          )}
        </p>
      ) : null}

      {/* A return says what it was against, and links there — the two records
          are one story and reading either should reach the other. */}
      {receipt.kind === 'return' && receipt.againstReceiptNumber ? (
        <p className="text-sm">
          <span className="text-ink-2">Against sale: </span>
          <Link
            href={`/receipts/${encodeURIComponent(receipt.againstReceiptNumber)}`}
            className="numeral text-blue-600 font-medium hover:underline"
          >
            {receipt.againstReceiptNumber}
          </Link>
        </p>
      ) : null}

      {receipt.lines && receipt.lines.length > 0 ? (
        <div className="bg-surface shadow-card overflow-x-auto rounded-card">
          <table className="text-table w-full text-left">
            <thead className="bg-mist text-ink-2 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Quantity</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line) => (
                <tr key={line.lineId} className="border-line border-t align-top">
                  <td className="px-3 py-2">
                    <Link
                      href={`/products/${line.productId}`}
                      className="text-blue-600 hover:underline"
                    >
                      {line.productName}
                    </Link>
                    {line.priceOverridden ? (
                      <span className="text-amber-text ml-1 text-xs">price changed</span>
                    ) : null}
                    {/* What happened to this line afterwards, on the line
                        itself — the question is asked per item, not per sale. */}
                    {line.returnedBase > 0 ? (
                      <p className="text-amber-text text-xs">
                        {describeQuantity(
                          baseQty(line.returnedBase),
                          line.baseUnitName,
                          line.packLevels,
                        )}{' '}
                        returned
                      </p>
                    ) : null}
                  </td>
                  <td className="text-ink-2 px-3 py-2">
                    {/* W5's natural language, the same words the printed slip
                        used — never a raw base-unit count. */}
                    {line.unitCount !== null && line.unitName !== null
                      ? `${line.unitCount} ${line.unitName}`
                      : describeQuantity(baseQty(line.qtyBase), line.baseUnitName, line.packLevels)}
                  </td>
                  <td className="numeral px-3 py-2 text-right">
                    {/* The price of one unit as sold; per base unit only for a
                        line from before PCN-012, which is what it charged. */}
                    {formatPaisa(paisa(line.unitPricePaisaEntered ?? line.unitPricePaisa))}
                  </td>
                  <td className="numeral px-3 py-2 text-right">
                    {formatPaisa(paisa(lineTotal(line)))}
                    {line.lineDiscountPaisa > 0 ? (
                      <p className="text-ink-2 text-xs">
                        −{formatPaisa(paisa(line.lineDiscountPaisa))} off
                      </p>
                    ) : null}
                    {/* [PCN-014] How the bill discount fell on this line, and
                        so what it paid — what a return of it gives back. */}
                    {line.invoiceDiscountSharePaisa > 0 ? (
                      <p className="text-ink-2 text-xs">
                        −{formatPaisa(paisa(line.invoiceDiscountSharePaisa))} bill discount · paid{' '}
                        {formatPaisa(paisa(lineTotal(line) - line.invoiceDiscountSharePaisa))}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="bg-surface shadow-card flex flex-col gap-1 rounded-card p-4 text-sm">
        {receipt.kind === 'sale' ? (
          <>
            <Line label="Subtotal" amountPaisa={subtotalPaisa} />
            {/* [PCN-014] Item discounts and the bill discount, each on a row of
                its own, in the order they came off — as the printed receipt. */}
            {lineDiscountTotalPaisa > 0 ? (
              <Line
                label={receipt.invoiceDiscountPaisa ? 'Item discounts' : 'Discount'}
                amountPaisa={-lineDiscountTotalPaisa}
              />
            ) : null}
            {receipt.invoiceDiscountPaisa ? (
              <>
                <Line label="Bill discount" amountPaisa={-receipt.invoiceDiscountPaisa} />
                {receipt.invoiceDiscountApprovedByName ? (
                  <p className="text-ink-2 text-xs">
                    Approved by {receipt.invoiceDiscountApprovedByName}
                  </p>
                ) : null}
              </>
            ) : null}
            <Line label="Total" amountPaisa={receipt.totalPaisa ?? 0} bold />
            {receipt.cashPaisa ? <Line label="Cash" amountPaisa={receipt.cashPaisa} /> : null}
            {receipt.creditPaisa ? (
              <Line label="On udhaar" amountPaisa={receipt.creditPaisa} />
            ) : null}
            {receipt.changePaisa ? <Line label="Change" amountPaisa={receipt.changePaisa} /> : null}
          </>
        ) : null}

        {receipt.kind === 'settlement' ? (
          <>
            <Line label="Paid" amountPaisa={receipt.amountPaisa ?? 0} bold />
            {receipt.cancelledByReceiptNumber ? (
              <p className="text-amber-text mt-1 text-sm">
                Cancelled — see receipt{' '}
                <Link
                  href={`/receipts/${encodeURIComponent(receipt.cancelledByReceiptNumber)}`}
                  className="text-blue-600 hover:underline"
                >
                  {receipt.cancelledByReceiptNumber}
                </Link>
              </p>
            ) : null}
          </>
        ) : null}

        {receipt.kind === 'payment_cancelled' ? (
          <>
            <Line label="Payment cancelled" amountPaisa={receipt.amountPaisa ?? 0} bold />
            {receipt.cancelsReceiptNumber ? (
              <p className="text-ink-2 mt-1 text-sm">
                Cancels receipt{' '}
                <Link
                  href={`/receipts/${encodeURIComponent(receipt.cancelsReceiptNumber)}`}
                  className="text-blue-600 hover:underline"
                >
                  {receipt.cancelsReceiptNumber}
                </Link>
                ; the amount is back on the customer&rsquo;s balance.
              </p>
            ) : null}
          </>
        ) : null}

        {receipt.kind === 'return' ? (
          <>
            {receipt.cashOutPaisa ? (
              <Line label="Refunded in cash" amountPaisa={receipt.cashOutPaisa} />
            ) : null}
            {receipt.creditReducedPaisa ? (
              <Line label="Taken off udhaar" amountPaisa={receipt.creditReducedPaisa} />
            ) : null}
            <Line
              label="Total returned"
              amountPaisa={(receipt.cashOutPaisa ?? 0) + (receipt.creditReducedPaisa ?? 0)}
              bold
            />
            {receipt.reasonNote ? (
              <p className="text-ink-2 mt-1 text-xs">Reason: {receipt.reasonNote}</p>
            ) : null}
          </>
        ) : null}
      </div>

      {/* What happened after — the half the old flow could not show at all. */}
      {receipt.kind === 'sale' && receipt.returns && receipt.returns.length > 0 ? (
        <div>
          <h2 className="text-ink-2 mb-2 text-xs tracking-[0.14em] uppercase">
            Returned against this sale
          </h2>
          <div className="bg-surface shadow-card overflow-x-auto rounded-card">
            <table className="text-table w-full text-left">
              <tbody>
                {receipt.returns.map((entry) => (
                  <tr key={entry.returnId} className="border-line border-t first:border-t-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/receipts/${encodeURIComponent(entry.receiptNumber)}`}
                        className="numeral text-blue-600 hover:underline"
                      >
                        {entry.receiptNumber}
                      </Link>
                    </td>
                    <td className="text-ink-2 px-3 py-2 text-sm">
                      {entry.createdAt.toLocaleDateString('en-PK')}
                    </td>
                    <td className="text-ink-2 px-3 py-2 text-sm">{entry.reasonNote ?? '—'}</td>
                    <td className="numeral px-3 py-2 text-right">
                      {formatPaisa(paisa(entry.cashOutPaisa + entry.creditReducedPaisa), {
                        withSymbol: true,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Line({
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
      <span className={bold ? '' : 'text-ink-2'}>{label}</span>
      <span className="numeral">
        {amountPaisa < 0 ? '−' : ''}
        {formatPaisa(paisa(Math.abs(amountPaisa)), { withSymbol: true })}
      </span>
    </div>
  );
}

function NotYetHere({ receiptNumber }: { receiptNumber: string }) {
  return (
    <section className="mx-auto flex max-w-lg flex-col items-start gap-4 p-8">
      <h1 className="text-navy text-2xl font-semibold">Receipt {receiptNumber}</h1>
      <p className="text-ink-2 leading-relaxed">
        This receipt is not on the shop&rsquo;s computer yet. A sale made while this counter was
        offline appears here once the counter has sent it — the top bar says when anything is still
        waiting. Otherwise, check the number.
      </p>
      <Link
        href="/receipts"
        className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch flex items-center rounded-control px-6"
      >
        All receipts
      </Link>
    </section>
  );
}
