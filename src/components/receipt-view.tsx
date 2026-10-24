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
 * Kiosk silent printing (`--kiosk-printing`) is a Chrome launch flag configured
 * once at physical installation (Phase 12 §6); this component's job is only to
 * be the thing that prints correctly when `window.print()` is called — on a
 * kiosk-configured browser that means no dialog, and the fallback everywhere
 * else is the normal print dialog (ADR-6).
 *
 * Only this component's subtree is visible to the print engine; see the
 * `@media print` rule in `globals.css`.
 */

import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';
import type { ReceiptData } from '@/client/print/receipt';

export function ReceiptView({ receipt }: { receipt: ReceiptData }) {
  return (
    // Sized for a 203-dpi thermal head (print CSS: 72 mm, solid black). 13px
    // body with heavier weights: thin 11px strokes came out one dot wide,
    // which is what read as small and faint next to the driver's test page.
    <div id="printable-receipt" className="font-sans text-[13px] leading-snug font-medium">
      <header className="text-center">
        {receipt.tenantHeaderLines.map((line, index) => (
          <p key={index} className={index === 0 ? 'text-[16px] font-bold' : 'text-[12px]'}>
            {line}
          </p>
        ))}
      </header>

      <Rule />

      {receipt.customerName ? <p>Customer: {receipt.customerName}</p> : null}

      {receipt.lines && receipt.lines.length > 0 ? (
        <>
          {receipt.lines.map((line, index) => (
            <div key={index} className="pt-1">
              <p className="font-bold">{line.name}</p>
              <div className="flex justify-between">
                <span>{line.quantityLabel}</span>
                <span className="numeral font-semibold">
                  {formatPaisa(paisa(line.amountPaisa))}
                </span>
              </div>
            </div>
          ))}

          <Rule />

          {receipt.subtotalPaisa !== undefined ? (
            <Row label="Subtotal" amountPaisa={receipt.subtotalPaisa} />
          ) : null}
          {receipt.discountPaisa ? <Row label="Discount" amountPaisa={-receipt.discountPaisa} /> : null}
          {receipt.totalPaisa !== undefined ? (
            <Row label="Amount Due" amountPaisa={receipt.totalPaisa} emphasis />
          ) : null}

          {/* No change/remaining arithmetic on the printed slip — that
              calculator lives on the payment screen. The receipt states what
              was paid, full stop (Phase 10 §7's own body: "…payment =
              cash/tendered/change or udhaar split" is the SCREEN's job; this
              is the paper). */}
          {receipt.creditPaisa ? (
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
          <Row label="Previous balance" amountPaisa={receipt.miniStatement.previousBalancePaisa} />
          <Row
            label={receipt.miniStatement.amountPaisa >= 0 ? 'Udhaar (this sale)' : 'Paid'}
            amountPaisa={Math.abs(receipt.miniStatement.amountPaisa)}
          />
          <Row label="New balance" amountPaisa={receipt.miniStatement.newBalancePaisa} bold />
        </>
      ) : null}

      {receipt.pendingNote ? (
        <p className="mt-1 text-center text-[12px] italic">{receipt.pendingNote}</p>
      ) : null}

      <Rule />

      <footer className="text-center text-[12px]">
        <p>Receipt {receipt.receiptNumber}</p>
        <p>
          {receipt.dateTime.toLocaleDateString('en-PK')}{' '}
          {receipt.dateTime.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} ·{' '}
          {receipt.salesmanName}
        </p>
        <p className="mt-1">{receipt.tenantFooterLine}</p>
        <p className="mt-1 font-bold">Mehvar</p>
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
  /** The one figure the customer pays — the largest on the slip. */
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${emphasis ? 'mt-0.5 text-[18px] font-extrabold' : bold ? 'font-bold' : ''}`}
    >
      <span>{label}</span>
      <span className="numeral">{formatPaisa(paisa(amountPaisa))}</span>
    </div>
  );
}
