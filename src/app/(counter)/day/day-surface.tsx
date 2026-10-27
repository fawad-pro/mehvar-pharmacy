'use client';

/**
 * Day & Reports surface — W10.
 *
 * Row shapes below mirror `src/db/reporting-queries.ts`'s return types but are
 * declared fresh rather than imported: a client component must never import
 * from a module that reaches the database, even for a type (Day 5's rule) —
 * the import is erased at compile time, but nothing in the toolchain can
 * verify that by reading the file, so the rule is "don't name the module".
 */

import Link from 'next/link';
import { useState } from 'react';

import {
  CASH_REASONS,
  CASH_REASON_LABELS,
  directionFor,
  type CashDirection,
  type CashReason,
} from '@/domain/cash/cash-command';
import { paisaFromRupeeInput, parseRupeeInput } from '@/domain/sales/cart';
import { creditAgainstStockCost } from '@/domain/suppliers/supplier-return';
import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';
import { uuidv7 } from '@/lib/uuid';
import type { BusinessDay } from '@/lib/business-day';

import { CancelEntryButton } from '@/components/cancel-entry-button';

import { cancelCashMovementAction, recordCashMovementAction } from './actions';

interface ThreeNumbers {
  salesPaisa: number;
  salesReturnedPaisa: number;
  expectedCashPaisa: number;
  udhaarOwedPaisa: number;
  udhaarCreditPaisa: number;
  customersOwing: number;
  customersInCredit: number;
}

interface ReportFigures {
  costPaisa: number;
  marginPaisa: number;
  /** [PCN-012, D2] Written off or counted short in the range, at cost. */
  writtenOffPaisa: number;
  /** [PCN-014] Discounts given in the range. */
  itemDiscountPaisa: number;
  billDiscountPaisa: number;
  saleCount: number;
  unitsSold: number;
  returnCount: number;
}

interface OverrideRow {
  saleLineId: string;
  receiptNumber: string;
  productName: string;
  unitPricePaisa: number;
  lineDiscountPaisa: number;
  priceOverridden: boolean;
  byName: string;
  createdAt: Date;
}

/** [PCN-014] — redeclared here rather than imported (CLAUDE.md, Day 7). */
interface BillDiscountRow {
  saleId: string;
  receiptNumber: string;
  byName: string;
  approvedByName: string | null;
  billPaisa: number;
  discountPaisa: number;
  totalPaisa: number;
  unapprovedOverLimit: boolean;
  createdAt: Date;
}

interface ReturnExceptionRow {
  returnId: string;
  receiptNumber: string;
  saleReceiptNumber: string;
  cashOutPaisa: number;
  creditReducedPaisa: number;
  reasonNote: string | null;
  byName: string;
  createdAt: Date;
}

/** PCN-008 — redeclared here rather than imported (CLAUDE.md, Day 7). */
interface ExpiredSaleRow {
  allocationId: string;
  receiptNumber: string;
  productName: string;
  qtyBase: number;
  baseUnitName: string;
  expiryDate: string;
  byName: string;
  createdAt: Date;
}

interface QuickItemRow {
  productId: string;
  name: string;
  createdAt: Date;
}

interface AdjustmentExceptionRow {
  id: string;
  productName: string;
  qtyBaseDelta: number;
  /** [PCN-012] The magnitude as counted: "5 strip". */
  amount: string;
  reason: string;
  note: string | null;
  byName: string;
  createdAt: Date;
}

/** [PCN-009] — redeclared here rather than imported (CLAUDE.md, Day 7). */
interface PurchaseCorrectionExceptionRow {
  id: string;
  purchaseId: string;
  productName: string;
  qtyDeltaBase: number;
  bonusDeltaBase: number;
  costCorrected: boolean;
  invoiceDeltaPaisa: number;
  note: string;
  byName: string;
  createdAt: Date;
}

