/**
 * Customer and udhaar queries.
 *
 * Inside `src/db` because ADR-2 puts every query here.
 */

import 'server-only';

import { asc, eq, ilike, inArray, or, sql, sum } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import { customers, payments, saleReturns, sales } from './schema';

import type { Uuid } from '@/lib/uuid';

/**
 * Customer balance — Phase 5 invariant 3, derived, never stored as authority.
 *
 *   balance = Σ credit extended (from sales) − Σ payments − Σ credit reversals
 *
 * Credit reversals are `sale_returns.credit_reduced_paisa` (Day 7), joined
 * through the sale to reach the customer it was extended to — a return row
 * carries no `customer_id` of its own, deliberately, since it is always the
 * sale's.
 */
export async function customerBalance(scope: TenantScope, customerId: Uuid): Promise<number> {
  const [extended] = await scope.db
    .select({ total: sum(sales.creditPaisa).as('total') })
    .from(sales)
    .where(scope.scopeOf(sales, eq(sales.customerId, customerId)));

  const [paid] = await scope.db
    .select({ total: sum(payments.amountPaisa).as('total') })
    .from(payments)
    .where(scope.scopeOf(payments, eq(payments.customerId, customerId)));

  const [reversed] = await scope.db
    .select({ total: sum(saleReturns.creditReducedPaisa).as('total') })
    .from(saleReturns)
    .innerJoin(sales, eq(saleReturns.saleId, sales.id))
    .where(scope.scopeOf(saleReturns, eq(sales.customerId, customerId)));

  return (
    Number(extended?.total ?? 0) - Number(paid?.total ?? 0) - Number(reversed?.total ?? 0)
  );
}

/** Every customer's balance in one query, keyed by id — avoids N+1 on the list screen. */
export async function balancesByCustomer(
  scope: TenantScope,
  customerIds: readonly Uuid[],
): Promise<Record<string, number>> {
  if (customerIds.length === 0) {
    return {};
  }

  const [extended, paid, reversed] = await Promise.all([
    scope.db
      .select({ customerId: sales.customerId, total: sum(sales.creditPaisa).as('total') })
      .from(sales)
      .where(scope.scopeOf(sales, inArray(sales.customerId, [...customerIds])))
      .groupBy(sales.customerId),
    scope.db
      .select({ customerId: payments.customerId, total: sum(payments.amountPaisa).as('total') })
      .from(payments)
      .where(scope.scopeOf(payments, inArray(payments.customerId, [...customerIds])))
      .groupBy(payments.customerId),
    scope.db
      .select({ customerId: sales.customerId, total: sum(saleReturns.creditReducedPaisa).as('total') })
      .from(saleReturns)
      .innerJoin(sales, eq(saleReturns.saleId, sales.id))
      .where(scope.scopeOf(saleReturns, inArray(sales.customerId, [...customerIds])))
      .groupBy(sales.customerId),
  ]);

  const balances: Record<string, number> = Object.fromEntries(
    customerIds.map((id) => [id, 0]),
  );
  for (const row of extended) {
    if (row.customerId) balances[row.customerId] = (balances[row.customerId] ?? 0) + Number(row.total ?? 0);
  }
  for (const row of paid) {
    if (row.customerId) balances[row.customerId] = (balances[row.customerId] ?? 0) - Number(row.total ?? 0);
  }
  for (const row of reversed) {
    if (row.customerId) balances[row.customerId] = (balances[row.customerId] ?? 0) - Number(row.total ?? 0);
  }
  return balances;
}

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}

export interface CustomerListQuery {
  search?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface CustomerPage {
  items: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Customers with their balances — Phase 10 §2: "list with balances", the owner
 * phone view's "largest first" (W11).
 *
 * Paginated in SQL rather than loaded whole, on the same principle as the
 * catalog list: a neighbourhood pharmacy's udhaar book accumulates for years.
 */
export async function listCustomers(
  scope: TenantScope,
  query: CustomerListQuery = {},
): Promise<CustomerPage> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.max(1, Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE));

  const term = query.search?.trim();
  const where = term
    ? scope.scopeOf(
        customers,
        eq(customers.isActive, true),
        or(ilike(customers.name, `%${term}%`), ilike(customers.phone, `%${term}%`)),
      )
    : scope.scopeOf(customers, eq(customers.isActive, true));

  const [totals] = await scope.db.select({ value: sql<number>`count(*)` }).from(customers).where(where);
  const total = Number(totals?.value ?? 0);

  // All matching customers are fetched to sort by derived balance, then sliced
  // to the page. A customer book stays in the low thousands at most (Phase 5
  // §6 boundary keeps no addresses/notes/history beyond the debt), so this is
  // cheap in a way a 3,000-product catalog scan would not be.
  const rows = await scope.db.select().from(customers).where(where);
  const balances = await balancesByCustomer(
    scope,
    rows.map((row) => row.id),
  );

