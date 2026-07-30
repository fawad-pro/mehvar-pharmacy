/**
 * Transaction semantics for `commitSale` — Phase 11 §3.2.
 *
 *   "commitSale — splits (cash+credit=total), FEFO order incl. NULLS-LAST
 *    expiry, pending-layer creation on shortfall, override/discount flags
 *    recorded."
 *
 * Against a real database, because half of what is being asserted is a property
 * of the transaction rather than of the code: that a failure leaves nothing
 * behind, that a replay writes nothing twice, and that a decrement and its
 * allocation row are never separable.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { batches, saleLineAllocations, saleLines, sales } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';
import { commitSale, validateSaleCommand, type SaleCommand } from './commit-sale';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

function command(overrides: Partial<SaleCommand> = {}): SaleCommand {
  return {
    saleId: uuidv7(),
    receiptNumber: `A-${Math.floor(Math.random() * 1_000_000)}`,
    customerId: null,
    lines: [],
    invoiceDiscountPaisa: 0,
    cashPaisa: 0,
    creditPaisa: 0,
    changePaisa: 0,
    origin: 'online',
    clientSchemaVersion: 1,
    clientCommittedAt: new Date(),
    ...overrides,
  };
}

function saleLine(productId: string, qtyBase: number, unitPricePaisa = 350) {
  return {
    lineId: uuidv7(),
    productId,
    qtyBase,
    enteredUnitLevel: 'tab',
    unitPricePaisa,
    lineDiscountPaisa: 0,
    priceOverridden: false,
  };
}

describe('command validation — Phase 5 invariant 4, before any row is written', () => {
  it('refuses an empty cart', () => {
    expect(validateSaleCommand(command())).toEqual({ ok: false, reason: 'empty_cart' });
  });

  it('refuses a split that does not equal the total', () => {
    const result = validateSaleCommand(
      command({ lines: [saleLine('p', 10)], cashPaisa: 3_000, creditPaisa: 0 }),
    );
    expect(result).toEqual({ ok: false, reason: 'split_mismatch' });
  });

  it('accepts an exact cash sale', () => {
    const result = validateSaleCommand(command({ lines: [saleLine('p', 10)], cashPaisa: 3_500 }));
    expect(result).toEqual({ ok: true, subtotalPaisa: 3_500, totalPaisa: 3_500 });
  });

  it('refuses credit without a named customer (Phase 9 §3 CHECK, caught early)', () => {
    const result = validateSaleCommand(command({ lines: [saleLine('p', 10)], creditPaisa: 3_500 }));
    expect(result).toEqual({ ok: false, reason: 'credit_without_customer' });
  });

  it('accepts a split cash/credit sale with a customer', () => {
    const result = validateSaleCommand(
      command({
        lines: [saleLine('p', 10)],
        customerId: uuidv7(),
        cashPaisa: 1_000,
        creditPaisa: 2_500,
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('applies the invoice discount to the total', () => {
    const result = validateSaleCommand(
      command({ lines: [saleLine('p', 10)], invoiceDiscountPaisa: 500, cashPaisa: 3_000 }),
    );
    expect(result).toEqual({ ok: true, subtotalPaisa: 3_500, totalPaisa: 3_000 });
  });

  it('refuses zero and fractional quantities', () => {
    expect(validateSaleCommand(command({ lines: [saleLine('p', 0)] })).ok).toBe(false);
    expect(validateSaleCommand(command({ lines: [saleLine('p', 1.5)] })).ok).toBe(false);
  });

  it('allows a zero-total sale — a fully discounted line is still a record', () => {
    const result = validateSaleCommand(
      command({ lines: [saleLine('p', 10)], invoiceDiscountPaisa: 3_500 }),
    );
    expect(result).toEqual({ ok: true, subtotalPaisa: 3_500, totalPaisa: 0 });
  });
});

suite('commitSale against Postgres', () => {
  let tenant: TestTenant;
  let panadol: TestProduct;

  beforeAll(async () => {
    tenant = await provisionTestTenant('commit');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  beforeEach(async () => {
    panadol = await createTestProduct(tenant.scope, `Panadol ${uuidv7().slice(0, 8)}`);
  });

  it('writes the sale, its lines and its allocations, and decrements the batch', async () => {
    const batchId = await addOpeningStock(tenant.scope, panadol.id, 100);

    const result = await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 30)], cashPaisa: 10_500 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [sale] = await tenant.scope.select(sales, eq(sales.id, result.value.saleId));
    expect(sale?.totalPaisa).toBe(10_500);
    expect(sale?.cashPaisa).toBe(10_500);

    const lines = await tenant.scope.select(saleLines, eq(saleLines.saleId, result.value.saleId));
    expect(lines).toHaveLength(1);

    const allocations = await tenant.scope.select(
      saleLineAllocations,
      eq(saleLineAllocations.saleLineId, lines[0]!.id),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.batchId).toBe(batchId);
    expect(allocations[0]?.qtyBase).toBe(30);
    expect(allocations[0]?.unitCostPaisa).toBe(280);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(batch?.qtyRemainingBase).toBe(70);
  });

  it('consumes earliest-expiry first, across batches (D1)', async () => {
    const soon = await addOpeningStock(tenant.scope, panadol.id, 20, {
      expiryDate: '2026-09-01',
      unitCostPaisa: 200,
    });
    const later = await addOpeningStock(tenant.scope, panadol.id, 100, {
      expiryDate: '2027-09-01',
      unitCostPaisa: 300,
    });

    const result = await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 50)], cashPaisa: 17_500 }),
    );
    expect(result.ok).toBe(true);

    const [soonBatch] = await tenant.scope.select(batches, eq(batches.id, soon));
    const [laterBatch] = await tenant.scope.select(batches, eq(batches.id, later));
    expect(soonBatch?.qtyRemainingBase).toBe(0);
    expect(laterBatch?.qtyRemainingBase).toBe(70);
  });

  it('sorts a null expiry LAST, even when it was created first', async () => {
    const nonPerishable = await addOpeningStock(tenant.scope, panadol.id, 50, {
      expiryDate: null,
    });
    const perishable = await addOpeningStock(tenant.scope, panadol.id, 50, {
      expiryDate: '2026-10-01',
    });

    await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 20)], cashPaisa: 7_000 }),
    );

    const [perish] = await tenant.scope.select(batches, eq(batches.id, perishable));
    const [nonPerish] = await tenant.scope.select(batches, eq(batches.id, nonPerishable));
    expect(perish?.qtyRemainingBase).toBe(30);
    expect(nonPerish?.qtyRemainingBase).toBe(50);
  });

  it('creates a pending allocation on shortfall instead of refusing (D2, P2)', async () => {
    await addOpeningStock(tenant.scope, panadol.id, 4);

    const result = await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 10)], cashPaisa: 3_500 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pendingByProduct[panadol.id]).toBe(6);

    const lines = await tenant.scope.select(saleLines, eq(saleLines.saleId, result.value.saleId));
    const allocations = await tenant.scope.select(
      saleLineAllocations,
      eq(saleLineAllocations.saleLineId, lines[0]!.id),
    );

    expect(allocations).toHaveLength(2);
    const pending = allocations.find((a) => a.batchId === null);
    expect(pending?.qtyBase).toBe(6);
    // Phase 9 §3: a pending row carries no cost until it resolves.
    expect(pending?.unitCostPaisa).toBeNull();
    expect(pending?.resolvedAt).toBeNull();
  });

  it('sells with no stock at all — the whole line goes pending', async () => {
    const result = await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 12)], cashPaisa: 4_200 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pendingByProduct[panadol.id]).toBe(12);
  });

  it('never drives a batch negative', async () => {
    await addOpeningStock(tenant.scope, panadol.id, 5);
    await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 40)], cashPaisa: 14_000 }),
    );

    const stock = await tenant.scope.select(batches, eq(batches.productId, panadol.id));
    for (const batch of stock) {
      expect(batch.qtyRemainingBase).toBeGreaterThanOrEqual(0);
    }
  });

  it('spreads two lines of the same product across the same batch correctly', async () => {
    // A cart with "3 strips" and "4 loose tablets" of one medicine is ordinary.
    // Both lines must not be planned against the same units.
    const batchId = await addOpeningStock(tenant.scope, panadol.id, 100);

    const result = await commitSale(
      tenant.scope,
      command({
        lines: [saleLine(panadol.id, 30), saleLine(panadol.id, 4)],
        cashPaisa: 350 * 34,
      }),
    );
    expect(result.ok).toBe(true);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(batch?.qtyRemainingBase).toBe(66);
  });

  it('records discounts and the override flag (T1)', async () => {
    await addOpeningStock(tenant.scope, panadol.id, 100);

    const line = {
      ...saleLine(panadol.id, 10, 300),
      lineDiscountPaisa: 200,
      priceOverridden: true,
    };
    const result = await commitSale(
      tenant.scope,
      command({ lines: [line], invoiceDiscountPaisa: 100, cashPaisa: 2_700 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [stored] = await tenant.scope.select(saleLines, eq(saleLines.id, line.lineId));
    expect(stored?.priceOverridden).toBe(true);
    expect(stored?.lineDiscountPaisa).toBe(200);

    const [sale] = await tenant.scope.select(sales, eq(sales.id, result.value.saleId));
    expect(sale?.subtotalPaisa).toBe(2_800);
    expect(sale?.invoiceDiscountPaisa).toBe(100);
    expect(sale?.totalPaisa).toBe(2_700);
  });

  it('reports the balance before, only when credit was extended (Day 4 mini-statement)', async () => {
    await addOpeningStock(tenant.scope, panadol.id, 100);
    const customerId = uuidv7();
    const { customers } = await import('@/db/schema');
    await tenant.scope.insert(customers, { id: customerId, name: 'Rashid', phone: null });

    const cashOnly = await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 10)], cashPaisa: 3_500 }),
    );
    expect(cashOnly.ok && cashOnly.value.balanceBeforePaisa).toBeUndefined();

    const firstCredit = await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 10)], customerId, creditPaisa: 3_500 }),
    );
    expect(firstCredit.ok && firstCredit.value.balanceBeforePaisa).toBe(0);

    const secondCredit = await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 10)], customerId, creditPaisa: 3_500 }),
    );
    // The customer already owed 3,500 from the first credit sale.
    expect(secondCredit.ok && secondCredit.value.balanceBeforePaisa).toBe(3_500);
  });

  it('is idempotent on the client id (ADR-3)', async () => {
    const batchId = await addOpeningStock(tenant.scope, panadol.id, 100);
    const cmd = command({ lines: [saleLine(panadol.id, 10)], cashPaisa: 3_500 });

    const first = await commitSale(tenant.scope, cmd);
    const second = await commitSale(tenant.scope, cmd);
    const third = await commitSale(tenant.scope, cmd);

    expect(first.ok && !first.value.alreadyCommitted).toBe(true);
    expect(second.ok && second.value.alreadyCommitted).toBe(true);
    expect(third.ok && third.value.alreadyCommitted).toBe(true);

    // Delivered three times, committed once: one decrement, one set of rows.
    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(batch?.qtyRemainingBase).toBe(90);
    expect(await tenant.scope.select(saleLines, eq(saleLines.saleId, cmd.saleId))).toHaveLength(1);
  });

  it('treats an offline-origin sale identically to an online one (ADR-5)', async () => {
    const online = await addOpeningStock(tenant.scope, panadol.id, 100);
    await commitSale(
      tenant.scope,
      command({ lines: [saleLine(panadol.id, 10)], cashPaisa: 3_500 }),
    );

    const offlineProduct = await createTestProduct(tenant.scope, `Offline ${uuidv7().slice(0, 8)}`);
    const offlineBatch = await addOpeningStock(tenant.scope, offlineProduct.id, 100);
    await commitSale(
      tenant.scope,
      command({
        lines: [saleLine(offlineProduct.id, 10)],
        cashPaisa: 3_500,
        origin: 'offline_sync',
        clientCommittedAt: new Date(Date.now() - 3_600_000),
      }),
    );

    const [a] = await tenant.scope.select(batches, eq(batches.id, online));
    const [b] = await tenant.scope.select(batches, eq(batches.id, offlineBatch));
    expect(a?.qtyRemainingBase).toBe(b?.qtyRemainingBase);
  });

  it('rolls back entirely when a line is invalid — no half-written sale', async () => {
    const batchId = await addOpeningStock(tenant.scope, panadol.id, 100);
    const saleId = uuidv7();

    const result = await commitSale(
      tenant.scope,
      command({ saleId, lines: [saleLine(panadol.id, 10)], cashPaisa: 1 }),
    );

    expect(result).toEqual({ ok: false, reason: 'split_mismatch' });
    expect(await tenant.scope.select(sales, eq(sales.id, saleId))).toHaveLength(0);
    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(batch?.qtyRemainingBase).toBe(100);
  });

  it('rejects a duplicate receipt number within the tenant (Phase 9 §5.5)', async () => {
    await addOpeningStock(tenant.scope, panadol.id, 100);
    const receiptNumber = `A-DUP-${uuidv7().slice(0, 8)}`;

    await commitSale(
      tenant.scope,
      command({ receiptNumber, lines: [saleLine(panadol.id, 5)], cashPaisa: 1_750 }),
    );

    // A different sale reusing the number must not land — two customers holding
    // identical receipt numbers is a dispute nobody can settle.
    await expect(
      commitSale(
        tenant.scope,
        command({ receiptNumber, lines: [saleLine(panadol.id, 5)], cashPaisa: 1_750 }),
      ),
    ).rejects.toThrow();
  });
});
