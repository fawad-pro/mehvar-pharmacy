/**
 * [PCN-007] Supplier balance and settlement queries — the mirror of the udhaar
 * side in `udhaar-queries.ts`.
 *
 * A supplier balance is the money the pharmacy owes a distributor, derived and
 * never stored as authority, exactly like a customer balance (ADR-1):
 *
 *   balance = Σ (invoice cost − cash paid at receiving) − Σ supplier payments
 *             + Σ purchase-correction invoice deltas − Σ supplier-return credit
 *             [PCN-009: a corrected invoice owes its corrected value, and goods
 *             sent back reduce what is owed by the credit the supplier gave]
 *
 * over TRACKED purchases only (`purchases.credit_tracked`). A purchase entered
 * before supplier credit existed has no recorded payment — its cash-paid 0 is
 * a column default, not a fact — so it contributes nothing to what is owed.
 *
 * The first two terms come from `purchases` (cash paid) joined to
 * `purchase_lines` (the invoice cost, bonus units free); the third from
 * `supplier_payments`. Everything is a plain grouped aggregate over a joined
 * query — never a correlated `sql` subquery, per the Day 3/Day 9 rule.
 *
 * Inside `src/db` because ADR-2 puts every query here.
 */

import 'server-only';

import { and, asc, eq, ilike, or, sql, sum } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import {
  products,
  purchaseCorrections,
  purchaseLines,
  purchases,
  supplierPayments,
  supplierReturns,
  suppliers,
  users,
} from './schema';
import { purchaseLineCostSql } from './purchase-line-cost';

import { summariseSupplierBook, type SupplierBook } from '@/domain/suppliers/supplier-position';
import type { PackLevel } from '@/lib/quantity';
import type { Uuid } from '@/lib/uuid';

/** Positive = the pharmacy owes; negative = an advance sits with the supplier. */
export async function supplierBalance(scope: TenantScope, supplierId: Uuid): Promise<number> {
  const [lineCost] = await scope.db
    .select({
      total: sql<string>`sum(${purchaseLineCostSql})`,
    })
    .from(purchases)
    .innerJoin(purchaseLines, eq(purchaseLines.purchaseId, purchases.id))
    .where(
      scope.scopeOf(
        purchases,
        eq(purchases.supplierId, supplierId),
        eq(purchases.creditTracked, true),
      ),
    );

  const [cashPaid] = await scope.db
    .select({ total: sum(purchases.cashPaidPaisa).as('total') })
    .from(purchases)
    .where(
      scope.scopeOf(
        purchases,
        eq(purchases.supplierId, supplierId),
        eq(purchases.creditTracked, true),
      ),
    );

  const [paid] = await scope.db
    .select({ total: sum(supplierPayments.amountPaisa).as('total') })
    .from(supplierPayments)
    .where(scope.scopeOf(supplierPayments, eq(supplierPayments.supplierId, supplierId)));

  const [corrected] = await scope.db
    .select({ total: sum(purchaseCorrections.invoiceDeltaPaisa).as('total') })
    .from(purchaseCorrections)
    .innerJoin(purchaseLines, eq(purchaseLines.id, purchaseCorrections.purchaseLineId))
    .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
    .where(
      scope.scopeOf(
        purchaseCorrections,
        eq(purchases.supplierId, supplierId),
        eq(purchases.creditTracked, true),
      ),
    );

  const [returned] = await scope.db
    .select({ total: sum(supplierReturns.creditPaisa).as('total') })
    .from(supplierReturns)
    .where(scope.scopeOf(supplierReturns, eq(supplierReturns.supplierId, supplierId)));

  return (
    Number(lineCost?.total ?? 0) -
    Number(cashPaid?.total ?? 0) -
    Number(paid?.total ?? 0) +
    Number(corrected?.total ?? 0) -
    Number(returned?.total ?? 0)
  );
}

