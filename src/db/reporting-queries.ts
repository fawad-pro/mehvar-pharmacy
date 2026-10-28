/**
 * The daily summary — Phase 9 §7's derived view, computed on read (ADR-8):
 * W10's three numbers, its exception list, and the daily/overall report
 * figures Phase 13 names for Day 7.
 *
 * Weekly and monthly report tabs are Phase 13 §3's first cut-order item — not
 * built here; see CHANGELOG for the note. Daily and overall (all-time) cover
 * the done-when ("the owner's three questions answer in one glance") without
 * them.
 *
 * Inside `src/db` because ADR-2 puts every query here.
 */

import 'server-only';

import { desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, sql, sum } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { billDiscountNeedsApproval } from '@/domain/sales/cart';
import { summariseBook } from '@/domain/udhaar/position';
import { paisa } from '@/lib/branded';
import { DEFAULT_TIME_ZONE } from '@/lib/business-day';
import type { PackLevel } from '@/lib/quantity';

import { batchCostLedger } from './batch-cost-queries';
import type { TenantScope } from './scoped';
import {
  adjustments,
  batches,
  cashMovements,
  customers,
  payments,
  products,
  purchaseCorrections,
  purchaseLines,
  saleLineAllocations,
  saleLines,
  saleReturns,
  sales,
  supplierPayments,
  supplierReturns,
  suppliers,
  users,
} from './schema';

/* ========================================================================== */
/* The three numbers — W10, W11                                               */
/* ========================================================================== */

export interface ThreeNumbers {
  /**
   * Sold, minus what came back — NET, and the only "sales" figure in the
   * product.
   *
   * It used to be gross, while `reportFigures.revenuePaisa` was the identical
   * gross query under a second name; the Day screen printed both, as "Sales
   * today" and "Revenue", showing one number twice and inviting the owner to
   * hunt for a difference that did not exist. Both are now net and there is
   * one of them.
   *
   * Net because the question is the day's health. Selling Rs 10,000 and
   * refunding Rs 4,000 is not a Rs 10,000 day, and a figure that says so is
   * one the owner has to mentally correct before it means anything.
   */
  readonly salesPaisa: number;
  /** What was refunded in the range, so the label above can explain itself. */
  readonly salesReturnedPaisa: number;
  readonly expectedCashPaisa: number;
  /**
   * Money out on the street: Σ of the balances that are OWED, floored per
   * customer at zero. Never negative.
   *
   * This used to be a single netted subtraction across the whole book, which
   * disagreed with the customers list — that screen has always floored each
   * balance before summing, on the grounds that "a customer in credit does not
   * offset someone else's debt, and netting them would understate the book".
   * Both screens now use `summariseBook`, so one label cannot mean two things.
   */
  readonly udhaarOwedPaisa: number;
  /** Advances customers have paid ahead. Reported beside the debt, never against it. */
  readonly udhaarCreditPaisa: number;
  readonly customersOwing: number;
  readonly customersInCredit: number;
}

/**
 * `expectedCashPaisa` is the physical-drawer figure: cash actually taken in
 * (sale cash portions, cash settlements), less cash paid back out (return
 * cash-outs), plus every cash movement (opening float, withdrawals, expenses,
 * the previous count's over/short) — everything credit touches is excluded,
 * because credit never crossed the drawer.
 */
