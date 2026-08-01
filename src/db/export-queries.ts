/**
 * Tenant data export — Phase 9 §8, Phase 3 §5.2.
 *
 *   "One tenant-scoped dump: every table above filtered by tenant, as
 *    CSV-per-table in a zip, generated on demand. No format cleverness;
 *    completeness is the feature."
 *
 * "Every table above" is Phase 9 §2–§4: the reference tables, the event
 * tables, and batches — not `devices`/`sessions` (mechanical, Day 1's
 * PCN-001 addition) and not the global catalog (§6, tenant-free by charter).
 * `users` is included per the plan, minus its two credential-hash columns:
 * the data is the customer's, but a password hash leaving the system is a
 * security incident, not a deliverable.
 */

import 'server-only';

import type { TenantScope } from './scoped';
import {
  adjustments,
  batches,
  cashMovements,
  customers,
  payments,
  productBarcodes,
  products,
  purchaseLines,
  purchases,
  saleLineAllocations,
  saleLines,
  saleReturnLines,
  saleReturns,
  sales,
  suppliers,
  users,
} from './schema';

export interface ExportTable {
  readonly name: string;
  readonly rows: Array<Record<string, unknown>>;
}

export async function tenantDataExport(scope: TenantScope): Promise<ExportTable[]> {
  const [
    usersRows,
    productsRows,
    barcodesRows,
    customersRows,
    suppliersRows,
    batchesRows,
    purchasesRows,
    purchaseLinesRows,
    salesRows,
    saleLinesRows,
    allocationsRows,
    paymentsRows,
    returnsRows,
    returnLinesRows,
    adjustmentsRows,
    cashMovementsRows,
  ] = await Promise.all([
    scope.select(users),
    scope.select(products),
    scope.select(productBarcodes),
    scope.select(customers),
    scope.select(suppliers),
    scope.select(batches),
    scope.select(purchases),
    scope.select(purchaseLines),
    scope.select(sales),
    scope.select(saleLines),
    scope.select(saleLineAllocations),
    scope.select(payments),
    scope.select(saleReturns),
    scope.select(saleReturnLines),
    scope.select(adjustments),
    scope.select(cashMovements),
  ]);

  return [
    {
      name: 'users',
      rows: usersRows.map(({ pinHash: _pinHash, passwordHash: _passwordHash, ...row }) => row),
    },
    { name: 'products', rows: productsRows },
    { name: 'product_barcodes', rows: barcodesRows },
    { name: 'customers', rows: customersRows },
    { name: 'suppliers', rows: suppliersRows },
    { name: 'batches', rows: batchesRows },
    { name: 'purchases', rows: purchasesRows },
    { name: 'purchase_lines', rows: purchaseLinesRows },
    { name: 'sales', rows: salesRows },
    { name: 'sale_lines', rows: saleLinesRows },
    { name: 'sale_line_allocations', rows: allocationsRows },
    { name: 'payments', rows: paymentsRows },
    { name: 'sale_returns', rows: returnsRows },
    { name: 'sale_return_lines', rows: returnLinesRows },
    { name: 'adjustments', rows: adjustmentsRows },
    { name: 'cash_movements', rows: cashMovementsRows },
  ];
}