/** Every named supplier's balance in one round of queries — avoids N+1. */
export async function balancesBySupplier(scope: TenantScope): Promise<Record<string, number>> {
  const [lineCosts, cashPaid, paid, corrected, returned] = await Promise.all([
    scope.db
      .select({
        supplierId: purchases.supplierId,
        total: sql<string>`sum(${purchaseLineCostSql})`,
      })
      .from(purchases)
      .innerJoin(purchaseLines, eq(purchaseLines.purchaseId, purchases.id))
      .where(scope.scopeOf(purchases, eq(purchases.creditTracked, true)))
      .groupBy(purchases.supplierId),
    scope.db
      .select({
        supplierId: purchases.supplierId,
        total: sum(purchases.cashPaidPaisa).as('total'),
      })
      .from(purchases)
      .where(scope.scopeOf(purchases, eq(purchases.creditTracked, true)))
      .groupBy(purchases.supplierId),
    scope.db
      .select({
        supplierId: supplierPayments.supplierId,
        total: sum(supplierPayments.amountPaisa).as('total'),
      })
      .from(supplierPayments)
      .where(scope.scopeOf(supplierPayments))
      .groupBy(supplierPayments.supplierId),
    scope.db
      .select({
        supplierId: purchases.supplierId,
        total: sum(purchaseCorrections.invoiceDeltaPaisa).as('total'),
      })
      .from(purchaseCorrections)
      .innerJoin(purchaseLines, eq(purchaseLines.id, purchaseCorrections.purchaseLineId))
      .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
      .where(scope.scopeOf(purchaseCorrections, eq(purchases.creditTracked, true)))
      .groupBy(purchases.supplierId),
    scope.db
      .select({
        supplierId: supplierReturns.supplierId,
        total: sum(supplierReturns.creditPaisa).as('total'),
      })
      .from(supplierReturns)
      .where(scope.scopeOf(supplierReturns))
      .groupBy(supplierReturns.supplierId),
  ]);

  const balances: Record<string, number> = {};
  const apply = (supplierId: string | null, delta: number): void => {
    if (supplierId === null) return;
    balances[supplierId] = (balances[supplierId] ?? 0) + delta;
  };
  for (const row of lineCosts) apply(row.supplierId, Number(row.total ?? 0));
  for (const row of cashPaid) apply(row.supplierId, -Number(row.total ?? 0));
  for (const row of paid) apply(row.supplierId, -Number(row.total ?? 0));
  for (const row of corrected) apply(row.supplierId, Number(row.total ?? 0));
  for (const row of returned) apply(row.supplierId, -Number(row.total ?? 0));
  return balances;
}

export interface SupplierBalanceItem {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}

export interface SupplierPositions {
  /** Suppliers the pharmacy owes, largest first. `balancePaisa` > 0. */
  owed: SupplierBalanceItem[];
  /**
   * [PCN-011] Suppliers holding the pharmacy's money, largest first.
   * `creditPaisa` is positive; the direction is in the list, never the sign.
   */
  inCredit: (Omit<SupplierBalanceItem, 'balancePaisa'> & { creditPaisa: number })[];
}

/**
 * Every supplier's position for the Purchases panel: who is owed, and
 * (PCN-011) who holds credit. The payable mirror of the customers lists (W11).
 * A settled supplier appears in neither.
 *
 * [PCN-013] Removed suppliers are included: removal is refused while a
 * balance is open, so one appearing here means money still moving, which is
 * exactly when it must not be hidden.
 */
export async function supplierPositions(scope: TenantScope): Promise<SupplierPositions> {
  const [rows, balances] = await Promise.all([
    scope.db
      .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone })
      .from(suppliers)
      .where(scope.scopeOf(suppliers)),
    balancesBySupplier(scope),
  ]);

  const owed: SupplierPositions['owed'] = [];
  const inCredit: SupplierPositions['inCredit'] = [];
  for (const row of rows) {
    const balancePaisa = balances[row.id] ?? 0;
    if (balancePaisa > 0) {
      owed.push({ ...row, balancePaisa });
    } else if (balancePaisa < 0) {
      inCredit.push({ ...row, creditPaisa: -balancePaisa });
    }
  }
  owed.sort((a, b) => b.balancePaisa - a.balancePaisa);
  inCredit.sort((a, b) => b.creditPaisa - a.creditPaisa);
  return { owed, inCredit };
}

