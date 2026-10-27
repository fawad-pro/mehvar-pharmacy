'use client';

/**
 * The printed receipt — ADR-6, Phase 10 §7.
 *
 *   "80mm primary / 58mm variant, print-CSS: header = tenant name, phone,
 *    address; body = lines… subtotal/discount/total; payment = cash/tendered/
 *    change or udhaar split; udhaar receipts and settlements print the
 *    mini-statement… footer = receipt number, date/time, salesman name,
 *    configurable thank-you line, and a modest 'Mehvar' mark."
 *
 * Laid out to the owner's pilot feedback: the date and time sit under the
 * shop's own lines, items are columns (QTY | ITEM | AMT) rather than a name
 * with its quantity beneath, and the salesman is named beside the receipt
 * number.
 *
 * Kiosk silent printing (`--kiosk-printing`) is a Chrome launch flag configured
 * once at physical installation (Phase 12 §6); this component's job is only to
 * be the thing that prints correctly when `window.print()` is called — on a
 * kiosk-configured browser that means no dialog, and the fallback everywhere
 * else is the normal print dialog (ADR-6).
 *
 * Only this component's subtree is visible to the print engine; see the
 * `@media print` rule in `globals.css`.
 */

import { Fragment } from 'react';

import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';
import type { ReceiptData } from '@/client/print/receipt';
import { positionOf } from '@/domain/udhaar/position';

