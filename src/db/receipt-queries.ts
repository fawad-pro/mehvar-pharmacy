/**
 * Receipt queries — the *review* half of the product.
 *
 * THE PRINCIPLE THIS SURFACE EXISTS FOR
 *
 * A pharmacist needs a clear place to DO something and a separate, obvious
 * place to REVIEW what has already happened. Before this module, the second
 * half had nowhere to live: the only way to look at a completed sale was to
 * open Returns and search for it, which meant the act of checking what a
 * customer bought was indistinguishable from the act of starting to refund it.
 * The Day screen's "See the sales" link led there too — an owner reviewing the
 * day was dropped into a refund workflow.
 *
 * So receipts get their own surface, and Returns keeps only the thing it is
 * for. The relationship reverses: you look at a receipt, and *from* it you may
 * decide to start a return. Reviewing never means entering a workflow that
 * changes anything.
 *
 * WHAT COUNTS AS A RECEIPT
 *
 * Everything that produced a receipt number, which since PCN-002 and PCN-003
 * means all three receipt-producing events — sales, standalone settlements and
 * returns — drawn from one sequence. They are listed together because that is
 * how the shop experiences them: "receipt 1043" is a thing that happened,
 * and which of the three tables it lives in is the software's business.
 */

import 'server-only';

import { desc, eq, ilike, inArray, or, sum } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { returnableLinesForSale } from './returns-queries';
import type { TenantScope } from './scoped';
import {
  customers,
  payments,
  products,
  saleLines,
  saleReturnLines,
  saleReturns,
  sales,
  users,
} from './schema';

import { refundForLine } from '@/domain/sales/return-command';
import type { Uuid } from '@/lib/uuid';

/**
 * What kind of event a receipt number refers to.
 *
 * Declared here and redeclared by the client components that render it, per
 * the Day 7 rule — a client component never names this module.
 */
/** [PCN-013] `payment_cancelled`: the receipt for cancelling a payment typed wrong. */
export type ReceiptKind = 'sale' | 'settlement' | 'payment_cancelled' | 'return';

export interface ReceiptListRow {
  readonly receiptNumber: string;
  readonly kind: ReceiptKind;
  readonly id: Uuid;
  readonly customerName: string | null;
  readonly salesmanName: string;
  /** Signed from the shop's point of view: a return is money going out. */
  readonly amountPaisa: number;
  readonly createdAt: Date;
  /** Sales only: udhaar rather than cash. */
  readonly onCredit: boolean;
  /** Sales only: at least one return has been made against it. */
  readonly hasReturns: boolean;
}

export interface ReceiptListPage {
  readonly items: readonly ReceiptListRow[];
  readonly hasMore: boolean;
}

/**
 * Recent receipts of every kind, newest first.
 *
 * One query per table and a merge in TypeScript rather than a SQL `UNION`:
 * the three shapes differ enough that a union would need a column list of
 * casts and nulls that nobody could read, and the row counts here are a page
 * at a time. If this ever needs to page deeply, it wants a materialised view,
 * not a cleverer union.
 */