export async function threeNumbers(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<ThreeNumbers> {
  const [salesRow] = await scope.db
    .select({ total: sum(sales.totalPaisa).as('total'), cash: sum(sales.cashPaisa).as('cash') })
    .from(sales)
    .where(scope.scopeOf(sales, gte(sales.createdAt, from), lt(sales.createdAt, to)));

  const [paymentsRow] = await scope.db
    .select({ total: sum(payments.amountPaisa).as('total') })
    .from(payments)
    .where(scope.scopeOf(payments, gte(payments.createdAt, from), lt(payments.createdAt, to)));

  const [returnsRow] = await scope.db
    .select({
      cashOut: sum(saleReturns.cashOutPaisa).as('cashOut'),
      refunded: sql<string>`sum(${saleReturns.cashOutPaisa} + ${saleReturns.creditReducedPaisa})`,
    })
    .from(saleReturns)
    .where(
      scope.scopeOf(saleReturns, gte(saleReturns.createdAt, from), lt(saleReturns.createdAt, to)),
    );

  const [movementsIn] = await scope.db
    .select({ total: sum(cashMovements.amountPaisa).as('total') })
    .from(cashMovements)
    .where(
      scope.scopeOf(
        cashMovements,
        eq(cashMovements.direction, 'in'),
        gte(cashMovements.createdAt, from),
        lt(cashMovements.createdAt, to),
      ),
    );

  const [movementsOut] = await scope.db
    .select({ total: sum(cashMovements.amountPaisa).as('total') })
    .from(cashMovements)
    .where(
      scope.scopeOf(
        cashMovements,
        eq(cashMovements.direction, 'out'),
        gte(cashMovements.createdAt, from),
        lt(cashMovements.createdAt, to),
      ),
    );

  /*
   * The udhaar position, PER CUSTOMER before it is summed.
   *
   * Grouping is the whole point. Summing the three terms globally and
   * subtracting produces a net figure across the entire book, and one customer
   * holding an advance then cancels another customer's debt — which is how the
   * day summary came to report "-Rs 100 owed to you" while the customers list,
   * which has always floored per customer, reported money outstanding.
   *
   * Always all-time, whatever the range: a debt is a position, not an event in
   * a window. The Day surface labels it accordingly.
   */
  const [extendedRows, paidRows, reversedRows] = await Promise.all([
    scope.db
      .select({ customerId: sales.customerId, total: sum(sales.creditPaisa).as('total') })
      .from(sales)
      .where(scope.scopeOf(sales, isNotNull(sales.customerId)))
      .groupBy(sales.customerId),
    scope.db
      .select({ customerId: payments.customerId, total: sum(payments.amountPaisa).as('total') })
      .from(payments)
      .where(scope.scopeOf(payments, isNotNull(payments.customerId)))
      .groupBy(payments.customerId),
    scope.db
      .select({
        customerId: sales.customerId,
        total: sum(saleReturns.creditReducedPaisa).as('total'),
      })
      .from(saleReturns)
      .innerJoin(sales, eq(saleReturns.saleId, sales.id))
      .where(scope.scopeOf(saleReturns, isNotNull(sales.customerId)))
      .groupBy(sales.customerId),
  ]);

  const balances = new Map<string, number>();
  const apply = (customerId: string | null, delta: number): void => {
    if (customerId === null) return;
    balances.set(customerId, (balances.get(customerId) ?? 0) + delta);
  };
  for (const row of extendedRows) apply(row.customerId, Number(row.total ?? 0));
  for (const row of paidRows) apply(row.customerId, -Number(row.total ?? 0));
  for (const row of reversedRows) apply(row.customerId, -Number(row.total ?? 0));

  const book = summariseBook(balances.values());

  const expectedCashPaisa =
    Number(salesRow?.cash ?? 0) +
    Number(paymentsRow?.total ?? 0) -
    Number(returnsRow?.cashOut ?? 0) +
    Number(movementsIn?.total ?? 0) -
    Number(movementsOut?.total ?? 0);

  const salesReturnedPaisa = Number(returnsRow?.refunded ?? 0);

  return {
    salesPaisa: Number(salesRow?.total ?? 0) - salesReturnedPaisa,
    salesReturnedPaisa,
    expectedCashPaisa,
    udhaarOwedPaisa: book.owedPaisa,
    udhaarCreditPaisa: book.creditPaisa,
    customersOwing: book.customersOwing,
    customersInCredit: book.customersInCredit,
  };
}

/* ========================================================================== */
/* The exception list — Phase 9 §7                                            */
/* ========================================================================== */

export interface OverrideRow {
  readonly saleLineId: string;
  readonly saleId: string;
  readonly receiptNumber: string;
  readonly productName: string;
  readonly unitPricePaisa: number;
  readonly lineDiscountPaisa: number;
  readonly priceOverridden: boolean;
  /** [PCN-014] Who sold it — T1: attributed, not just visible. */
  readonly byName: string;
  readonly createdAt: Date;
}

/** Discounted and price-overridden lines — T1's "sensitive acts are visible". */
export async function overridesAndDiscountsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<OverrideRow[]> {
  return scope.db
    .select({
      saleLineId: saleLines.id,
      saleId: saleLines.saleId,
      receiptNumber: sales.receiptNumber,
      productName: products.name,
      unitPricePaisa: saleLines.unitPricePaisa,
      lineDiscountPaisa: saleLines.lineDiscountPaisa,
      priceOverridden: saleLines.priceOverridden,
      byName: users.name,
      createdAt: saleLines.createdAt,
    })
    .from(saleLines)
    .innerJoin(sales, eq(saleLines.saleId, sales.id))
    .innerJoin(products, eq(saleLines.productId, products.id))
    .innerJoin(users, eq(sales.createdBy, users.id))
    .where(
      scope.scopeOf(
        saleLines,
        gte(saleLines.createdAt, from),
        lt(saleLines.createdAt, to),
        sql`(${saleLines.priceOverridden} OR ${saleLines.lineDiscountPaisa} > 0)`,
      ),
    )
    .orderBy(desc(saleLines.createdAt));
}

/**
 * [PCN-014] Bills charged less than they came to — T1: a discount on a whole
 * bill is the largest discount the counter can give, and the owner sees every
 * one, who gave it, who approved it, and the bill before and after.
 *
 * `unapprovedOverLimit` is measured against the limit set now (the limit a
 * sale was given under is not stored): a bill discount over it with no owner
 * approval is the case the counter is meant to make impossible, so it can
 * only mean the limit was raised since, or a record arrived without one.
 */
export interface BillDiscountRow {
  readonly saleId: string;
  readonly receiptNumber: string;
  readonly byName: string;
  readonly approvedByName: string | null;
  /** The bill after item discounts — what the bill discount came off. */
  readonly billPaisa: number;
  readonly discountPaisa: number;
  readonly totalPaisa: number;
  readonly unapprovedOverLimit: boolean;
  readonly createdAt: Date;
}

export async function billDiscountsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
  capPercent: number,
): Promise<BillDiscountRow[]> {
  const approver = alias(users, 'approver');
  const rows = await scope.db
    .select({
      saleId: sales.id,
      receiptNumber: sales.receiptNumber,
      byName: users.name,
      approvedByName: approver.name,
      billPaisa: sales.subtotalPaisa,
      discountPaisa: sales.invoiceDiscountPaisa,
      totalPaisa: sales.totalPaisa,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .innerJoin(users, eq(sales.createdBy, users.id))
    .leftJoin(approver, eq(sales.invoiceDiscountApprovedBy, approver.id))
    .where(
      scope.scopeOf(
        sales,
        gt(sales.invoiceDiscountPaisa, 0),
        gte(sales.createdAt, from),
        lt(sales.createdAt, to),
      ),
    )
    .orderBy(desc(sales.createdAt));
  if (rows.length === 0) return [];

  // Each bill's figure before any discount, and its item discounts: one
  // grouped aggregate over the lines (never a correlated subquery, Day 3).
  const lineTotals = await scope.db
    .select({
      saleId: saleLines.saleId,
      gross: sql<string>`sum(coalesce(${saleLines.lineAmountPaisa}, ${saleLines.unitPricePaisa} * ${saleLines.qtyBase}))`,
      itemDiscount: sum(saleLines.lineDiscountPaisa).as('itemDiscount'),
    })
    .from(saleLines)
    .where(
      scope.scopeOf(
        saleLines,
        inArray(
          saleLines.saleId,
          rows.map((row) => row.saleId),
        ),
      ),
    )
    .groupBy(saleLines.saleId);
  const bySale = new Map(lineTotals.map((row) => [row.saleId, row]));

  return rows.map((row) => {
    const lines = bySale.get(row.saleId);
    const needed = billDiscountNeedsApproval({
      grossPaisa: paisa(Number(lines?.gross ?? 0)),
      itemDiscountPaisa: paisa(Number(lines?.itemDiscount ?? 0)),
      billDiscountPaisa: paisa(row.discountPaisa),
      capPercent,
    });
    return { ...row, unapprovedOverLimit: needed && row.approvedByName === null };
  });
}

export interface ReturnExceptionRow {
  readonly returnId: string;
  readonly receiptNumber: string;
  readonly saleReceiptNumber: string;
  readonly cashOutPaisa: number;
  readonly creditReducedPaisa: number;
  readonly reasonNote: string | null;
  readonly byName: string;
  readonly createdAt: Date;
}

export async function returnsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<ReturnExceptionRow[]> {
  return scope.db
    .select({
      returnId: saleReturns.id,
      receiptNumber: saleReturns.receiptNumber,
      saleReceiptNumber: sales.receiptNumber,
      cashOutPaisa: saleReturns.cashOutPaisa,
      creditReducedPaisa: saleReturns.creditReducedPaisa,
      reasonNote: saleReturns.reasonNote,
      byName: users.name,
      createdAt: saleReturns.createdAt,
    })
    .from(saleReturns)
    .innerJoin(sales, eq(saleReturns.saleId, sales.id))
    .innerJoin(users, eq(saleReturns.createdBy, users.id))
    .where(
      scope.scopeOf(saleReturns, gte(saleReturns.createdAt, from), lt(saleReturns.createdAt, to)),
    )
    .orderBy(desc(saleReturns.createdAt));
}

export interface ExpiredSaleRow {
  readonly allocationId: string;
  readonly receiptNumber: string;
  readonly productName: string;
  readonly qtyBase: number;
  readonly baseUnitName: string;
  readonly expiryDate: string;
  readonly byName: string;
  readonly createdAt: Date;
}

/**
 * PCN-008: stock sold from a batch that had already expired on the day of the
 * sale. Allocation consumes expired batches only when nothing unexpired is
 * left, so every row here is a sale the counter was warned about and made
 * anyway. Derived from the allocation the server actually made, which is why
 * an offline sale cannot dodge it.
 */
export async function expiredStockSoldInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<ExpiredSaleRow[]> {
  const rows = await scope.db
    .select({
      allocationId: saleLineAllocations.id,
      receiptNumber: sales.receiptNumber,
      productName: products.name,
      qtyBase: saleLineAllocations.qtyBase,
      baseUnitName: products.baseUnitName,
      expiryDate: batches.expiryDate,
      byName: users.name,
      createdAt: sales.createdAt,
    })
    .from(saleLineAllocations)
    .innerJoin(batches, eq(saleLineAllocations.batchId, batches.id))
    .innerJoin(saleLines, eq(saleLineAllocations.saleLineId, saleLines.id))
    .innerJoin(sales, eq(saleLines.saleId, sales.id))
    .innerJoin(products, eq(saleLines.productId, products.id))
    .innerJoin(users, eq(sales.createdBy, users.id))
    .where(
      scope.scopeOf(
        sales,
        gte(sales.createdAt, from),
        lt(sales.createdAt, to),
        sql`${batches.expiryDate} < (${sales.createdAt} AT TIME ZONE ${DEFAULT_TIME_ZONE})::date`,
      ),
    )
    .orderBy(desc(sales.createdAt));
  return rows.map((row) => ({ ...row, expiryDate: row.expiryDate ?? '' }));
}

export interface PurchaseCorrectionExceptionRow {
  readonly id: string;
  readonly purchaseId: string;
  readonly productName: string;
  readonly qtyDeltaBase: number;
  readonly bonusDeltaBase: number;
  readonly costCorrected: boolean;
  readonly invoiceDeltaPaisa: number;
  readonly note: string;
  readonly byName: string;
  readonly createdAt: Date;
}

/** [PCN-009] Corrections to received invoices — every one, attributed (T1). */
export async function purchaseCorrectionsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<PurchaseCorrectionExceptionRow[]> {
  const rows = await scope.db
    .select({
      id: purchaseCorrections.id,
      purchaseId: purchaseLines.purchaseId,
      productName: products.name,
      qtyDeltaBase: purchaseCorrections.qtyDeltaBase,
      bonusDeltaBase: purchaseCorrections.bonusDeltaBase,
      correctedUnitCostPaisa: purchaseCorrections.correctedUnitCostPaisa,
      correctedUnitCostPaisaEntered: purchaseCorrections.correctedUnitCostPaisaEntered,
      invoiceDeltaPaisa: purchaseCorrections.invoiceDeltaPaisa,
      note: purchaseCorrections.note,
      byName: users.name,
      createdAt: purchaseCorrections.createdAt,
    })
    .from(purchaseCorrections)
    .innerJoin(purchaseLines, eq(purchaseLines.id, purchaseCorrections.purchaseLineId))
    .innerJoin(products, eq(products.id, purchaseLines.productId))
    .innerJoin(users, eq(users.id, purchaseCorrections.createdBy))
    .where(
      scope.scopeOf(
        purchaseCorrections,
        gte(purchaseCorrections.createdAt, from),
        lt(purchaseCorrections.createdAt, to),
      ),
    )
    .orderBy(desc(purchaseCorrections.createdAt));
  return rows.map(({ correctedUnitCostPaisa, correctedUnitCostPaisaEntered, ...row }) => ({
    ...row,
    // Either column: per base unit on an older line, per pack since PCN-012.
    costCorrected: correctedUnitCostPaisa !== null || correctedUnitCostPaisaEntered !== null,
  }));
}

export interface SupplierReturnExceptionRow {
  readonly id: string;
  readonly productName: string;
  readonly supplierName: string;
  readonly qtyBase: number;
  readonly baseUnitName: string;
  readonly packLevels: PackLevel[];
  readonly unitName: string | null;
  readonly unitCount: number | null;
  readonly creditPaisa: number;
  readonly byName: string;
  readonly createdAt: Date;
}

/** [PCN-009] Goods sent back to suppliers, with the credit given (T1). */
export async function supplierReturnsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<SupplierReturnExceptionRow[]> {
  return scope.db
    .select({
      id: supplierReturns.id,
      productName: products.name,
      supplierName: suppliers.name,
      qtyBase: supplierReturns.qtyBase,
      baseUnitName: products.baseUnitName,
      packLevels: products.packLevels,
      unitName: supplierReturns.unitName,
      unitCount: supplierReturns.unitCount,
      creditPaisa: supplierReturns.creditPaisa,
      byName: users.name,
      createdAt: supplierReturns.createdAt,
    })
    .from(supplierReturns)
    .innerJoin(products, eq(products.id, supplierReturns.productId))
    .innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId))
    .innerJoin(users, eq(users.id, supplierReturns.createdBy))
    .where(
      scope.scopeOf(
        supplierReturns,
        gte(supplierReturns.createdAt, from),
        lt(supplierReturns.createdAt, to),
      ),
    )
    .orderBy(desc(supplierReturns.createdAt));
}