/**
 * The all-time supplier book for the Day screen: what is owed and, separately
 * (PCN-011), what suppliers hold in credit. Never netted across suppliers.
 */
export async function supplierBook(scope: TenantScope): Promise<SupplierBook> {
  return summariseSupplierBook(Object.values(await balancesBySupplier(scope)));
}

/** Idempotency (ADR-3 posture, as `commitPurchase`): a payment id committed once. */
export async function findSupplierPaymentById(
  scope: TenantScope,
  paymentId: Uuid,
): Promise<{ id: string; amountPaisa: number } | undefined> {
  const row = await scope.selectOne(supplierPayments, eq(supplierPayments.id, paymentId));
  return row ? { id: row.id, amountPaisa: row.amountPaisa } : undefined;
}

/** [PCN-013] A supplier payment as a reversal needs it. */
export async function findSupplierPaymentForReversal(
  scope: TenantScope,
  paymentId: Uuid,
): Promise<
  { id: string; supplierId: string; amountPaisa: number; reversesId: string | null } | undefined
> {
  const row = await scope.selectOne(supplierPayments, eq(supplierPayments.id, paymentId));
  return row
    ? {
        id: row.id,
        supplierId: row.supplierId,
        amountPaisa: row.amountPaisa,
        reversesId: row.reversesId,
      }
    : undefined;
}

/** [PCN-013] The row cancelling this supplier payment, if one exists. */
export async function findSupplierPaymentReversalOf(
  scope: TenantScope,
  paymentId: Uuid,
): Promise<{ id: string } | undefined> {
  const row = await scope.selectOne(supplierPayments, eq(supplierPayments.reversesId, paymentId));
  return row ? { id: row.id } : undefined;
}

export async function insertSupplierPayment(
  scope: TenantScope,
  row: Omit<typeof supplierPayments.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(supplierPayments, row as never);
}

export async function findSupplier(
  scope: TenantScope,
  supplierId: Uuid,
): Promise<{ id: string; name: string; phone: string | null; isActive: boolean } | undefined> {
  const row = await scope.selectOne(suppliers, eq(suppliers.id, supplierId));
  return row ? { id: row.id, name: row.name, phone: row.phone, isActive: row.isActive } : undefined;
}

/** [PCN-013] Identity fields and the soft archive only (Phase 9 §1). */
export async function updateSupplier(
  scope: TenantScope,
  supplierId: Uuid,
  patch: { name?: string; phone?: string | null; isActive?: boolean },
): Promise<void> {
  await scope.update(suppliers, patch, eq(suppliers.id, supplierId));
}

export interface SupplierListItem extends SupplierBalanceItem {
  isActive: boolean;
}

/**
 * [PCN-013] Every supplier, with its balance, by name. The Purchases panel
 * lists only open balances, so before this a settled supplier — the usual
 * state of one created by mistake — had no page anyone could reach. A removed
 * supplier still holding a balance is always listed, like a customer.
 */
export async function listSuppliers(
  scope: TenantScope,
  query: { search?: string | undefined; includeRemoved?: boolean | undefined } = {},
): Promise<SupplierListItem[]> {
  const term = query.search?.trim();
  const [rows, balances] = await Promise.all([
    scope.db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        phone: suppliers.phone,
        isActive: suppliers.isActive,
      })
      .from(suppliers)
      .where(
        term
          ? scope.scopeOf(
              suppliers,
              or(ilike(suppliers.name, `%${term}%`), ilike(suppliers.phone, `%${term}%`)),
            )
          : scope.scopeOf(suppliers),
      )
      .orderBy(asc(suppliers.name)),
    balancesBySupplier(scope),
  ]);
  return rows
    .map((row) => ({ ...row, balancePaisa: balances[row.id] ?? 0 }))
    .filter((row) => row.isActive || query.includeRemoved || row.balancePaisa !== 0);
}

