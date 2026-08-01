/**
 * `commitReturn` against Postgres — W4's transaction semantics: restock to a
 * named batch, write-off when there is none, cash-out vs. credit reduction as
 * a compensating record (T2), and idempotency on the client id.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { commitReturn, type ReturnCommand } from '@/domain/sales/commit-return';
import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { verifyBatches } from '@/domain/inventory/rebuild';
import { customerBalance } from '@/db/udhaar-queries';
import { batches, saleReturnLines, saleReturns } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestCustomer,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

let receiptCounter = 0;
function nextReceipt(): string {
  receiptCounter += 1;
  return `R-${receiptCounter}`;
}

suite('commitReturn against Postgres', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('return');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  /** A fresh product per test — a return checks a specific batch's quantity,
   * and FEFO selects across every batch a product has, so sharing one product
   * across tests would let an earlier test's leftover stock decide which
   * batch a later test's sale actually consumed. */
  async function freshProduct(): Promise<{ id: string }> {
    return createTestProduct(tenant.scope, `Returned ${uuidv7().slice(0, 6)}`, 500);
  }

  /** A cash sale of `qty` units at 500 paisa each, against real stock. */
  async function sellCash(
    productId: string,
    qty: number,
    opts: { customerId?: string | null; creditPaisa?: number; cashPaisa?: number } = {},
  ): Promise<{ saleId: string; lineId: string }> {
    const saleId = uuidv7();
    const lineId = uuidv7();
    const command: SaleCommand = {
      saleId,
      receiptNumber: nextReceipt(),
      customerId: opts.customerId ?? null,
      lines: [
        {
          lineId,
          productId,
          qtyBase: qty,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: opts.cashPaisa ?? 500 * qty,
      creditPaisa: opts.creditPaisa ?? 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    };
    const result = await commitSale(tenant.scope, command);
    expect(result.ok).toBe(true);
    return { saleId, lineId };
  }

  it('restores stock to the named batch and pays cash out', async () => {
    const product = await freshProduct();
    const batchId = await addOpeningStock(tenant.scope, product.id, 100, { pricePaisa: 500 });
    const { saleId, lineId } = await sellCash(product.id, 20);

    const [beforeBatch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(beforeBatch?.qtyRemainingBase).toBe(80);

    const command: ReturnCommand = {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 5, restockBatchId: batchId }],
      refundMethod: 'cash',
      reasonNote: 'customer changed their mind',
    };
    const result = await commitReturn(tenant.scope, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cashOutPaisa).toBe(2_500);
    expect(result.value.creditReducedPaisa).toBe(0);

    const [afterBatch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(afterBatch?.qtyRemainingBase).toBe(85);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('write-offs a line with no batch — nothing restocks', async () => {
    const product = await freshProduct();
    const batchId = await addOpeningStock(tenant.scope, product.id, 50, { pricePaisa: 500 });
    const { saleId, lineId } = await sellCash(product.id, 10);

    const command: ReturnCommand = {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 4, restockBatchId: null }],
      refundMethod: 'cash',
      reasonNote: 'damaged on return',
    };
    const result = await commitReturn(tenant.scope, command);
    expect(result.ok).toBe(true);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    // 50 stocked, 10 sold, 0 restocked — the write-off leaves the shelf as it was.
    expect(batch?.qtyRemainingBase).toBe(40);
  });

  it('reduces the customer’s credit instead of paying cash', async () => {
    const product = await freshProduct();
    const customerId = await createTestCustomer(tenant.scope, 'Udhaar Customer');
    const batchId = await addOpeningStock(tenant.scope, product.id, 30, { pricePaisa: 500 });
    const { saleId, lineId } = await sellCash(product.id, 10, {
      customerId,
      cashPaisa: 0,
      creditPaisa: 5_000,
    });

    const balanceBefore = await customerBalance(tenant.scope, customerId);
    expect(balanceBefore).toBe(5_000);

    const command: ReturnCommand = {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 3, restockBatchId: batchId }],
      refundMethod: 'credit',
      reasonNote: null,
    };
    const result = await commitReturn(tenant.scope, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.creditReducedPaisa).toBe(1_500);
    expect(result.value.cashOutPaisa).toBe(0);

    const balanceAfter = await customerBalance(tenant.scope, customerId);
    expect(balanceAfter).toBe(3_500);
  });

  it('refuses a credit refund against a cash sale with no customer', async () => {
    const product = await freshProduct();
    await addOpeningStock(tenant.scope, product.id, 20, { pricePaisa: 500 });
    const { saleId, lineId } = await sellCash(product.id, 5);

    const result = await commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 1, restockBatchId: null }],
      refundMethod: 'credit',
      reasonNote: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('credit_requires_customer');
  });

  it('refuses to return more than was sold, including across two returns', async () => {
    const product = await freshProduct();
    await addOpeningStock(tenant.scope, product.id, 20, { pricePaisa: 500 });
    const { saleId, lineId } = await sellCash(product.id, 5);

    const first = await commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 3, restockBatchId: null }],
      refundMethod: 'cash',
      reasonNote: null,
    });
    expect(first.ok).toBe(true);

    const second = await commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 3, restockBatchId: null }],
      refundMethod: 'cash',
      reasonNote: null,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('exceeds_sold_quantity');
  });

  it('processes a re-submitted return exactly once', async () => {
    const product = await freshProduct();
    const batchId = await addOpeningStock(tenant.scope, product.id, 20, { pricePaisa: 500 });
    const { saleId, lineId } = await sellCash(product.id, 5);

    const command: ReturnCommand = {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 2, restockBatchId: batchId }],
      refundMethod: 'cash',
      reasonNote: null,
    };

    const first = await commitReturn(tenant.scope, command);
    const second = await commitReturn(tenant.scope, command);
    expect(first.ok && !first.value.alreadyCommitted).toBe(true);
    expect(second.ok && second.value.alreadyCommitted).toBe(true);

    expect(
      await tenant.scope.select(saleReturnLines, eq(saleReturnLines.saleReturnId, command.returnId)),
    ).toHaveLength(1);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    // Restocked once, not twice.
    expect(batch?.qtyRemainingBase).toBe(17);
  });

  it('carries the receipt number, sharing the sale/settlement sequence', async () => {
    const product = await freshProduct();
    await addOpeningStock(tenant.scope, product.id, 20, { pricePaisa: 500 });
    const { saleId, lineId } = await sellCash(product.id, 5);
    const receiptNumber = nextReceipt();

    const result = await commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId,
      receiptNumber,
      lines: [{ saleLineId: lineId, qtyBase: 1, restockBatchId: null }],
      refundMethod: 'cash',
      reasonNote: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await tenant.scope.select(saleReturns, eq(saleReturns.id, result.value.returnId));
    expect(row?.receiptNumber).toBe(receiptNumber);
  });
});