export interface QuickItemRow {
  readonly productId: string;
  readonly name: string;
  readonly createdAt: Date;
}

/** W6 quick items created in the window — D3's guardrail starts here. */
export async function quickItemsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<QuickItemRow[]> {
  return scope.db
    .select({ productId: products.id, name: products.name, createdAt: products.createdAt })
    .from(products)
    .where(
      scope.scopeOf(
        products,
        eq(products.needsCompletion, true),
        gte(products.createdAt, from),
        lt(products.createdAt, to),
      ),
    )
    .orderBy(desc(products.createdAt));
}

export interface AdjustmentExceptionRow {
  readonly id: string;
  readonly productName: string;
  readonly qtyBaseDelta: number;
  readonly baseUnitName: string;
  readonly packLevels: PackLevel[];
  readonly unitName: string | null;
  readonly unitCount: number | null;
  readonly reason: string;
  readonly note: string | null;
  readonly byName: string;
  readonly createdAt: Date;
}

/**
 * Adjustments worth the owner's attention — which is not all of them.
 *
 * `opening_stock` is excluded: it is the setup ritual (W9), not an exception.
 * Onboarding a real pharmacy writes one such row per shelf line, so including
 * them buries the two or three rows that genuinely mean something — a damage
 * write-off, a count correction — under hundreds that mean "we installed the
 * software". An exception list the owner learns to scroll past has stopped
 * being an exception list (I7's discipline, applied to the list rather than
 * the colour).
 */
