/**
 * [PCN-014] Stored bill-discount shares, and the backfill that gave sales from
 * before them their shares.
 *
 * Migration 0017's UPDATE restates `invoiceDiscountShares` in SQL. Two
 * statements of one rule are one rule only while they agree, so this runs the
 * migration's own statement against sales whose shares were wiped, as if
 * written before the column existed, and requires the TypeScript's answer —
 * remainders, ties and all.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { saleLines, sales } from '@/db/schema';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { adminQuery } from '../../../tests/db-admin';
import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../../tests/fixtures';
import { commitSale } from './commit-sale';
import { invoiceDiscountShares, storedLineGrossPaisa } from './sale-command';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

/** The last statement of migration 0017: the backfill itself. */
function backfillStatement(): string {
  const file = readFileSync(
    join(process.cwd(), 'src', 'db', 'migrations', '0017_invoice_discount_shares.sql'),
    'utf8',
  );
  const statement = file.split('--> statement-breakpoint').at(-1)?.trim() ?? '';
  expect(statement).toMatch(/^-- \[PCN-014\] Backfill/);
  expect(statement).toContain('UPDATE "sale_lines"');
  return statement;
}

suite('stored bill-discount shares (PCN-014)', () => {
  let tenant: TestTenant;
  let receipt = 0;

  beforeAll(async () => {
    tenant = await provisionTestTenant('shares');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  /** A sale of lines at the given per-unit prices (one unit each), less a bill discount. */
  async function sale(
    prices: readonly number[],
    discountPaisa: number,
    lineDiscounts: readonly number[] = [],
  ): Promise<Uuid> {
    const lines = [];
    for (const [index, price] of prices.entries()) {
      const product = await createTestProduct(tenant.scope, `Share ${uuidv7().slice(-6)}`, price);
      await addOpeningStock(tenant.scope, product.id, 10);
      lines.push({
        lineId: uuidv7(),
        productId: product.id,
        qtyBase: 1,
        enteredUnitLevel: 'tab',
        unitPricePaisa: price,
        lineDiscountPaisa: lineDiscounts[index] ?? 0,
        priceOverridden: false,
      });
    }
    const subtotal = lines.reduce(
      (sum, line) => sum + line.unitPricePaisa - line.lineDiscountPaisa,
      0,
    );
    const saleId = uuidv7();
    receipt += 1;
    const sold = await commitSale(tenant.scope, {
      saleId,
      receiptNumber: `SH-${receipt}`,
      customerId: null,
      lines,
      invoiceDiscountPaisa: discountPaisa,
      cashPaisa: subtotal - discountPaisa,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(sold.ok).toBe(true);
    return saleId;
  }

  async function storedShares(saleId: Uuid): Promise<Map<string, number>> {
    const rows = await tenant.scope.select(saleLines, eq(saleLines.saleId, saleId));
    return new Map(rows.map((row) => [row.id, row.invoiceDiscountSharePaisa]));
  }

  async function expectedShares(saleId: Uuid): Promise<Map<string, number>> {
    const rows = await tenant.scope.select(saleLines, eq(saleLines.saleId, saleId));
    const sold = await tenant.scope.selectOne(sales, eq(sales.id, saleId));
    return invoiceDiscountShares(
      rows.map((row) => ({
        id: row.id,
        totalPaisa: storedLineGrossPaisa(row) - row.lineDiscountPaisa,
      })),
      sold?.invoiceDiscountPaisa ?? 0,
    );
  }

  it('commitSale stores each line’s share, summing to the discount', async () => {
    const saleId = await sale([45_000 + 5_000, 163_000], 8_000, [5_000]);
    const shares = await storedShares(saleId);
    expect([...shares.values()].sort((a, b) => a - b)).toEqual([1_731, 6_269]);
    expect(shares).toEqual(await expectedShares(saleId));
  });

  it('the migration’s backfill gives exactly the same shares, ties included', async () => {
    const sales = [
      await sale([45_000 + 5_000, 163_000], 8_000, [5_000]),
      // Equal lines: every remainder ties, so the id order decides.
      await sale([100, 100, 100], 2),
      // Awkward remainders across five lines.
      await sale([7, 11, 13, 17, 19], 66),
      // A line given away free carries none of it.
      await sale([500, 1_000], 100, [500]),
    ];
    const before = await Promise.all(sales.map(storedShares));

    // As if written before shares were stored.
    await adminQuery(
      `update sale_lines set invoice_discount_share_paisa = 0 where tenant_id = $1`,
      [tenant.tenantId],
    );
    expect([...(await storedShares(sales[0]!)).values()]).toEqual([0, 0]);

    await adminQuery(backfillStatement());

    for (const [index, saleId] of sales.entries()) {
      expect(await storedShares(saleId), `sale ${index}`).toEqual(before[index]);
      expect(await storedShares(saleId), `sale ${index}`).toEqual(await expectedShares(saleId));
    }
  });
});
