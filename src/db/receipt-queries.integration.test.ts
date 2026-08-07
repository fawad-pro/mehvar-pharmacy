/**
 * The receipts surface against a real database.
 *
 * The list merges three tables in TypeScript rather than a SQL `UNION`, so the
 * ordering and the per-kind interleaving are only true if the rows really come
 * back that way — a fake would prove nothing about either.
 *
 * These are behavioural assertions: they pin what the screens show, and they
 * pass against a correlated subquery or a grouped aggregate alike. The rendering
 * difference between those two is pinned separately, in
 * `drizzle-correlated-subquery.test.ts`, because it is a property of the query
 * builder rather than of this feature.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { commitReturn } from '@/domain/sales/commit-return';
import { commitSale } from '@/domain/sales/commit-sale';
import { commitSettlement } from '@/domain/udhaar/commit-settlement';
import { findReceipt, listReceipts } from '@/db/receipt-queries';
import { uuidv7 } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestCustomer,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

let counter = 0;
function nextReceipt(): string {
  counter += 1;
  return `R-${counter}`;
}

suite('receipt queries against Postgres', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('receipts');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  it('finds a cash sale by the number printed on the slip, with its lines', async () => {
    const product = await createTestProduct(tenant.scope, `Slip ${uuidv7().slice(0, 6)}`, 500);
    await addOpeningStock(tenant.scope, product.id, 50, { pricePaisa: 500 });

    const receiptNumber = nextReceipt();
    await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber,
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 4,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 2_000,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    const receipt = await findReceipt(tenant.scope, receiptNumber);
    expect(receipt?.kind).toBe('sale');
    expect(receipt?.totalPaisa).toBe(2_000);
    expect(receipt?.lines).toHaveLength(1);
    expect(receipt?.lines?.[0]?.qtyBase).toBe(4);
    // Nothing has come back yet.
    expect(receipt?.lines?.[0]?.returnedBase).toBe(0);
    expect(receipt?.returns).toEqual([]);
  });

  it('shows on the sale how much of each line came back', async () => {
    const product = await createTestProduct(tenant.scope, `Back ${uuidv7().slice(0, 6)}`, 500);
    const batchId = await addOpeningStock(tenant.scope, product.id, 50, { pricePaisa: 500 });

    const saleReceipt = nextReceipt();
    const saleId = uuidv7();
    const lineId = uuidv7();
    await commitSale(tenant.scope, {
      saleId,
      receiptNumber: saleReceipt,
      customerId: null,
      lines: [
        {
          lineId,
          productId: product.id,
          qtyBase: 10,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 5_000,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    const returnReceipt = nextReceipt();
    await commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId,
      receiptNumber: returnReceipt,
      lines: [{ saleLineId: lineId, qtyBase: 3, restockBatchId: batchId }],
      refundMethod: 'cash',
      reasonNote: 'Wrong strength',
    });

    const sale = await findReceipt(tenant.scope, saleReceipt);
    expect(sale?.lines?.[0]?.returnedBase).toBe(3);
    expect(sale?.returns).toHaveLength(1);
    expect(sale?.returns?.[0]?.receiptNumber).toBe(returnReceipt);

    // And the return reads as its own receipt, pointing back at the sale — the
    // two records are one story from either end.
    const back = await findReceipt(tenant.scope, returnReceipt);
    expect(back?.kind).toBe('return');
    expect(back?.againstReceiptNumber).toBe(saleReceipt);
    expect(back?.cashOutPaisa).toBe(1_500);
    expect(back?.reasonNote).toBe('Wrong strength');
  });

  it('finds a standalone settlement by its number, from the same sequence', async () => {
    const customerId = await createTestCustomer(tenant.scope, `Payer ${uuidv7().slice(0, 6)}`);
    const receiptNumber = nextReceipt();

    await commitSettlement(tenant.scope, {
      paymentId: uuidv7(),
      receiptNumber,
      customerId,
      amountPaisa: 7_500,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    const receipt = await findReceipt(tenant.scope, receiptNumber);
    expect(receipt?.kind).toBe('settlement');
    expect(receipt?.amountPaisa).toBe(7_500);
    // A settlement has no lines (W3) — the shape is shared, the contents are not.
    expect(receipt?.lines).toBeUndefined();
  });

  it('returns null for a number that is not a receipt, rather than throwing', async () => {
    expect(await findReceipt(tenant.scope, 'NOPE-9999')).toBeNull();
    expect(await findReceipt(tenant.scope, '   ')).toBeNull();
  });

  it('lists all three kinds together, newest first', async () => {
    const page = await listReceipts(tenant.scope, { limit: 100 });

    const kinds = new Set(page.items.map((row) => row.kind));
    expect(kinds.has('sale')).toBe(true);
    expect(kinds.has('settlement')).toBe(true);
    expect(kinds.has('return')).toBe(true);

    // The merge is only correct if the interleaving really is by time.
    const times = page.items.map((row) => row.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('marks a sale that has been returned against, and leaves the others alone', async () => {
    const page = await listReceipts(tenant.scope, { limit: 100 });
    const sales = page.items.filter((row) => row.kind === 'sale');

    expect(sales.some((row) => row.hasReturns)).toBe(true);
    expect(sales.some((row) => !row.hasReturns)).toBe(true);

    // Settlements and returns are not sales and never carry the flag.
    for (const row of page.items.filter((entry) => entry.kind !== 'sale')) {
      expect(row.hasReturns).toBe(false);
    }
  });

  it('searches by receipt number', async () => {
    const all = await listReceipts(tenant.scope, { limit: 100 });
    const target = all.items[0];
    expect(target).toBeDefined();

    const found = await listReceipts(tenant.scope, { search: target!.receiptNumber });
    expect(found.items.some((row) => row.receiptNumber === target!.receiptNumber)).toBe(true);
  });

  it('searches by customer name', async () => {
    const name = `Findable ${uuidv7().slice(0, 6)}`;
    const customerId = await createTestCustomer(tenant.scope, name);
    await commitSettlement(tenant.scope, {
      paymentId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId,
      amountPaisa: 1_000,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    const found = await listReceipts(tenant.scope, { search: name });
    expect(found.items).toHaveLength(1);
    expect(found.items[0]?.customerName).toBe(name);
  });
});