export async function adjustmentsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<AdjustmentExceptionRow[]> {
  return scope.db
    .select({
      id: adjustments.id,
      productName: products.name,
      qtyBaseDelta: adjustments.qtyBaseDelta,
      baseUnitName: products.baseUnitName,
      packLevels: products.packLevels,
      unitName: adjustments.unitName,
      unitCount: adjustments.unitCount,
      reason: adjustments.reason,
      note: adjustments.note,
      byName: users.name,
      createdAt: adjustments.createdAt,
    })
    .from(adjustments)
    .innerJoin(products, eq(adjustments.productId, products.id))
    .innerJoin(users, eq(adjustments.createdBy, users.id))
    .where(
      scope.scopeOf(
        adjustments,
        gte(adjustments.createdAt, from),
        lt(adjustments.createdAt, to),
        ne(adjustments.reason, 'opening_stock'),
      ),
    )
    .orderBy(desc(adjustments.createdAt));
}

/**
 * Whether today's opening float has been recorded — the assumption behind
 * every expected-cash figure, and the one input nothing else would ask for.
 */
export async function hasOpeningFloat(scope: TenantScope, from: Date, to: Date): Promise<boolean> {
  // [PCN-013] A float that was cancelled was never put in the drawer, and its
  // cancellation is itself an `opening_float` row, so a count would say yes
  // twice over. The floats, then which of them were cancelled: two plain
  // queries, never a correlated subquery (CLAUDE.md, Day 3).
  const floats = await scope.db
    .select({ id: cashMovements.id })
    .from(cashMovements)
    .where(
      scope.scopeOf(
        cashMovements,
        eq(cashMovements.reason, 'opening_float'),
        isNull(cashMovements.reversesId),
        gte(cashMovements.createdAt, from),
        lt(cashMovements.createdAt, to),
      ),
    );
  if (floats.length === 0) return false;
  const cancelled = await reversedCashMovementIds(
    scope,
    floats.map((row) => row.id),
  );
  return floats.some((row) => !cancelled.has(row.id));
}

