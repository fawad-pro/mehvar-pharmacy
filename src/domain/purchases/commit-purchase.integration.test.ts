/**
 * Transaction semantics for receiving stock — Phase 13's named Day 6 tests:
 * "batch materialization, bonus-cost honesty in margin math, pending
 * resolution, adjustment reason integrity."
 *
 * Against a real database, because all four are properties of what lands in
 * Postgres — and because the pending-resolution path runs through a
 * SECURITY DEFINER function (migration 0003) that only exists there.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { commitPurchase, type PurchaseCommand } from '@/domain/purchases/commit-purchase';
import { commitAdjustment } from '@/domain/inventory/commit-adjustment';
import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { verifyBatches } from '@/domain/inventory/rebuild';
import { batches, purchaseLines, purchases, saleLineAllocations, saleLines } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

import {
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

let receiptCounter = 0;
function nextReceipt(): string {
  receiptCounter += 1;
  return `P-${receiptCounter}`;
}

suite('commitPurchase against Postgres', () => {
  let tenant: TestTenant;
  let product: TestProduct;

  beforeAll(async () => {
    tenant = await provisionTestTenant('purchase');
    product = await createTestProduct(tenant.scope, `Purchased ${uuidv7().slice(0, 6)}`, 500);
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  function purchase(overrides: Partial<PurchaseCommand> = {}): PurchaseCommand {
    return {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: 'INV-1',
      invoiceDate: '2026-07-01',
      note: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 100,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: '2027-06-30',
          batchNumber: 'B-1',
          mrpAtReceivingPaisa: 600,
          priceAtReceivingPaisa: 500,
        },
      ],
      ...overrides,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Batch materialization                                                   */
  /* ---------------------------------------------------------------------- */

  it('materializes one batch per line, carrying the line’s own expiry and price', async () => {
    const command = purchase();
    const result = await commitPurchase(tenant.scope, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [batch] = await tenant.scope.select(batches, eq(batches.id, result.value.batchIds[0]!));
    expect(batch?.qtyReceivedBase).toBe(100);
    expect(batch?.qtyRemainingBase).toBe(100);
    expect(batch?.expiryDate).toBe('2027-06-30');
    expect(batch?.pricePerBaseUnitPaisa).toBe(500);
    expect(batch?.source).toBe('purchase_line');
    // The batch points back at the line that brought it in, so the invoice is
    // always reachable from the stock (Phase 9 §4's source/source_id).
    expect(batch?.sourceId).toBe(command.lines[0]!.lineId);
  });

  it('keeps two lines of one product as two batches', async () => {
    // Same medicine, two expiries on one invoice — merging them would destroy
    // exactly the distinction FEFO exists to act on.
    const command = purchase({
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 10,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: '2027-01-31',
          batchNumber: 'EARLY',
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 10,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: '2028-01-31',
          batchNumber: 'LATE',
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
    });

    const result = await commitPurchase(tenant.scope, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.batchIds).toHaveLength(2);

    const rows = await Promise.all(
      result.value.batchIds.map(async (id) => (await tenant.scope.select(batches, eq(batches.id, id)))[0]),
    );
    expect(rows.map((row) => row?.batchNumber).sort()).toEqual(['EARLY', 'LATE']);
  });

  /* ---------------------------------------------------------------------- */
  /* Bonus-cost honesty                                                      */
  /* ---------------------------------------------------------------------- */

  it('receives the bonus units and blends their cost into the batch', async () => {
    const command = purchase({
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 10,
          bonusQtyBase: 1,
          unitCostPaisa: 3_500,
          expiryDate: '2027-06-30',
          batchNumber: 'SCHEME',
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 4_000,
        },
      ],
    });

    const result = await commitPurchase(tenant.scope, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [batch] = await tenant.scope.select(batches, eq(batches.id, result.value.batchIds[0]!));
    // Eleven units on the shelf, not ten.
    expect(batch?.qtyReceivedBase).toBe(11);
    // 35,000 paisa paid ÷ 11 = 3,181.8, so 3,182 each (rounded up, PCN-012).
    // Recording 3,500 would overstate cost of goods on every scheme purchase,
    // permanently. The exact total is what reports cost from.
    expect(batch?.unitCostPaisa).toBe(3_182);
    expect(batch?.costTotalPaisa).toBe(35_000);

    // And the invoice keeps saying what the distributor actually billed.
    const [line] = await tenant.scope.select(
      purchaseLines,
      eq(purchaseLines.id, command.lines[0]!.lineId),
    );
    expect(line?.qtyBase).toBe(10);
    expect(line?.bonusQtyBase).toBe(1);
    expect(line?.unitCostPaisa).toBe(3_500);
  });

  /* ---------------------------------------------------------------------- */
  /* Idempotency                                                             */
  /* ---------------------------------------------------------------------- */

  it('receives a re-submitted invoice exactly once', async () => {
    const command = purchase();

    const first = await commitPurchase(tenant.scope, command);
    const second = await commitPurchase(tenant.scope, command);

    expect(first.ok && !first.value.alreadyCommitted).toBe(true);
    expect(second.ok && second.value.alreadyCommitted).toBe(true);

    expect(await tenant.scope.select(purchases, eq(purchases.id, command.purchaseId))).toHaveLength(1);
    // The critical part: stock did not double.
    expect(
      await tenant.scope.select(purchaseLines, eq(purchaseLines.purchaseId, command.purchaseId)),
    ).toHaveLength(1);
  });

  it('refuses a line with no quantity, naming the line', async () => {
    const command = purchase();
    const broken = {
      ...command,
      lines: [{ ...command.lines[0]!, qtyBase: 0 }],
    };
    const result = await commitPurchase(tenant.scope, broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_quantity');
    expect(result.lineId).toBe(command.lines[0]!.lineId);
  });
});