/**
 * One supplier's account, expanded — T4: "any derived figure can be expanded
 * into the transactions that produced it." The payable mirror of
 * `customerLedger`.
 *
 * Each row carries the amount it moved the balance (positive = more owed), so
 * the rows sum to `supplierBalance` exactly; `supplier-balance.integration`
 * pins that. Same terms, same TRACKED-only rule: an invoice entered before
 * supplier credit existed recorded no payment and is not in the account.
 *
 * Until this existed a payment made from "Owed to suppliers" was counted and
 * shown nowhere: the balance dropped and nothing said when, how much, or who.
 */
export type SupplierLedgerRow =
  | {
      readonly kind: 'invoice';
      readonly id: string;
      readonly createdAt: Date;
      readonly amountPaisa: number;
      readonly invoiceRef: string | null;
      readonly invoiceTotalPaisa: number;
      readonly paidNowPaisa: number;
      readonly byName: string;
    }
  | {
      readonly kind: 'correction';
      readonly id: string;
      readonly createdAt: Date;
      readonly amountPaisa: number;
      readonly purchaseId: string;
      readonly invoiceRef: string | null;
      readonly note: string;
      readonly byName: string;
    }
  | {
      readonly kind: 'return';
      readonly id: string;
      readonly createdAt: Date;
      readonly amountPaisa: number;
      readonly productName: string;
      readonly qtyBase: number;
      readonly baseUnitName: string;
      readonly packLevels: PackLevel[];
      readonly unitName: string | null;
      readonly unitCount: number | null;
      readonly note: string | null;
      readonly byName: string;
    }
  | {
      readonly kind: 'payment';
      readonly id: string;
      readonly createdAt: Date;
      readonly amountPaisa: number;
      readonly note: string | null;
      readonly byName: string;
      /** [PCN-013] Cancelled by a later row; still counted, and offset by it. */
      readonly reversed: boolean;
    }
  | {
      /** [PCN-013] Cancels a payment typed wrong: adds its amount back to what is owed. */
      readonly kind: 'payment_reversal';
      readonly id: string;
      readonly createdAt: Date;
      readonly amountPaisa: number;
      readonly note: string | null;
      readonly byName: string;
      /** When the cancelled payment was made, so the row can name it. */
      readonly reversesPaidAt: Date | null;
    };