/** [PCN-013] Which of these cash movements a later row cancelled. */
async function reversedCashMovementIds(
  scope: TenantScope,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await scope.db
    .select({ reversesId: cashMovements.reversesId })
    .from(cashMovements)
    .where(scope.scopeOf(cashMovements, inArray(cashMovements.reversesId, [...ids])));
  return new Set(rows.map((row) => row.reversesId).filter((id): id is string => id !== null));
}

export interface CashMovementExceptionRow {
  readonly id: string;
  readonly direction: 'in' | 'out';
  readonly amountPaisa: number;
  readonly reason: string;
  readonly note: string | null;
  readonly byName: string;
  readonly createdAt: Date;
  /** [PCN-013] Set when this row cancels another. */
  readonly reversesId: string | null;
  /** [PCN-013] Cancelled by a later row (which may fall in another range). */
  readonly reversed: boolean;
}

export async function cashMovementsExceptionInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<CashMovementExceptionRow[]> {
  const rows = await scope.db
    .select({
      id: cashMovements.id,
      direction: cashMovements.direction,
      amountPaisa: cashMovements.amountPaisa,
      reason: cashMovements.reason,
      note: cashMovements.note,
      byName: users.name,
      createdAt: cashMovements.createdAt,
      reversesId: cashMovements.reversesId,
    })
    .from(cashMovements)
    .innerJoin(users, eq(cashMovements.createdBy, users.id))
    .where(
      scope.scopeOf(
        cashMovements,
        gte(cashMovements.createdAt, from),
        lt(cashMovements.createdAt, to),
      ),
    )
    .orderBy(desc(cashMovements.createdAt));
  const reversed = await reversedCashMovementIds(
    scope,
    rows.filter((row) => row.reversesId === null).map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, reversed: reversed.has(row.id) }));
}