/* ------------------------------------------------------------------------ */
/* Pending resolution — the day's "done when"                                */
/* ------------------------------------------------------------------------ */

suite('pending-layer resolution (D2)', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('pending');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  /** Sells `qty` of a product with no stock, producing a pending allocation. */
  async function sellIntoPending(productId: string, qty: number): Promise<string> {
    const command: SaleCommand = {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId,
          qtyBase: qty,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 500 * qty,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    };
    const result = await commitSale(tenant.scope, command);
    expect(result.ok).toBe(true);
    return command.lines[0]!.lineId;
  }

  it('a purchase answers a shortfall the sale left behind', async () => {
    const product = await createTestProduct(tenant.scope, `Shortfall ${uuidv7().slice(0, 6)}`, 500);

    // Day 3's promise: the sale proceeds with no stock (P2, D2).
    const saleLineId = await sellIntoPending(product.id, 20);

    const [pendingBefore] = await tenant.scope.select(
      saleLineAllocations,
      eq(saleLineAllocations.saleLineId, saleLineId),
    );
    expect(pendingBefore?.batchId).toBeNull();
    expect(pendingBefore?.unitCostPaisa).toBeNull();
    expect(pendingBefore?.resolvedAt).toBeNull();

    // Day 6's promise: the missing purchase arrives.
    const result = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: 'LATE-INV',
      invoiceDate: '2026-07-02',
      note: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 100,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: '2027-06-30',
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolvedPendingBase).toBe(20);
    expect(result.value.stillPendingBase).toBe(0);

    // The allocation now points at real stock and carries a real cost, so the
    // sale's margin is finally knowable.
    const [resolved] = await tenant.scope.select(
      saleLineAllocations,
      eq(saleLineAllocations.saleLineId, saleLineId),
    );
    expect(resolved?.batchId).toBe(result.value.batchIds[0]);
    expect(resolved?.unitCostPaisa).toBe(280);
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(resolved?.resolvedByPurchaseLineId).not.toBeNull();

    // 100 arrived, 20 already owed to a sale — 80 on the shelf.
    const [batch] = await tenant.scope.select(batches, eq(batches.id, result.value.batchIds[0]!));
    expect(batch?.qtyRemainingBase).toBe(80);

    // And the crown's own arithmetic agrees the cache still matches records.
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('leaves a shortfall bigger than the delivery visible', async () => {
    const product = await createTestProduct(tenant.scope, `Partial ${uuidv7().slice(0, 6)}`, 500);
    await sellIntoPending(product.id, 50);

    const result = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 30,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: null,
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A pending row resolves whole or not at all — the hole stays visible
    // rather than being half-answered.
    expect(result.value.resolvedPendingBase).toBe(0);
    expect(result.value.stillPendingBase).toBe(50);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('a count correction resolves pending too, not only a purchase', async () => {
    const product = await createTestProduct(tenant.scope, `Counted ${uuidv7().slice(0, 6)}`, 500);
    const saleLineId = await sellIntoPending(product.id, 15);

    // W8: the shelf had it all along. Same fact as a delivery — real stock
    // accounting for units that already left.
    const result = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: 40,
      reason: 'count_correction',
      batchId: null,
      note: 'found on the top shelf',
      unitCostPaisa: 300,
      pricePerBaseUnitPaisa: 500,
      expiryDate: null,
      batchNumber: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolvedPendingBase).toBe(15);

    const [resolved] = await tenant.scope.select(
      saleLineAllocations,
      eq(saleLineAllocations.saleLineId, saleLineId),
    );
    expect(resolved?.resolvedByAdjustmentId).toBe(result.value.adjustmentId);
    expect(resolved?.resolvedByPurchaseLineId).toBeNull();
    expect(resolved?.unitCostPaisa).toBe(300);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, result.value.batchId!));
    expect(batch?.qtyRemainingBase).toBe(25);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('resolves the oldest shortfall first', async () => {
    const product = await createTestProduct(tenant.scope, `Ordered ${uuidv7().slice(0, 6)}`, 500);
    const firstLine = await sellIntoPending(product.id, 10);
    const secondLine = await sellIntoPending(product.id, 10);

    // Only enough for one of them.
    const result = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 10,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: null,
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
    });
    expect(result.ok).toBe(true);

    const [first] = await tenant.scope.select(saleLineAllocations, eq(saleLineAllocations.saleLineId, firstLine));
    const [second] = await tenant.scope.select(saleLineAllocations, eq(saleLineAllocations.saleLineId, secondLine));
    expect(first?.resolvedAt).not.toBeNull();
    expect(second?.resolvedAt).toBeNull();
  });

  it('does not touch an allocation that was never pending', async () => {
    const product = await createTestProduct(tenant.scope, `Stocked ${uuidv7().slice(0, 6)}`, 500);

    // Stock first, then sell — this allocation is born resolved.
    const stocking = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 50,
          bonusQtyBase: 0,
          unitCostPaisa: 111,
          expiryDate: null,
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
    });
    expect(stocking.ok).toBe(true);

    const saleLineId = await sellIntoPending(product.id, 10);
    const [allocation] = await tenant.scope.select(
      saleLineAllocations,
      eq(saleLineAllocations.saleLineId, saleLineId),
    );
    expect(allocation?.batchId).not.toBeNull();
    expect(allocation?.unitCostPaisa).toBe(111);

    // A later delivery must leave it exactly as it is — the SECURITY DEFINER
    // function's `batch_id IS NULL` guard is what makes that structural.
    await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 50,
          bonusQtyBase: 0,
          unitCostPaisa: 999,
          expiryDate: null,
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
    });

    const [after] = await tenant.scope.select(
      saleLineAllocations,
      eq(saleLineAllocations.saleLineId, saleLineId),
    );
    expect(after?.unitCostPaisa).toBe(111);
    expect(after?.batchId).toBe(allocation?.batchId);
  });
});