interface SupplierReturnExceptionRow {
  id: string;
  productName: string;
  supplierName: string;
  /** [PCN-012] As counted: "5 strip". */
  amount: string;
  creditPaisa: number;
  /** [PCN-012] What the return took out of its batch, at cost. */
  stockCostPaisa: number;
  byName: string;
  createdAt: Date;
}

interface CashMovementExceptionRow {
  id: string;
  direction: CashDirection;
  amountPaisa: number;
  reason: string;
  note: string | null;
  byName: string;
  createdAt: Date;
  /** [PCN-013] Set when this row cancels another. */
  reversesId: string | null;
  /** [PCN-013] Cancelled by a later row. */
  reversed: boolean;
}

/** [PCN-013] — redeclared here rather than imported (CLAUDE.md, Day 7). */
interface PaymentReversalExceptionRow {
  id: string;
  kind: 'udhaar' | 'supplier';
  name: string;
  amountPaisa: number;
  receiptNumber: string | null;
  byName: string;
  createdAt: Date;
}

interface LateSyncedRow {
  kind: 'sale' | 'payment';
  id: string;
  receiptNumber: string;
  clientCommittedAt: Date;
  createdAt: Date;
}

export function DaySurface({
  day,
  today,
  view,
  numbers,
  figures,
  overrides,
  billDiscounts,
  returns,
  expiredSold,
  quickItems,
  adjustments,
  corrections,
  supplierReturns,
  cashMovements,
  paymentReversals,
  lateSynced,
  hasOpeningFloat,
  supplierOwedPaisa,
  supplierCreditPaisa,
  suppliersInCredit,
}: {
  day: BusinessDay;
  today: BusinessDay;
  view: 'daily' | 'overall';
  numbers: ThreeNumbers;
  figures: ReportFigures;
  overrides: OverrideRow[];
  /** [PCN-014] Bills charged less than they came to. */
  billDiscounts: BillDiscountRow[];
  returns: ReturnExceptionRow[];
  /** PCN-008: sold from a batch already past its expiry date. */
  expiredSold: ExpiredSaleRow[];
  quickItems: QuickItemRow[];
  adjustments: AdjustmentExceptionRow[];
  /** [PCN-009] Corrections to received invoices. */
  corrections: PurchaseCorrectionExceptionRow[];
  /** [PCN-009] Goods sent back to suppliers. */
  supplierReturns: SupplierReturnExceptionRow[];
  cashMovements: CashMovementExceptionRow[];
  /** [PCN-013] Udhaar and supplier payments cancelled. */
  paymentReversals: PaymentReversalExceptionRow[];
  lateSynced: LateSyncedRow[];
  hasOpeningFloat: boolean;
  /** [PCN-007] What the pharmacy owes suppliers — a position, always all-time. */
  supplierOwedPaisa: number;
  /** [PCN-011] Credit suppliers hold for the pharmacy — reported apart, never netted. */
  supplierCreditPaisa: number;
  suppliersInCredit: number;
}) {
  const isToday = day === today;
  /** Counting and recording cash is something you do to *this* drawer, now. */
  const isDrawerDay = view === 'daily' && isToday;
  const needsOpeningFloat = isDrawerDay && !hasOpeningFloat;

  const exceptionCount =
    expiredSold.length +
    overrides.length +
    billDiscounts.length +
    returns.length +
    quickItems.length +
    adjustments.length +
    corrections.length +
    supplierReturns.length +
    cashMovements.length +
    paymentReversals.length +
    lateSynced.length;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-green-900 text-2xl font-semibold">Day & Reports</h1>
        <nav className="ml-auto flex gap-1" aria-label="Report range">
          <a
            href={`/day?day=${day}&view=daily`}
            aria-current={view === 'daily' ? 'page' : undefined}
            className={[
              'rounded px-3 py-1 text-sm',
              view === 'daily' ? 'bg-green-100 text-green-900 font-medium' : 'text-ink/60',
            ].join(' ')}
          >
            Daily
          </a>
          <a
            href={`/day?day=${day}&view=overall`}
            aria-current={view === 'overall' ? 'page' : undefined}
            className={[
              'rounded px-3 py-1 text-sm',
              view === 'overall' ? 'bg-green-100 text-green-900 font-medium' : 'text-ink/60',
            ].join(' ')}
          >
            Overall
          </a>
        </nav>
      </header>

      {view === 'daily' ? (
        <div className="flex items-center gap-3">
          <label className="text-ink/60 text-sm" htmlFor="day-picker">
            Business day
          </label>
          <input
            id="day-picker"
            type="date"
            defaultValue={day}
            max={today}
            onChange={(event) => {
              if (event.target.value) {
                window.location.href = `/day?day=${event.target.value}&view=daily`;
              }
            }}
            className="border-line focus:border-green-600 h-touch rounded border px-3 outline-none"
          />
        </div>
      ) : null}

      {/* The three numbers, and for ten seconds they are the whole screen.
          I6's huge-numerals treatment, the same promise the owner phone view
          (W11) makes.

          Nothing else competes at this size any more. There used to be four
          more cards immediately beneath — Revenue, Margin, Sale count, Units
          sold — and the first of them printed the same number as "Sales today"
          under a different name, because `revenuePaisa` and `salesPaisa` were
          the identical query. Seven figures, two of them the same figure, is
          not something anyone reads in ten seconds. The rest moved below the
          fold, where they read as detail rather than as competition.

          Each label still carries its own time scope, because they do not
          share one: sales and cash are the range's, the udhaar total is a
          position and is always all-time. */}
      <div
        className={`grid grid-cols-1 gap-3 ${isDrawerDay ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
      >
        <NumberCard
          label={
            view === 'overall' ? 'Sales, all time' : isToday ? 'Sales today' : 'Sales that day'
          }
          amountPaisa={numbers.salesPaisa}
          {...(numbers.salesReturnedPaisa > 0
            ? {
                note: `after ${formatPaisa(paisa(numbers.salesReturnedPaisa), { withSymbol: true })} returned`,
              }
            : {})}
        />
        {/* Only ever a daily figure. Summed over all time it is every rupee
            that has crossed the drawer since installation — a number with no
            meaning, printed where the owner expects one they can count. */}
        {view === 'daily' ? (
          <NumberCard
            label={isToday ? 'Cash expected in drawer' : 'Cash expected at close'}
            amountPaisa={numbers.expectedCashPaisa}
          />
        ) : null}
        {/* Never negative, and never netted against advances — an advance one
            customer has paid does not reduce what another customer owes. This
            card and the Customers screen now derive from the same
            `summariseBook`, so the same label cannot mean two things. */}
        <NumberCard
          label="Owed to you, all time"
          amountPaisa={numbers.udhaarOwedPaisa}
          amber
          note={udhaarNote(numbers)}
        />
      </div>

      {/* The second thing read, and the last thing that has to be read at all:
          is anything wrong?

          This replaces six competing <h3> group headings. The groups still
          exist below — T1 is not negotiable, every sensitive act stays visible
          — but they are now the ANSWER to a question the banner has already
          asked, rather than six lists the owner has to scan and total up
          themselves. */}
      <AttentionBanner
        count={exceptionCount}
        parts={[
          [expiredSold.length, 'expired sale'],
          [overrides.length + billDiscounts.length, 'discount'],
          [returns.length, 'return'],
          [quickItems.length, 'quick item'],
          [adjustments.length, 'adjustment'],
          [corrections.length, 'purchase correction'],
          [supplierReturns.length, 'return to supplier'],
          [cashMovements.length, 'cash movement'],
          [paymentReversals.length, 'cancelled payment'],
          [lateSynced.length, 'synced late'],
        ]}
      />

      {/* Everything below here is detail. An owner who wanted the ten-second
          read has already had it and stopped. */}

      <div className="text-ink/60 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span>
          Margin{' '}
          <span className="numeral text-green-900 font-medium">
            {formatPaisa(paisa(figures.marginPaisa), { withSymbol: true })}
          </span>
        </span>
        {/* [PCN-014] What discounts gave away in the range, said beside the
            margin they came out of. Only when there were any. */}
        {figures.itemDiscountPaisa + figures.billDiscountPaisa > 0 ? (
          <span>
            Discounts{' '}
            <span className="numeral text-amber font-medium">
              {formatPaisa(paisa(figures.itemDiscountPaisa + figures.billDiscountPaisa), {
                withSymbol: true,
              })}
            </span>
            <span className="text-ink/50 text-xs">
              {' '}
              ({formatPaisa(paisa(figures.itemDiscountPaisa))} on items,{' '}
              {formatPaisa(paisa(figures.billDiscountPaisa))} on bills)
            </span>
          </span>
        ) : null}
        {/* D2: stock that left without a sale is a loss at its cost, said
            beside the margin rather than hidden in it. Only when there is one. */}
        {figures.writtenOffPaisa > 0 ? (
          <span>
            Written off{' '}
            <span className="numeral text-amber font-medium">
              {formatPaisa(paisa(figures.writtenOffPaisa), { withSymbol: true })}
            </span>{' '}
            at cost
          </span>
        ) : null}
        {/* "How many sales" is exactly the moment an owner wants to see which
            ones — and this used to land on Returns, dropping someone reviewing
            the day into a refund workflow. It goes to Receipts now: a place to
            look, with no way to change anything from it. */}
        <Link href="/receipts" className="text-green-600 hover:underline">
          {figures.saleCount} sale{figures.saleCount === 1 ? '' : 's'} →
        </Link>
        <span>{figures.unitsSold.toLocaleString()} units sold</span>
        {/* [PCN-007] The payable position — the mirror of "Owed to you". Shown
            only when the shop is actually carrying supplier credit, so a
            cash-only pharmacy never reads a permanent "Rs 0.00" it learns to
            ignore. Paid down from the Purchases screen. */}
        {supplierOwedPaisa > 0 ? (
          <Link href="/purchases" className="hover:underline">
            Owed to suppliers{' '}
            <span className="numeral text-amber font-medium">
              {formatPaisa(paisa(supplierOwedPaisa), { withSymbol: true })}
            </span>
          </Link>
        ) : null}
        {/* [PCN-011] The other direction: money a supplier holds for the shop
            (an overpayment, or credit for goods sent back from a paid invoice).
            Hidden until PCN-011 — the owed figure floored it at zero — although
            it is as real as a customer's advance. Same rule as that note: shown
            only when there is something to show. */}
        {supplierCreditPaisa > 0 ? (
          <Link href="/purchases" className="hover:underline">
            <span className="numeral font-medium">
              {formatPaisa(paisa(supplierCreditPaisa), { withSymbol: true })}
            </span>{' '}
            credit with {suppliersInCredit} supplier{suppliersInCredit === 1 ? '' : 's'}
          </Link>
        ) : null}
      </div>

      {/* THE THINGS YOU CAN DO, below the things you can read.
          
          These two forms used to sit between the three numbers and the rest of
          the page, so the ten-second read was interrupted by a text input and a
          dropdown a third of the way down. Reading and acting are separated
          everywhere else in this product now; the Day screen is where the owner
          does both, which makes the order matter more here rather than less.

          Still only ever today's drawer. Rendered against a range figure, the
          count would invite an over/short entry off an all-time expected cash —
          an append-only row that cannot be edited and would poison every later
          cash figure. */}
      {isDrawerDay ? (
        <>
          <DrawerCount expectedCashPaisa={numbers.expectedCashPaisa} />
          <CashMovementForm needsOpeningFloat={needsOpeningFloat} />
        </>
      ) : null}

      <div>
        {exceptionCount > 0 ? (
          <div className="flex flex-col gap-4">
            {/* PCN-008. First, because it is the one that can reach a patient. */}
            <ExceptionGroup title="Expired stock sold" rows={expiredSold} empty={false}>
              {expiredSold.map((row) => (
                <Row key={row.allocationId}>
                  <span className="font-medium">{row.productName}</span>
                  <span className="numeral text-amber ml-2">
                    {row.qtyBase} {row.baseUnitName}
                  </span>
                  <span className="text-amber ml-2">expired {row.expiryDate}</span>
                  <span className="text-ink/60 ml-2">{row.receiptNumber}</span>
                  <span className="text-ink/40 ml-auto text-xs">{row.byName}</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup
              title="Discounts and overrides"
              rows={[...billDiscounts, ...overrides]}
              empty={false}
            >
              {/* [PCN-014] Whole bills first: the larger act, and the one an
                  owner's PIN may have approved. */}
              {billDiscounts.map((row) => (
                <Row key={row.saleId}>
                  <span className="font-medium">Bill discount</span>
                  <Link
                    href={`/receipts/${encodeURIComponent(row.receiptNumber)}`}
                    className="text-green-700 ml-2 hover:underline"
                  >
                    {row.receiptNumber}
                  </Link>
                  <span className="numeral text-ink/60 ml-2 text-xs">
                    {formatPaisa(paisa(row.billPaisa))} → {formatPaisa(paisa(row.totalPaisa))}
                  </span>
                  {row.approvedByName ? (
                    <span className="text-ink/50 ml-2 text-xs">
                      approved by {row.approvedByName}
                    </span>
                  ) : row.unapprovedOverLimit ? (
                    <span className="text-red ml-2 text-xs">over the limit, not approved</span>
                  ) : null}
                  <span className="numeral text-amber ml-auto">
                    -{formatPaisa(paisa(row.discountPaisa))}
                  </span>
                  <span className="text-ink/40 ml-2 text-xs">{row.byName}</span>
                </Row>
              ))}
              {overrides.map((row) => (
                <Row key={row.saleLineId}>
                  <span className="font-medium">{row.productName}</span>
                  <span className="text-ink/60 ml-2">{row.receiptNumber}</span>
                  {row.priceOverridden ? (
                    <span className="text-amber ml-2 text-xs">price changed</span>
                  ) : null}
                  {row.lineDiscountPaisa > 0 ? (
                    <span className="numeral text-amber ml-auto">
                      -{formatPaisa(paisa(row.lineDiscountPaisa))}
                    </span>
                  ) : null}
                  <span
                    className={`text-ink/40 text-xs ${row.lineDiscountPaisa > 0 ? 'ml-2' : 'ml-auto'}`}
                  >
                    {row.byName}
                  </span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Returns" rows={returns} empty={false}>
              {returns.map((row) => (
                <Row key={row.returnId}>
                  <span className="font-medium">{row.receiptNumber}</span>
                  <span className="text-ink/60 ml-2">for {row.saleReceiptNumber}</span>
                  <span className="numeral text-amber ml-auto">
                    -{formatPaisa(paisa(row.cashOutPaisa + row.creditReducedPaisa))}
                  </span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Quick items" rows={quickItems} empty={false}>
              {quickItems.map((row) => (
                <Row key={row.productId}>
                  <span className="font-medium">{row.name}</span>
                  <span className="text-ink/50 ml-auto text-xs">needs completing</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Purchase corrections" rows={corrections} empty={false}>
              {corrections.map((row) => (
                <Row key={row.id}>
                  <Link
                    href={`/purchases/${row.purchaseId}`}
                    className="font-medium hover:underline"
                  >
                    {row.productName}
                  </Link>
                  <span className="text-ink/60 ml-2">
                    {[
                      row.qtyDeltaBase !== 0
                        ? `qty ${row.qtyDeltaBase > 0 ? '+' : ''}${row.qtyDeltaBase}`
                        : null,
                      row.bonusDeltaBase !== 0
                        ? `bonus ${row.bonusDeltaBase > 0 ? '+' : ''}${row.bonusDeltaBase}`
                        : null,
                      row.costCorrected ? 'cost corrected' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="text-ink/50 ml-2 truncate">{row.note}</span>
                  <span className="text-ink/40 ml-auto text-xs">{row.byName}</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Returns to suppliers" rows={supplierReturns} empty={false}>
              {supplierReturns.map((row) => (
                <Row key={row.id}>
                  <span className="font-medium">{row.productName}</span>
                  <span className="numeral text-amber ml-2">−{row.amount}</span>
                  <span className="text-ink/60 ml-2">to {row.supplierName}</span>
                  <span className="numeral ml-2">credit {formatPaisa(paisa(row.creditPaisa))}</span>
                  <span className="numeral text-ink/60 ml-2">
                    stock cost {formatPaisa(paisa(row.stockCostPaisa))}
                    {creditAgainstStockCost(row.creditPaisa, row.stockCostPaisa)
                      ? ` (${creditAgainstStockCost(row.creditPaisa, row.stockCostPaisa)})`
                      : ''}
                  </span>
                  <span className="text-ink/40 ml-auto text-xs">{row.byName}</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Adjustments" rows={adjustments} empty={false}>
              {adjustments.map((row) => (
                <Row key={row.id}>
                  <span className="font-medium">{row.productName}</span>
                  <span
                    className={`numeral ml-2 ${row.qtyBaseDelta < 0 ? 'text-amber' : 'text-green-900'}`}
                  >
                    {row.qtyBaseDelta > 0 ? '+' : '−'}
                    {row.amount}
                  </span>
                  <span className="text-ink/60 ml-2">{row.reason.replaceAll('_', ' ')}</span>
                  <span className="text-ink/40 ml-auto text-xs">{row.byName}</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Cash movements" rows={cashMovements} empty={false}>
              {cashMovements.map((row) => (
                <Row key={row.id}>
                  <span className="font-medium">
                    {row.reversesId ? 'Cancelled: ' : ''}
                    {CASH_REASON_LABELS[row.reason as CashReason]}
                  </span>
                  <span
                    className={`numeral ml-2 ${row.direction === 'out' ? 'text-amber' : 'text-green-900'}`}
                  >
                    {row.direction === 'in' ? '+' : '-'}
                    {formatPaisa(paisa(row.amountPaisa))}
                  </span>
                  {row.note ? <span className="text-ink/50 ml-2 text-xs">“{row.note}”</span> : null}
                  {/* [PCN-013] Typed wrong: cancel it with the opposite entry.
                      Both stay listed, so the owner sees what was fixed. */}
                  {row.reversed ? (
                    <span className="text-ink/50 ml-2 text-xs">— cancelled</span>
                  ) : row.reversesId === null ? (
                    <span className="ml-2">
                      <CancelEntryButton
                        what={`this ${formatPaisa(paisa(row.amountPaisa), { withSymbol: true })} ${CASH_REASON_LABELS[row.reason as CashReason].toLowerCase()}`}
                        run={() => cancelCashMovementAction(row.id)}
                      />
                    </span>
                  ) : null}
                  <span className="text-ink/40 ml-auto text-xs">{row.byName}</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Cancelled payments" rows={paymentReversals} empty={false}>
              {paymentReversals.map((row) => (
                <Row key={row.id}>
                  <span className="font-medium">
                    {row.kind === 'udhaar' ? 'Udhaar payment' : 'Supplier payment'} cancelled
                  </span>
                  <span className="text-ink/70 ml-2">{row.name}</span>
                  <span className="numeral text-amber ml-2">
                    {formatPaisa(paisa(row.amountPaisa))}
                  </span>
                  {row.receiptNumber ? (
                    <span className="text-ink/50 ml-2 text-xs">receipt {row.receiptNumber}</span>
                  ) : null}
                  <span className="text-ink/40 ml-auto text-xs">{row.byName}</span>
                </Row>
              ))}
            </ExceptionGroup>

            <ExceptionGroup title="Synced late" rows={lateSynced} empty={false}>
              {lateSynced.map((row) => (
                <Row key={row.id}>
                  <span className="font-medium">{row.receiptNumber}</span>
                  <span className="text-ink/60 ml-2">{row.kind}</span>
                  <span className="text-ink/40 ml-auto text-xs">
                    recorded {row.clientCommittedAt.toLocaleTimeString('en-PK')}, synced{' '}
                    {row.createdAt.toLocaleTimeString('en-PK')}
                  </span>
                </Row>
              ))}
            </ExceptionGroup>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One line answering "is anything wrong?", in place of six headings.
 *
 * The empty state is deliberately a positive statement rather than an absence.
 * "Nothing exceptional today." reads as a missing section; "Nothing needs a
 * look" reads as an answer, and an owner who sees it can stop — which is the
 * entire point of a ten-second screen.
 *
 * The kinds are named inline because a bare count ("6 exceptions") tells the
 * owner they must scroll to find out whether it matters. Six routine cash
 * movements and one price override are very different days.
 */
function AttentionBanner({
  count,
  parts,
}: {
  count: number;
  parts: ReadonlyArray<readonly [number, string]>;
}) {
  if (count === 0) {
    return (
      <p className="border-line text-green-900 rounded border bg-green-100/50 px-4 py-3 text-sm font-medium">
        Nothing needs a look today.
      </p>
    );
  }

  const named = parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`)
    .join(' · ');

  return (
    <div className="border-amber/40 bg-amber/5 rounded border px-4 py-3">
      <p className="text-amber text-sm font-medium">
        {count} thing{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} a look
      </p>
      <p className="text-ink/60 mt-0.5 text-sm">{named}</p>
    </div>
  );
}