export async function listReceipts(
  scope: TenantScope,
  options: { search?: string; limit?: number } = {},
): Promise<ReceiptListPage> {
  const limit = options.limit ?? 50;
  const search = (options.search ?? '').trim();
  // Over-fetch each kind so the merged page is still full after interleaving.
  const perKind = limit + 1;

  const saleRows = await scope.db
    .select({
      id: sales.id,
      receiptNumber: sales.receiptNumber,
      customerName: customers.name,
      salesmanName: users.name,
      totalPaisa: sales.totalPaisa,
      creditPaisa: sales.creditPaisa,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(sales.createdBy, users.id))
    .where(
      search === ''
        ? scope.scopeOf(sales)
        : scope.scopeOf(
            sales,
            or(ilike(sales.receiptNumber, `%${search}%`), ilike(customers.name, `%${search}%`)),
          ),
    )
    .orderBy(desc(sales.createdAt))
    .limit(perKind);

  /*
   * Which of those sales have a return against them.
   *
   * A separate grouped aggregate rather than a correlated `sql` subquery.
   *
   * The reason is subtler than the rule in CLAUDE.md states, and worth getting
   * right because the imprecise version is testable-and-passing, which is the
   * most misleading kind of wrong. Drizzle qualifies interpolated columns only
   * when the outer query HAS A JOIN:
   *
   *   .from(sales)                    → (… where "sale_id" = "id")
   *   .from(sales).leftJoin(customers) → (… where "sale_returns"."sale_id" = "sales"."id")
   *
   * The first resolves both names against `sale_returns` and silently counts
   * zero. The second is correct. This query happens to have joins, so a
   * correlated subquery here would work today — verified by rendering both.
   *
   * That is exactly why it is not used. The correctness of the subquery would
   * rest on an incidental property of a different part of the same statement:
   * drop the `customers` join in some later edit and the count silently becomes
   * zero, with no error, no type change and no failing test unless one happens
   * to cover it. A grouped aggregate does not depend on anything but itself.
   */
  const saleIds = saleRows.map((row) => row.id);
  const returnedAgainst = new Set<string>();
  if (saleIds.length > 0) {
    const counts = await scope.db
      .select({ saleId: saleReturns.saleId })
      .from(saleReturns)
      .where(scope.scopeOf(saleReturns, inArray(saleReturns.saleId, saleIds)))
      .groupBy(saleReturns.saleId);
    for (const row of counts) returnedAgainst.add(row.saleId);
  }

  const paymentRows = await scope.db
    .select({
      id: payments.id,
      receiptNumber: payments.receiptNumber,
      customerName: customers.name,
      salesmanName: users.name,
      amountPaisa: payments.amountPaisa,
      createdAt: payments.createdAt,
      reversesId: payments.reversesId,
    })
    .from(payments)
    .leftJoin(customers, eq(payments.customerId, customers.id))
    .leftJoin(users, eq(payments.createdBy, users.id))
    .where(
      search === ''
        ? scope.scopeOf(payments)
        : scope.scopeOf(
            payments,
            or(ilike(payments.receiptNumber, `%${search}%`), ilike(customers.name, `%${search}%`)),
          ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(perKind);

  const returnRows = await scope.db
    .select({
      id: saleReturns.id,
      receiptNumber: saleReturns.receiptNumber,
      customerName: customers.name,
      salesmanName: users.name,
      cashOutPaisa: saleReturns.cashOutPaisa,
      creditReducedPaisa: saleReturns.creditReducedPaisa,
      createdAt: saleReturns.createdAt,
    })
    .from(saleReturns)
    .innerJoin(sales, eq(saleReturns.saleId, sales.id))
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(saleReturns.createdBy, users.id))
    .where(
      search === ''
        ? scope.scopeOf(saleReturns)
        : scope.scopeOf(
            saleReturns,
            or(
              ilike(saleReturns.receiptNumber, `%${search}%`),
              ilike(customers.name, `%${search}%`),
            ),
          ),
    )
    .orderBy(desc(saleReturns.createdAt))
    .limit(perKind);

  const merged: ReceiptListRow[] = [
    ...saleRows.map((row) => ({
      receiptNumber: row.receiptNumber,
      kind: 'sale' as const,
      id: row.id,
      customerName: row.customerName,
      salesmanName: row.salesmanName ?? 'Unknown',
      amountPaisa: row.totalPaisa,
      createdAt: row.createdAt,
      onCredit: row.creditPaisa > 0,
      hasReturns: returnedAgainst.has(row.id),
    })),
    ...paymentRows.map((row) => ({
      receiptNumber: row.receiptNumber,
      kind: row.reversesId === null ? ('settlement' as const) : ('payment_cancelled' as const),
      id: row.id,
      customerName: row.customerName,
      salesmanName: row.salesmanName ?? 'Unknown',
      // A cancellation is stored negative; the kind says which way it went.
      amountPaisa: Math.abs(row.amountPaisa),
      createdAt: row.createdAt,
      onCredit: false,
      hasReturns: false,
    })),
    ...returnRows.map((row) => ({
      receiptNumber: row.receiptNumber,
      kind: 'return' as const,
      id: row.id,
      customerName: row.customerName,
      salesmanName: row.salesmanName ?? 'Unknown',
      amountPaisa: row.cashOutPaisa + row.creditReducedPaisa,
      createdAt: row.createdAt,
      onCredit: false,
      hasReturns: false,
    })),
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  return { items: merged.slice(0, limit), hasMore: merged.length > limit };
}

export interface ReceiptDetailLine {
  readonly lineId: Uuid;
  readonly productId: Uuid;
  readonly productName: string;
  readonly qtyBase: number;
  readonly baseUnitName: string;
  /** So the screen can render W5's "1 strip + 4 tab" rather than a base count. */
  readonly packLevels: readonly { name: string; factor: number }[];
  readonly enteredUnitLevel: string;
  /** Per base unit — nominal since PCN-012; money is `lineAmountPaisa`. */
  readonly unitPricePaisa: number;
  /*
   * [PCN-012] As entered and charged. Null on a line from before PCN-012 (its
   * amount is per-base price × base quantity). On a return's lines, the count
   * is null (a return is in base units) and the amount is the returned share
   * of what the original line charged.
   */
  readonly unitName: string | null;
  readonly unitCount: number | null;
  readonly unitPricePaisaEntered: number | null;
  readonly lineAmountPaisa: number | null;
  readonly lineDiscountPaisa: number;
  /** [PCN-014] This line's share of the bill discount (0 on a return's lines). */
  readonly invoiceDiscountSharePaisa: number;
  readonly priceOverridden: boolean;
  /** How much of this line has since come back — the "what happened after". */
  readonly returnedBase: number;
}

export interface ReceiptReturnSummary {
  readonly returnId: Uuid;
  readonly receiptNumber: string;
  readonly cashOutPaisa: number;
  readonly creditReducedPaisa: number;
  readonly reasonNote: string | null;
  readonly createdAt: Date;
}

export interface ReceiptDetail {
  readonly kind: ReceiptKind;
  readonly id: Uuid;
  readonly receiptNumber: string;
  readonly createdAt: Date;
  readonly salesmanName: string;
  readonly customerId: Uuid | null;
  readonly customerName: string | null;
  readonly origin: string;

  /** Sale only. */
  readonly lines?: readonly ReceiptDetailLine[];
  readonly invoiceDiscountPaisa?: number;
  /** [PCN-014] The owner who approved a bill discount over the limit, if one did. */
  readonly invoiceDiscountApprovedByName?: string | null;
  readonly totalPaisa?: number;
  readonly cashPaisa?: number;
  readonly creditPaisa?: number;
  readonly changePaisa?: number;
  /** Returns made against this sale, if any. */
  readonly returns?: readonly ReceiptReturnSummary[];

  /** Settlement or cancellation only; always positive. */
  readonly amountPaisa?: number;
  /** [PCN-013] A settlement: the receipt that cancelled it, if one did. */
  readonly cancelledByReceiptNumber?: string;
  /** [PCN-013] A cancellation: the settlement it cancels. */
  readonly cancelsReceiptNumber?: string;

  /** Return only. */
  readonly againstReceiptNumber?: string;
  readonly againstSaleId?: Uuid;
  readonly cashOutPaisa?: number;
  readonly creditReducedPaisa?: number;
  readonly reasonNote?: string | null;
}

/**
 * One receipt, whichever kind it is, looked up by the number a person can read
 * off a printed slip.
 *
 * By receipt number rather than id on purpose: the number is what exists in the
 * physical world. A customer walks in holding a slip, and the thing printed on
 * it should be the thing you can type. Ids are for links between screens.
 */
export async function findReceipt(
  scope: TenantScope,
  receiptNumber: string,
): Promise<ReceiptDetail | null> {
  const trimmed = receiptNumber.trim();
  if (trimmed === '') return null;
  const approver = alias(users, 'approver');

  const [sale] = await scope.db
    .select({
      id: sales.id,
      receiptNumber: sales.receiptNumber,
      createdAt: sales.createdAt,
      salesmanName: users.name,
      customerId: sales.customerId,
      customerName: customers.name,
      origin: sales.origin,
      invoiceDiscountPaisa: sales.invoiceDiscountPaisa,
      invoiceDiscountApprovedByName: approver.name,
      totalPaisa: sales.totalPaisa,
      cashPaisa: sales.cashPaisa,
      creditPaisa: sales.creditPaisa,
      changePaisa: sales.changePaisa,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(sales.createdBy, users.id))
    .leftJoin(approver, eq(sales.invoiceDiscountApprovedBy, approver.id))
    .where(scope.scopeOf(sales, eq(sales.receiptNumber, trimmed)))
    .limit(1);

  if (sale) {
    const lineRows = await scope.db
      .select({
        lineId: saleLines.id,
        productId: saleLines.productId,
        productName: products.name,
        qtyBase: saleLines.qtyBase,
        baseUnitName: products.baseUnitName,
        packLevels: products.packLevels,
        enteredUnitLevel: saleLines.enteredUnitLevel,
        unitPricePaisa: saleLines.unitPricePaisa,
        unitName: saleLines.unitName,
        unitCount: saleLines.unitCount,
        unitPricePaisaEntered: saleLines.unitPricePaisaEntered,
        lineAmountPaisa: saleLines.lineAmountPaisa,
        lineDiscountPaisa: saleLines.lineDiscountPaisa,
        invoiceDiscountSharePaisa: saleLines.invoiceDiscountSharePaisa,
        priceOverridden: saleLines.priceOverridden,
      })
      .from(saleLines)
      .innerJoin(products, eq(saleLines.productId, products.id))
      .where(scope.scopeOf(saleLines, eq(saleLines.saleId, sale.id)))
      .orderBy(saleLines.createdAt);

    // Grouped aggregate, for the reason given in `listReceipts`: not because a
    // correlated subquery is broken here, but because it would only be correct
    // for as long as this query keeps its join.
    const returnedByLine = new Map<string, number>();
    if (lineRows.length > 0) {
      const returnedRows = await scope.db
        .select({
          saleLineId: saleReturnLines.saleLineId,
          returnedBase: sum(saleReturnLines.qtyBase).as('returned_base'),
        })
        .from(saleReturnLines)
        .where(
          scope.scopeOf(
            saleReturnLines,
            inArray(
              saleReturnLines.saleLineId,
              lineRows.map((row) => row.lineId),
            ),
          ),
        )
        .groupBy(saleReturnLines.saleLineId);
      for (const row of returnedRows) {
        returnedByLine.set(row.saleLineId, Number(row.returnedBase ?? 0));
      }
    }

    const returnRows = await scope.db
      .select({
        returnId: saleReturns.id,
        receiptNumber: saleReturns.receiptNumber,
        cashOutPaisa: saleReturns.cashOutPaisa,
        creditReducedPaisa: saleReturns.creditReducedPaisa,
        reasonNote: saleReturns.reasonNote,
        createdAt: saleReturns.createdAt,
      })
      .from(saleReturns)
      .where(scope.scopeOf(saleReturns, eq(saleReturns.saleId, sale.id)))
      .orderBy(desc(saleReturns.createdAt));

    return {
      kind: 'sale',
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      createdAt: sale.createdAt,
      salesmanName: sale.salesmanName ?? 'Unknown',
      customerId: sale.customerId,
      customerName: sale.customerName,
      origin: sale.origin,
      lines: lineRows.map((row) => ({
        ...row,
        returnedBase: returnedByLine.get(row.lineId) ?? 0,
      })),
      invoiceDiscountPaisa: sale.invoiceDiscountPaisa,
      invoiceDiscountApprovedByName: sale.invoiceDiscountApprovedByName,
      totalPaisa: sale.totalPaisa,
      cashPaisa: sale.cashPaisa,
      creditPaisa: sale.creditPaisa,
      changePaisa: sale.changePaisa,
      returns: returnRows,
    };
  }

  const [payment] = await scope.db
    .select({
      id: payments.id,
      receiptNumber: payments.receiptNumber,
      createdAt: payments.createdAt,
      salesmanName: users.name,
      customerId: payments.customerId,
      customerName: customers.name,
      origin: payments.origin,
      amountPaisa: payments.amountPaisa,
      reversesId: payments.reversesId,
    })
    .from(payments)
    .leftJoin(customers, eq(payments.customerId, customers.id))
    .leftJoin(users, eq(payments.createdBy, users.id))
    .where(scope.scopeOf(payments, eq(payments.receiptNumber, trimmed)))
    .limit(1);

  if (payment) {
    // [PCN-013] Each half of a cancellation names the other.
    const [other] = await scope.db
      .select({ receiptNumber: payments.receiptNumber })
      .from(payments)
      .where(
        scope.scopeOf(
          payments,
          payment.reversesId === null
            ? eq(payments.reversesId, payment.id)
            : eq(payments.id, payment.reversesId),
        ),
      )
      .limit(1);
    return {
      kind: payment.reversesId === null ? 'settlement' : 'payment_cancelled',
      id: payment.id,
      receiptNumber: payment.receiptNumber,
      createdAt: payment.createdAt,
      salesmanName: payment.salesmanName ?? 'Unknown',
      customerId: payment.customerId,
      customerName: payment.customerName,
      origin: payment.origin,
      amountPaisa: Math.abs(payment.amountPaisa),
      ...(other
        ? payment.reversesId === null
          ? { cancelledByReceiptNumber: other.receiptNumber }
          : { cancelsReceiptNumber: other.receiptNumber }
        : {}),
    };
  }

  const [saleReturn] = await scope.db
    .select({
      id: saleReturns.id,
      receiptNumber: saleReturns.receiptNumber,
      createdAt: saleReturns.createdAt,
      salesmanName: users.name,
      customerId: sales.customerId,
      customerName: customers.name,
      againstReceiptNumber: sales.receiptNumber,
      againstSaleId: sales.id,
      cashOutPaisa: saleReturns.cashOutPaisa,
      creditReducedPaisa: saleReturns.creditReducedPaisa,
      reasonNote: saleReturns.reasonNote,
    })
    .from(saleReturns)
    .innerJoin(sales, eq(saleReturns.saleId, sales.id))
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(saleReturns.createdBy, users.id))
    .where(scope.scopeOf(saleReturns, eq(saleReturns.receiptNumber, trimmed)))
    .limit(1);

  if (saleReturn) {
    const lineRows = await scope.db
      .select({
        lineId: saleReturnLines.id,
        saleLineId: saleReturnLines.saleLineId,
        productId: saleLines.productId,
        productName: products.name,
        qtyBase: saleReturnLines.qtyBase,
        baseUnitName: products.baseUnitName,
        packLevels: products.packLevels,
        enteredUnitLevel: saleLines.enteredUnitLevel,
        unitPricePaisa: saleLines.unitPricePaisa,
        lineDiscountPaisa: saleLines.lineDiscountPaisa,
        priceOverridden: saleLines.priceOverridden,
      })
      .from(saleReturnLines)
      .innerJoin(saleLines, eq(saleReturnLines.saleLineId, saleLines.id))
      .innerJoin(products, eq(saleLines.productId, products.id))
      .where(scope.scopeOf(saleReturnLines, eq(saleReturnLines.saleReturnId, saleReturn.id)));

    // The sold lines as a refund reads them (their bill-discount shares
    // included), and what returns made BEFORE this one had already taken.
    const soldBy = new Map(
      (await returnableLinesForSale(scope, saleReturn.againstSaleId as Uuid)).map((line) => [
        line.saleLineId,
        line,
      ]),
    );
    const earlier = await scope.db
      .select({
        saleLineId: saleReturnLines.saleLineId,
        qtyBase: saleReturnLines.qtyBase,
        returnId: saleReturns.id,
        at: saleReturns.createdAt,
      })
      .from(saleReturnLines)
      .innerJoin(saleReturns, eq(saleReturnLines.saleReturnId, saleReturns.id))
      .where(scope.scopeOf(saleReturnLines, eq(saleReturns.saleId, saleReturn.againstSaleId)));
    const returnedBefore = new Map<string, number>();
    for (const row of earlier) {
      const before =
        row.at.getTime() < saleReturn.createdAt.getTime() ||
        (row.at.getTime() === saleReturn.createdAt.getTime() && row.returnId < saleReturn.id);
      if (before) {
        returnedBefore.set(row.saleLineId, (returnedBefore.get(row.saleLineId) ?? 0) + row.qtyBase);
      }
    }

    return {
      kind: 'return',
      id: saleReturn.id,
      receiptNumber: saleReturn.receiptNumber,
      createdAt: saleReturn.createdAt,
      salesmanName: saleReturn.salesmanName ?? 'Unknown',
      customerId: saleReturn.customerId,
      customerName: saleReturn.customerName,
      origin: 'online',
      // A return's own lines are what came back; nothing comes back from a
      // return, so the column is structurally zero rather than queried.
      lines: lineRows.map(({ saleLineId, ...row }) => {
        const sold = soldBy.get(saleLineId);
        return {
          ...row,
          returnedBase: 0,
          invoiceDiscountSharePaisa: 0,
          unitName: null,
          unitCount: null,
          unitPricePaisaEntered: null,
          // [PCN-014] What this return refunded for the line — the same
          // cumulative share `commitReturn` paid, counted from what earlier
          // returns had already taken, so the lines add up to the refund.
          lineAmountPaisa: sold
            ? refundForLine(
                { ...sold, alreadyReturnedBase: returnedBefore.get(saleLineId) ?? 0 },
                row.qtyBase,
              )
            : 0,
        };
      }),
      againstReceiptNumber: saleReturn.againstReceiptNumber,
      againstSaleId: saleReturn.againstSaleId,
      cashOutPaisa: saleReturn.cashOutPaisa,
      creditReducedPaisa: saleReturn.creditReducedPaisa,
      reasonNote: saleReturn.reasonNote,
    };
  }

  return null;
}