/* ------------------------------------------------------------------------ */
/* Adjustment reason integrity                                               */
/* ------------------------------------------------------------------------ */

suite('commitAdjustment against Postgres', () => {
  let tenant: TestTenant;
  let product: TestProduct;

  beforeAll(async () => {
    tenant = await provisionTestTenant('adjust');
    product = await createTestProduct(tenant.scope, `Adjusted ${uuidv7().slice(0, 6)}`, 500);
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  it('materializes a batch from opening stock (W9)', async () => {
    const result = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: 200,
      reason: 'opening_stock',
      batchId: null,
      note: null,
      unitCostPaisa: 250,
      pricePerBaseUnitPaisa: 500,
      expiryDate: '2027-12-31',
      batchNumber: 'OPEN-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [batch] = await tenant.scope.select(batches, eq(batches.id, result.value.batchId!));
    expect(batch?.source).toBe('adjustment');
    expect(batch?.sourceId).toBe(result.value.adjustmentId);
    expect(batch?.qtyRemainingBase).toBe(200);
  });

  it('reduces a named batch when stock leaves', async () => {
    const opening = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: 100,
      reason: 'opening_stock',
      batchId: null,
      note: null,
      unitCostPaisa: 250,
      pricePerBaseUnitPaisa: 500,
    });
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;

    const damaged = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: -12,
      reason: 'damage',
      batchId: opening.value.batchId,
      note: 'crushed in transit',
    });
    expect(damaged.ok).toBe(true);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, opening.value.batchId!));
    expect(batch?.qtyRemainingBase).toBe(88);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('refuses a positive damage — the sign and the reason must agree', async () => {
    const result = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: 5,
      reason: 'damage',
      batchId: null,
      note: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('reason_sign_mismatch');
  });

  it('refuses negative opening stock', async () => {
    const result = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: -5,
      reason: 'opening_stock',
      batchId: null,
      note: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('reason_sign_mismatch');
  });

  it('refuses to remove stock without naming the batch', async () => {
    const result = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: -5,
      reason: 'damage',
      batchId: null,
      note: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('batch_required');
  });

  it('refuses to drive a batch negative (Phase 5 invariant 2)', async () => {
    const opening = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: 10,
      reason: 'opening_stock',
      batchId: null,
      note: null,
      unitCostPaisa: 250,
      pricePerBaseUnitPaisa: 500,
    });
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;

    const result = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: -50,
      reason: 'damage',
      batchId: opening.value.batchId,
      note: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('stale_batch_state');

    // And the batch is untouched, because the whole thing was one transaction.
    const [batch] = await tenant.scope.select(batches, eq(batches.id, opening.value.batchId!));
    expect(batch?.qtyRemainingBase).toBe(10);
  });

  it('applies a re-submitted adjustment exactly once', async () => {
    const opening = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: 60,
      reason: 'opening_stock',
      batchId: null,
      note: null,
      unitCostPaisa: 250,
      pricePerBaseUnitPaisa: 500,
    });
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;

    const command = {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: -10,
      reason: 'damage' as const,
      batchId: opening.value.batchId,
      note: null,
    };

    await commitAdjustment(tenant.scope, command);
    const second = await commitAdjustment(tenant.scope, command);
    expect(second.ok && second.value.alreadyCommitted).toBe(true);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, opening.value.batchId!));
    expect(batch?.qtyRemainingBase).toBe(50);
  });
});

/* ------------------------------------------------------------------------ */
/* The privilege boundary itself                                             */
/* ------------------------------------------------------------------------ */

const immutability = process.env.DATABASE_URL && process.env.APP_DB_ROLE ? describe : describe.skip;

immutability('allocation resolution is the only way an allocation changes', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('privilege');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  it('the application role still cannot UPDATE sale_line_allocations directly', async () => {
    const product = await createTestProduct(tenant.scope, `Guarded ${uuidv7().slice(0, 6)}`, 500);
    const lineId = uuidv7();
    await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId: null,
      lines: [
        {
          lineId,
          productId: product.id,
          qtyBase: 5,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 2_500,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    // Migration 0003 grants EXECUTE on one function; it does not grant UPDATE.
    // If this ever stops throwing, ADR-1 has quietly become a convention again.
    await expect(
      tenant.scope.update(saleLineAllocations, { qtyBase: 999 }, eq(saleLineAllocations.saleLineId, lineId)),
    ).rejects.toThrow();

    // The sale line is likewise still beyond reach.
    await expect(
      tenant.scope.update(saleLines, { qtyBase: 999 }, eq(saleLines.id, lineId)),
    ).rejects.toThrow();
  });
});