/**
 * [PCN-013] Payments cancelled in the range — udhaar and supplier alike.
 *
 * T1: putting money back onto a customer's debt, or onto what the shop owes a
 * distributor, is exactly the kind of act the owner must see. A cancelled cash
 * movement is already in the cash movements list, beside the entry it cancels.
 */
export interface PaymentReversalExceptionRow {
  readonly id: string;
  readonly kind: 'udhaar' | 'supplier';
  readonly name: string;
  /** The amount cancelled, positive. */
  readonly amountPaisa: number;
  /** The cancellation's own receipt, for an udhaar payment. */
  readonly receiptNumber: string | null;
  readonly byName: string;
  readonly createdAt: Date;
}

export async function paymentReversalsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<PaymentReversalExceptionRow[]> {
  const [udhaar, supplier] = await Promise.all([
    scope.db
      .select({
        id: payments.id,
        name: customers.name,
        amountPaisa: payments.amountPaisa,
        receiptNumber: payments.receiptNumber,
        byName: users.name,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(customers, eq(payments.customerId, customers.id))
      .innerJoin(users, eq(payments.createdBy, users.id))
      .where(
        scope.scopeOf(
          payments,
          isNotNull(payments.reversesId),
          gte(payments.createdAt, from),
          lt(payments.createdAt, to),
        ),
      ),
    scope.db
      .select({
        id: supplierPayments.id,
        name: suppliers.name,
        amountPaisa: supplierPayments.amountPaisa,
        byName: users.name,
        createdAt: supplierPayments.createdAt,
      })
      .from(supplierPayments)
      .innerJoin(suppliers, eq(supplierPayments.supplierId, suppliers.id))
      .innerJoin(users, eq(supplierPayments.createdBy, users.id))
      .where(
        scope.scopeOf(
          supplierPayments,
          isNotNull(supplierPayments.reversesId),
          gte(supplierPayments.createdAt, from),
          lt(supplierPayments.createdAt, to),
        ),
      ),
  ]);
  const rows: PaymentReversalExceptionRow[] = [
    ...udhaar.map((row) => ({ ...row, kind: 'udhaar' as const, amountPaisa: -row.amountPaisa })),
    ...supplier.map((row) => ({
      ...row,
      kind: 'supplier' as const,
      amountPaisa: -row.amountPaisa,
      receiptNumber: null,
    })),
  ];
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export interface LateSyncedRow {
  readonly kind: 'sale' | 'payment';
  readonly id: string;
  readonly receiptNumber: string;
  readonly clientCommittedAt: Date;
  readonly createdAt: Date;
}

/** Records ADR-3's offline path delivered — synced later than they happened. */
export async function lateSyncedInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<LateSyncedRow[]> {
  const [saleRows, paymentRows] = await Promise.all([
    scope.db
      .select({
        id: sales.id,
        receiptNumber: sales.receiptNumber,
        clientCommittedAt: sales.clientCommittedAt,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .where(
        scope.scopeOf(
          sales,
          eq(sales.origin, 'offline_sync'),
          gte(sales.createdAt, from),
          lt(sales.createdAt, to),
        ),
      ),
    scope.db
      .select({
        id: payments.id,
        receiptNumber: payments.receiptNumber,
        clientCommittedAt: payments.clientCommittedAt,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(
        scope.scopeOf(
          payments,
          eq(payments.origin, 'offline_sync'),
          gte(payments.createdAt, from),
          lt(payments.createdAt, to),
        ),
      ),
  ]);

  const rows: LateSyncedRow[] = [
    ...saleRows.map((row) => ({ kind: 'sale' as const, ...row })),
    ...paymentRows.map((row) => ({ kind: 'payment' as const, ...row })),
  ];
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/* ========================================================================== */
/* Report figures — daily and overall (Phase 13's Day 7; weekly/monthly cut)  */
/* ========================================================================== */

export interface ReportFigures {
  /** Sold, minus what came back. Never gross — see the note on `reportFigures`. */
  readonly revenuePaisa: number;
  readonly costPaisa: number;
  readonly marginPaisa: number;
  readonly saleCount: number;
  readonly unitsSold: number;
  readonly returnCount: number;
  /** Refunded in the range, so the net figures can show their own adjustment. */
  readonly returnedPaisa: number;
  /** [PCN-012, D2] Stock written off or counted short in the range, at cost. */
  readonly writtenOffPaisa: number;
  /** [PCN-014] Discounts given in the range: off items, and off whole bills. */
  readonly itemDiscountPaisa: number;
  readonly billDiscountPaisa: number;
}

/**
 * Margin is honest about two things Phase 9 §7 names: bonus units (a batch's
 * total is what was paid, spread over every unit received, free ones
 * included) and pending allocations (no batch yet, so no cost until a
 * purchase or count correction gives it one).
 *
 * And now about a third: RETURNS.
 *
 * Revenue and cost were both gross. `commitReturn` writes its own rows and
 * touches neither the sale nor its allocations (correctly — ADR-1 forbids it),
 * so a refunded sale kept contributing its full revenue and its full cost to
 * this report forever. Margin is revenue minus cost, and removing a returned
 * item takes away more revenue than cost — so the reported margin was strictly
 * HIGHER than the real one.
 *
 * That is the exact failure Day 6 wrote a rule against when it made effective
 * unit cost floor rather than round: "a reported margin is never better than
 * the real one." The rule was right and this report was breaking it.
 *
 * Returns are subtracted in the range they HAPPENED, not the range of the sale
 * they undo. A refund paid out of today's drawer is today's money leaving,
 * which is already how `expectedCash` treats it — the two figures would
 * otherwise disagree about the same event.
 */
export async function reportFigures(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<ReportFigures> {
  const [salesRow] = await scope.db
    .select({
      total: sum(sales.totalPaisa).as('total'),
      count: sql<string>`count(*)`,
      billDiscount: sum(sales.invoiceDiscountPaisa).as('billDiscount'),
    })
    .from(sales)
    .where(scope.scopeOf(sales, gte(sales.createdAt, from), lt(sales.createdAt, to)));

  const [unitsRow] = await scope.db
    .select({
      total: sum(saleLines.qtyBase).as('total'),
      itemDiscount: sum(saleLines.lineDiscountPaisa).as('itemDiscount'),
    })
    .from(saleLines)
    .where(scope.scopeOf(saleLines, gte(saleLines.createdAt, from), lt(saleLines.createdAt, to)));

  /*
   * [PCN-012] Cost is each outflow's cumulative share of its batch's exact
   * total (`batch-cost-queries.ts`): never understated, and a used-up batch
   * costs exactly what was paid. Derived from the batch's CURRENT total, so a
   * corrected invoice restates units sold before the correction (D1). Sales
   * net of restocked returns are cost of goods sold; write-offs and other
   * negative adjustments take their share too (D2) and are reported beside it.
   * A pending allocation has no batch yet and costs nothing until resolved.
   */
  const ledger = await batchCostLedger(scope, to);
  let soldCost = 0;
  let returnedCost = 0;
  let writtenOffPaisa = 0;
  for (const movement of ledger.movements) {
    if (movement.at < from) continue;
    if (movement.kind === 'sale') soldCost += movement.costPaisa;
    else if (movement.kind === 'restock') returnedCost -= movement.costPaisa;
    else if (movement.kind === 'adjustment') writtenOffPaisa += movement.costPaisa;
  }

  const [returnsRow] = await scope.db
    .select({
      count: sql<string>`count(*)`,
      refunded: sql<string>`sum(${saleReturns.cashOutPaisa} + ${saleReturns.creditReducedPaisa})`,
    })
    .from(saleReturns)
    .where(
      scope.scopeOf(saleReturns, gte(saleReturns.createdAt, from), lt(saleReturns.createdAt, to)),
    );

  const returnedPaisa = Number(returnsRow?.refunded ?? 0);
  const revenuePaisa = Number(salesRow?.total ?? 0) - returnedPaisa;
  const costPaisa = soldCost - returnedCost;

  return {
    revenuePaisa,
    costPaisa,
    marginPaisa: revenuePaisa - costPaisa,
    saleCount: Number(salesRow?.count ?? 0),
    unitsSold: Number(unitsRow?.total ?? 0),
    returnCount: Number(returnsRow?.count ?? 0),
    returnedPaisa,
    writtenOffPaisa,
    itemDiscountPaisa: Number(unitsRow?.itemDiscount ?? 0),
    billDiscountPaisa: Number(salesRow?.billDiscount ?? 0),
  };
}