  const sorted = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      balancePaisa: balances[row.id] ?? 0,
    }))
    .sort((a, b) => b.balancePaisa - a.balancePaisa);

  const start = (page - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface CustomerLedgerRow {
  id: string;
  kind: 'sale' | 'payment';
  createdAt: Date;
  /** Positive = credit extended; negative = paid in. Signed for a running total. */
  amountPaisa: number;
  /** For a sale row, the receipt to look up; for a payment, its own. */
  receiptNumber: string;
}

/**
 * The transactions behind a balance — T4: "any derived figure can be expanded
 * into the transactions that produced it. Udhaar disputes end by showing the
 * screen." This is that screen's data.
 */
export async function customerLedger(
  scope: TenantScope,
  customerId: Uuid,
): Promise<CustomerLedgerRow[]> {
  const saleRows = await scope.db
    .select({
      id: sales.id,
      createdAt: sales.createdAt,
      creditPaisa: sales.creditPaisa,
      receiptNumber: sales.receiptNumber,
    })
    .from(sales)
    .where(scope.scopeOf(sales, eq(sales.customerId, customerId)));

  const paymentRows = await scope.db
    .select({
      id: payments.id,
      createdAt: payments.createdAt,
      amountPaisa: payments.amountPaisa,
      receiptNumber: payments.receiptNumber,
    })
    .from(payments)
    .where(scope.scopeOf(payments, eq(payments.customerId, customerId)));

  const ledger: CustomerLedgerRow[] = [
    ...saleRows
      .filter((row) => row.creditPaisa > 0)
      .map((row) => ({
        id: row.id,
        kind: 'sale' as const,
        createdAt: row.createdAt,
        amountPaisa: row.creditPaisa,
        receiptNumber: row.receiptNumber,
      })),
    ...paymentRows.map((row) => ({
      id: row.id,
      kind: 'payment' as const,
      createdAt: row.createdAt,
      amountPaisa: -row.amountPaisa,
      receiptNumber: row.receiptNumber,
    })),
  ];

  return ledger.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function findCustomer(
  scope: TenantScope,
  customerId: Uuid,
): Promise<{ id: string; name: string; phone: string | null } | undefined> {
  const row = await scope.selectOne(customers, eq(customers.id, customerId));
  return row ? { id: row.id, name: row.name, phone: row.phone } : undefined;
}

/** Type-ahead over name and phone — W2's customer picker, W3's settlement key. */
export async function searchCustomers(
  scope: TenantScope,
  term: string,
  limit = 8,
): Promise<Array<{ id: string; name: string; phone: string | null; balancePaisa: number }>> {
  const trimmed = term.trim();
  if (trimmed === '') {
    return [];
  }

  const rows = await scope.db
    .select()
    .from(customers)
    .where(
      scope.scopeOf(
        customers,
        eq(customers.isActive, true),
        or(ilike(customers.name, `%${trimmed}%`), ilike(customers.phone, `%${trimmed}%`)),
      ),
    )
    .orderBy(asc(customers.name))
    .limit(limit);

  const balances = await balancesByCustomer(
    scope,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    balancePaisa: balances[row.id] ?? 0,
  }));
}

export async function insertCustomer(
  scope: TenantScope,
  row: { id: Uuid; name: string; phone: string | null },
): Promise<void> {
  await scope.insert(customers, row);
}

/** Idempotency (ADR-3): a settlement's client id already committed is not committed twice. */
export async function findPaymentById(
  scope: TenantScope,
  paymentId: Uuid,
): Promise<{ id: string; receiptNumber: string; amountPaisa: number } | undefined> {
  const row = await scope.selectOne(payments, eq(payments.id, paymentId));
  return row ? { id: row.id, receiptNumber: row.receiptNumber, amountPaisa: row.amountPaisa } : undefined;
}

export async function insertPayment(
  scope: TenantScope,
  row: Omit<typeof payments.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(payments, row as never);
}

/**
 * The highest receipt counter across sales, payments AND returns — one
 * receipt book, one sequence (PCN-002, extended by PCN-003).
 */
export async function highestReceiptCounterAcrossReceipts(
  scope: TenantScope,
  devicePrefix: string,
): Promise<number> {
  const pattern = `${devicePrefix}-%`;
  const [salesRow] = await scope.db
    .select({ receiptNumber: sales.receiptNumber })
    .from(sales)
    .where(scope.scopeOf(sales, sql`${sales.receiptNumber} LIKE ${pattern}`))
    .orderBy(sql`length(${sales.receiptNumber}) desc, ${sales.receiptNumber} desc`)
    .limit(1);

  const [paymentsRow] = await scope.db
    .select({ receiptNumber: payments.receiptNumber })
    .from(payments)
    .where(scope.scopeOf(payments, sql`${payments.receiptNumber} LIKE ${pattern}`))
    .orderBy(sql`length(${payments.receiptNumber}) desc, ${payments.receiptNumber} desc`)
    .limit(1);

  const [returnsRow] = await scope.db
    .select({ receiptNumber: saleReturns.receiptNumber })
    .from(saleReturns)
    .where(scope.scopeOf(saleReturns, sql`${saleReturns.receiptNumber} LIKE ${pattern}`))
    .orderBy(sql`length(${saleReturns.receiptNumber}) desc, ${saleReturns.receiptNumber} desc`)
    .limit(1);

  const counterOf = (value: string | undefined): number => {
    if (!value) return 0;
    const n = Number(value.slice(devicePrefix.length + 1));
    return Number.isSafeInteger(n) ? n : 0;
  };

  return Math.max(
    counterOf(salesRow?.receiptNumber),
    counterOf(paymentsRow?.receiptNumber),
    counterOf(returnsRow?.receiptNumber),
  );
}