export async function supplierLedger(
  scope: TenantScope,
  supplierId: Uuid,
): Promise<SupplierLedgerRow[]> {
  const [invoices, corrections, returns, payments] = await Promise.all([
    scope.db
      .select({
        id: purchases.id,
        createdAt: purchases.createdAt,
        invoiceRef: purchases.invoiceRef,
        cashPaidPaisa: purchases.cashPaidPaisa,
        byName: users.name,
        total: sql<string>`sum(${purchaseLineCostSql})`,
      })
      .from(purchases)
      .innerJoin(purchaseLines, eq(purchaseLines.purchaseId, purchases.id))
      .innerJoin(users, eq(users.id, purchases.createdBy))
      .where(
        scope.scopeOf(
          purchases,
          eq(purchases.supplierId, supplierId),
          eq(purchases.creditTracked, true),
        ),
      )
      .groupBy(
        purchases.id,
        purchases.createdAt,
        purchases.invoiceRef,
        purchases.cashPaidPaisa,
        users.name,
      ),
    scope.db
      .select({
        id: purchaseCorrections.id,
        createdAt: purchaseCorrections.createdAt,
        amountPaisa: purchaseCorrections.invoiceDeltaPaisa,
        purchaseId: purchases.id,
        invoiceRef: purchases.invoiceRef,
        note: purchaseCorrections.note,
        byName: users.name,
      })
      .from(purchaseCorrections)
      .innerJoin(purchaseLines, eq(purchaseLines.id, purchaseCorrections.purchaseLineId))
      .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
      .innerJoin(users, eq(users.id, purchaseCorrections.createdBy))
      .where(
        scope.scopeOf(
          purchaseCorrections,
          and(eq(purchases.supplierId, supplierId), eq(purchases.creditTracked, true)),
        ),
      ),
    scope.db
      .select({
        id: supplierReturns.id,
        createdAt: supplierReturns.createdAt,
        creditPaisa: supplierReturns.creditPaisa,
        productName: products.name,
        qtyBase: supplierReturns.qtyBase,
        baseUnitName: products.baseUnitName,
        packLevels: products.packLevels,
        unitName: supplierReturns.unitName,
        unitCount: supplierReturns.unitCount,
        note: supplierReturns.note,
        byName: users.name,
      })
      .from(supplierReturns)
      .innerJoin(products, eq(products.id, supplierReturns.productId))
      .innerJoin(users, eq(users.id, supplierReturns.createdBy))
      .where(scope.scopeOf(supplierReturns, eq(supplierReturns.supplierId, supplierId))),
    scope.db
      .select({
        id: supplierPayments.id,
        createdAt: supplierPayments.createdAt,
        amountPaisa: supplierPayments.amountPaisa,
        note: supplierPayments.note,
        byName: users.name,
        reversesId: supplierPayments.reversesId,
      })
      .from(supplierPayments)
      .innerJoin(users, eq(users.id, supplierPayments.createdBy))
      .where(scope.scopeOf(supplierPayments, eq(supplierPayments.supplierId, supplierId)))
      .orderBy(asc(supplierPayments.createdAt)),
  ]);

  // A cancellation is always the same supplier's, so both halves are here.
  const paidAt = new Map(payments.map((row) => [row.id, row.createdAt]));
  const cancelled = new Set(payments.map((row) => row.reversesId).filter((id) => id !== null));

  const rows: SupplierLedgerRow[] = [
    ...invoices.map((row) => {
      const invoiceTotalPaisa = Number(row.total ?? 0);
      return {
        kind: 'invoice' as const,
        id: row.id,
        createdAt: row.createdAt,
        amountPaisa: invoiceTotalPaisa - row.cashPaidPaisa,
        invoiceRef: row.invoiceRef,
        invoiceTotalPaisa,
        paidNowPaisa: row.cashPaidPaisa,
        byName: row.byName,
      };
    }),
    ...corrections.map((row) => ({ kind: 'correction' as const, ...row })),
    ...returns.map((row) => ({
      kind: 'return' as const,
      id: row.id,
      createdAt: row.createdAt,
      amountPaisa: -row.creditPaisa,
      productName: row.productName,
      qtyBase: row.qtyBase,
      baseUnitName: row.baseUnitName,
      packLevels: row.packLevels,
      unitName: row.unitName,
      unitCount: row.unitCount,
      note: row.note,
      byName: row.byName,
    })),
    ...payments.map((row) =>
      row.reversesId === null
        ? {
            kind: 'payment' as const,
            id: row.id,
            createdAt: row.createdAt,
            amountPaisa: -row.amountPaisa,
            note: row.note,
            byName: row.byName,
            reversed: cancelled.has(row.id),
          }
        : {
            kind: 'payment_reversal' as const,
            id: row.id,
            createdAt: row.createdAt,
            // Stored negative; negated, it adds back to what is owed.
            amountPaisa: -row.amountPaisa,
            note: row.note,
            byName: row.byName,
            reversesPaidAt: paidAt.get(row.reversesId) ?? null,
          },
    ),
  ];
  // Oldest first, so the running balance reads as the account's history. Ids
  // are v7, time-ordered, which settles rows written in the same millisecond.
  return rows.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}