export function ReceiptView({ receipt }: { receipt: ReceiptData }) {
  const refund = receipt.refund !== undefined;
  return (
    // Sized for a 203-dpi thermal head (print CSS: 72 mm, solid black). 13px
    // body with heavier weights: thin 11px strokes came out one dot wide. The
    // pilot judged sizes while Chrome printed this driver at ~75%; once printed
    // at true size (Scale 133, OPERATIONS.md) 14px read too large, so every
    // size but the shop name stepped down one.
    <div id="printable-receipt" className="font-sans text-[13px] leading-snug font-medium">
      <header className="text-center">
        {receipt.tenantHeaderLines.map((line, index) => (
          <p key={index} className={index === 0 ? 'text-[18px] font-bold' : 'text-[12px]'}>
            {line}
          </p>
        ))}
        <p className="text-[12px]">
          {receipt.dateTime.toLocaleDateString('en-PK')}{' '}
          {receipt.dateTime.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </header>

      <Rule />

      {receipt.refund ? (
        <p className="text-center font-bold">
          RETURN — against receipt {receipt.refund.againstReceiptNumber}
        </p>
      ) : null}
      {receipt.customerName ? <p>Customer: {receipt.customerName}</p> : null}

      {receipt.lines && receipt.lines.length > 0 ? (
        <>
          {/* One grid for every line, so the columns line up down the slip. */}
          <div className="grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-1">
            <span className="text-[12px] font-bold">QTY</span>
            <span className="text-[12px] font-bold">ITEM</span>
            <span className="text-right text-[12px] font-bold">AMT</span>
            {receipt.lines.map((line, index) => (
              <Fragment key={index}>
                <span className="numeral">{line.quantity}</span>
                <span className="font-bold break-words">{line.name}</span>
                <span className="numeral text-right font-semibold">
                  {formatPaisa(paisa(refund ? Math.abs(line.amountPaisa) : line.amountPaisa))}
                </span>
              </Fragment>
            ))}
          </div>

          <Rule />

          {receipt.subtotalPaisa !== undefined ? (
            <Row label="Subtotal" amountPaisa={receipt.subtotalPaisa} />
          ) : null}
          {receipt.discountPaisa ? (
            <Row label="Discount" amountPaisa={-receipt.discountPaisa} />
          ) : null}
          {receipt.totalPaisa !== undefined ? (
            refund ? (
              <Row label="Refund" amountPaisa={Math.abs(receipt.totalPaisa)} emphasis />
            ) : (
              <Row label="Amount Due" amountPaisa={receipt.totalPaisa} emphasis />
            )
          ) : null}

          {/* No change/remaining arithmetic on the printed slip — that
              calculator lives on the payment screen. The receipt states what
              was paid, full stop (Phase 10 §7's own body: "…payment =
              cash/tendered/change or udhaar split" is the SCREEN's job; this
              is the paper). */}
          {refund ? (
            <>
              {receipt.cashPaisa ? (
                <Row label="Cash refunded" amountPaisa={Math.abs(receipt.cashPaisa)} />
              ) : null}
              {receipt.creditPaisa ? (
                <Row label="Udhaar reduced" amountPaisa={Math.abs(receipt.creditPaisa)} />
              ) : null}
            </>
          ) : receipt.creditPaisa ? (
            <>
              {receipt.cashPaisa ? <Row label="Cash" amountPaisa={receipt.cashPaisa} /> : null}
              <Row label="Udhaar" amountPaisa={receipt.creditPaisa} />
            </>
          ) : receipt.tenderedPaisa !== undefined ? (
            <Row label="Paid" amountPaisa={receipt.tenderedPaisa} />
          ) : null}
        </>
      ) : null}

      {receipt.miniStatement ? (
        <>
          <Rule />
          {/* T4/T5 — the dispute-ender: previous balance → this transaction → new. */}
          <BalanceRow
            label="Previous balance"
            balancePaisa={receipt.miniStatement.previousBalancePaisa}
          />
          <Row
            label={
              refund
                ? 'Returned'
                : receipt.miniStatement.amountPaisa >= 0
                  ? 'Udhaar (this sale)'
                  : 'Paid'
            }
            amountPaisa={Math.abs(receipt.miniStatement.amountPaisa)}
          />
          <BalanceRow
            label="New balance"
            balancePaisa={receipt.miniStatement.newBalancePaisa}
            bold
          />
        </>
      ) : null}

      <Rule />

      <footer className="text-center text-[12px]">
        <p>
          Receipt {receipt.receiptNumber} · Served by {receipt.salesmanName}
        </p>
        <p className="mt-1">{receipt.tenantFooterLine}</p>
        <p className="mt-1 font-bold">MEHVAR</p>
      </footer>

      {receipt.calibration ? <Calibration /> : null}
    </div>
  );
}

/**
 * The test receipt's check that the page printed at true size. Measure the
 * 50 mm bar with a ruler: shorter means the browser or driver scaled the page
 * down. Both ends of the 72 mm bar should print: a missing end means the
 * printable width is narrower than 72 mm.
 */
function Calibration() {
  return (
    <section aria-label="Printer check" className="mt-2 text-[11px]">
      <div className="w-[50mm] border-t-[3px] border-solid" />
      <p>50 mm — measure this bar</p>
      {/* Edge to edge of the 72 mm page, outside the receipt's 1 mm padding. */}
      <div className="-mx-[1mm] mt-1 w-[72mm] border-x-[3px] border-t-[3px] border-solid pt-1" />
      <p>72 mm — both ends should print</p>
    </section>
  );
}

/**
 * A customer's balance in the position vocabulary (`domain/udhaar/position`):
 * what they owe, "Settled", or an advance — never a signed number. An
 * overpaid settlement or a return past zero used to print "New balance
 * -50.00" on the slip the customer takes home.
 */
function BalanceRow({
  label,
  balancePaisa,
  bold = false,
}: {
  label: string;
  balancePaisa: number;
  bold?: boolean;
}) {
  const position = positionOf(balancePaisa);
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="numeral">
        {position.kind === 'settled'
          ? 'Settled'
          : `${formatPaisa(paisa(position.amountPaisa))}${position.kind === 'in_credit' ? ' advance' : ''}`}
      </span>
    </div>
  );
}

function Rule() {
  return <hr className="my-1 border-t border-solid" />;
}

function Row({
  label,
  amountPaisa,
  bold = false,
  emphasis = false,
}: {
  label: string;
  amountPaisa: number;
  bold?: boolean;
  /**
   * The one figure the customer pays — the largest figure on the slip, by size
   * alone: extra-bold at 18px bled on the thermal head into something like spilled
   * ink, so it keeps the body's weight.
   */
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${emphasis ? 'mt-0.5 text-[16px]' : bold ? 'font-bold' : ''}`}
    >
      <span>{label}</span>
      <span className="numeral">{formatPaisa(paisa(amountPaisa))}</span>
    </div>
  );
}