function ExceptionGroup<T>({
  title,
  rows,
  children,
}: {
  title: string;
  rows: T[];
  empty: boolean;
  children: React.ReactNode;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div>
      <h3 className="text-ink/70 mb-1 text-sm font-medium">
        {title} <span className="text-ink/40">({rows.length})</span>
      </h3>
      <ul className="border-line divide-line divide-y rounded border text-sm">{children}</ul>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex flex-wrap items-baseline gap-1 px-3 py-2">{children}</li>;
}

/**
 * The one line under "Owed to you".
 *
 * Advances appear here rather than as a fourth card. They are real money the
 * shop is holding, so they must be visible — but they are rare, and a card that
 * reads "Rs 0.00" on almost every day of the year trains the owner to stop
 * reading the row it sits in. Mentioned only when there is something to
 * mention.
 */
function udhaarNote(numbers: ThreeNumbers): string {
  const owing =
    numbers.customersOwing > 0
      ? `${numbers.customersOwing} customer${numbers.customersOwing === 1 ? '' : 's'}`
      : 'Nobody owes you';

  if (numbers.udhaarCreditPaisa === 0) {
    return owing;
  }
  return `${owing} · ${formatPaisa(paisa(numbers.udhaarCreditPaisa), { withSymbol: true })} paid in advance`;
}

function NumberCard({
  label,
  amountPaisa,
  amber = false,
  note,
}: {
  label: string;
  amountPaisa: number;
  amber?: boolean;
  /** One line under the number, for the context that stops it being ambiguous. */
  note?: string;
}) {
  return (
    <div className="border-line rounded border p-4">
      <p className="text-ink/60 text-xs tracking-[0.1em] uppercase">{label}</p>
      <p
        className={`numeral mt-1 text-3xl font-semibold ${amber ? 'text-amber' : 'text-green-900'}`}
      >
        {formatPaisa(paisa(amountPaisa), { withSymbol: true })}
      </p>
      {note ? <p className="text-ink/50 mt-1 text-xs">{note}</p> : null}
    </div>
  );
}

/** W10's ritual: count the drawer, record what it says against the expected figure. */
function DrawerCount({ expectedCashPaisa }: { expectedCashPaisa: number }) {
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // A count that is not an amount is said, never read as Rs 0 — that would
  // record the whole drawer as short.
  const countedParsed = parseRupeeInput(counted);
  const unreadable = counted.trim() !== '' && countedParsed === null;
  const countedPaisa = countedParsed ?? 0;
  const differencePaisa = countedPaisa - expectedCashPaisa;

  async function record(): Promise<void> {
    if (countedParsed === null || differencePaisa === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);

    const outcome = await recordCashMovementAction({
      movementId: uuidv7(),
      direction: differencePaisa > 0 ? 'in' : 'out',
      amountPaisa: Math.abs(differencePaisa),
      reason: 'over_short',
      note: `Counted ${formatPaisa(paisa(countedPaisa))} against an expected ${formatPaisa(paisa(expectedCashPaisa))}`,
    });

    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setDone('Recorded. Nothing is locked — the day stays open.');
    setCounted('');
  }

  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Count the drawer</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="drawer-counted">
            What&rsquo;s actually in the drawer
          </label>
          <input
            autoComplete="off"
            id="drawer-counted"
            value={counted}
            inputMode="decimal"
            onChange={(event) => {
              setCounted(event.target.value);
              setDone(null);
            }}
            className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
          />
        </div>
        {unreadable ? (
          <p className="text-red text-sm" role="alert">
            Not an amount — type the cash you counted.
          </p>
        ) : counted !== '' ? (
          <p className={`text-sm ${differencePaisa === 0 ? 'text-green-900' : 'text-amber'}`}>
            {differencePaisa === 0
              ? 'Matches exactly.'
              : `${differencePaisa > 0 ? 'Over' : 'Short'} by ${formatPaisa(paisa(Math.abs(differencePaisa)))}`}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void record()}
          disabled={busy || countedParsed === null || differencePaisa === 0}
          className="bg-green-600 text-paper min-h-touch ml-auto rounded px-5 font-medium disabled:opacity-40"
        >
          {busy ? 'Recording…' : 'Record over/short'}
        </button>
      </div>
      {error ? (
        <p className="text-red mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-green-900 mt-2 text-sm" role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Opening float, a withdrawal, or an expense — the other three cash reasons.
 *
 * `needsOpeningFloat` is the one nudge here: expected-cash-in-drawer is only
 * right if the day's float was recorded, and nothing else in the product would
 * ever ask. A wrong number the owner cannot explain is the fastest way to lose
 * their trust in every other number.
 */
function CashMovementForm({ needsOpeningFloat }: { needsOpeningFloat: boolean }) {
  const [reason, setReason] = useState<CashReason>('opening_float');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const otherReasons = CASH_REASONS.filter((candidate) => candidate !== 'over_short');
  const direction = directionFor(reason);

  async function record(): Promise<void> {
    const amountPaisa = paisaFromRupeeInput(amount);
    if (amountPaisa <= 0 || busy || direction === null) {
      return;
    }
    setBusy(true);
    setError(null);

    const outcome = await recordCashMovementAction({
      movementId: uuidv7(),
      direction,
      amountPaisa,
      reason,
      note: note.trim() === '' ? null : note.trim(),
    });

    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setDone('Saved.');
    setAmount('');
    setNote('');
  }

  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Record a cash movement</h2>
      {needsOpeningFloat ? (
        <p className="text-amber mb-3 text-sm">
          No opening float recorded today — the expected cash figure above assumes the drawer
          started empty.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="movement-reason">
            Reason
          </label>
          <select
            id="movement-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as CashReason);
              setDone(null);
            }}
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          >
            {otherReasons.map((candidate) => (
              <option key={candidate} value={candidate}>
                {CASH_REASON_LABELS[candidate]}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="movement-amount">
            Amount
          </label>
          <input
            autoComplete="off"
            id="movement-amount"
            value={amount}
            inputMode="decimal"
            onChange={(event) => {
              setAmount(event.target.value);
              setDone(null);
            }}
            className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
          />
        </div>
        <div className="min-w-48 flex-1">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="movement-note">
            Note (optional)
          </label>
          <input
            autoComplete="off"
            id="movement-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void record()}
          disabled={busy || paisaFromRupeeInput(amount) <= 0}
          className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? (
        <p className="text-red mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-green-900 mt-2 text-sm" role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}
