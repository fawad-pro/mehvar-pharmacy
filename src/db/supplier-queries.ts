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

import { eq, sql, sum } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import {
  purchaseCorrections,
  purchaseLines,
  purchases,
  supplierPayments,
  supplierReturns,
  suppliers,
} from './schema';

import { summariseSupplierBook, type SupplierBook } from '@/domain/suppliers/supplier-position';
import type { Uuid } from '@/lib/uuid';

/** Positive = the pharmacy owes; negative = an advance sits with the supplier. */
export async function supplierBalance(scope: TenantScope, supplierId: Uuid): Promise<number> {
  const [lineCost] = await scope.db
    .select({
      total: sql<string>`sum(${purchaseLines.qtyBase} * ${purchaseLines.unitCostPaisa})`,
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
        total: sql<string>`sum(${purchaseLines.qtyBase} * ${purchaseLines.unitCostPaisa})`,
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
 * Every active supplier's position for the Purchases panel: who is owed, and
 * (PCN-011) who holds credit. The payable mirror of the customers lists (W11).
 * A settled supplier appears in neither.
 */
export async function supplierPositions(scope: TenantScope): Promise<SupplierPositions> {
  const [rows, balances] = await Promise.all([
    scope.db
      .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone })
      .from(suppliers)
      .where(scope.scopeOf(suppliers, eq(suppliers.isActive, true))),
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

export async function insertSupplierPayment(
  scope: TenantScope,
  row: Omit<typeof supplierPayments.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(supplierPayments, row as never);
}

export async function findSupplier(
  scope: TenantScope,
  supplierId: Uuid,
): Promise<{ id: string; name: string } | undefined> {
  const row = await scope.selectOne(suppliers, eq(suppliers.id, supplierId));
  return row ? { id: row.id, name: row.name } : undefined;
}
