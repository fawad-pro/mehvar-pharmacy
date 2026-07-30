/**
 * Sync idempotency and ingestion equivalence — Phase 11 §3.3, ADR-3, ADR-5.
 *
 *   "Replaying the same client-ID batch N times = exactly-once effects."
 *   "Ingestion equivalence: an offline-origin sale produces byte-equivalent
 *    domain effects to an online one." (Phase 13, Day 5)
 *
 * Against a real database, because both claims are about what lands in
 * Postgres. A mocked test of idempotency proves the mock is idempotent.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ingestBatch, type IngestibleRecord } from '@/domain/sync/ingest';
import type { SaleCommand } from '@/domain/sales/commit-sale';
import { customerBalance } from '@/db/udhaar-queries';
import { batches, payments, products, saleLineAllocations, saleLines, sales } from '@/db/schema';
import { verifyBatches } from '@/domain/inventory/rebuild';
import { uuidv7 } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestCustomer,
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

let receiptCounter = 0;
function nextReceipt(): string {
  receiptCounter += 1;
  return `S-${receiptCounter}`;
}

suite('sync ingestion', () => {
  let tenant: TestTenant;
  let product: TestProduct;
  let customerId: string;

  beforeAll(async () => {
    tenant = await provisionTestTenant('ingest');
    product = await createTestProduct(tenant.scope, `Ingest ${uuidv7().slice(0, 6)}`, 500);
    await addOpeningStock(tenant.scope, product.id, 1_000);
    customerId = await createTestCustomer(tenant.scope, `Ingest customer ${uuidv7().slice(0, 6)}`);
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  function saleRecord(overrides: Partial<SaleCommand> = {}): IngestibleRecord {
    const qtyBase = overrides.lines?.[0]?.qtyBase ?? 4;
    const total = 500 * qtyBase;
    return {
      kind: 'sale',
      command: {
        saleId: uuidv7(),
        receiptNumber: nextReceipt(),
        customerId: null,
        lines: [
          {
            lineId: uuidv7(),
            productId: product.id,
            qtyBase,
            enteredUnitLevel: 'tab',
            unitPricePaisa: 500,
            lineDiscountPaisa: 0,
            priceOverridden: false,
          },
        ],
        invoiceDiscountPaisa: 0,
        cashPaisa: total,
        creditPaisa: 0,
        changePaisa: 0,
        origin: 'offline_sync',
        clientSchemaVersion: 1,
        clientCommittedAt: new Date(),
        ...overrides,
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Phase 11 §3.3 — replay N times = exactly-once effects                   */
  /* ---------------------------------------------------------------------- */

  it('delivers a batch five times and commits it once', async () => {
    const batch = [saleRecord(), saleRecord()];
    const saleIds = batch.map((record) =>
      record.kind === 'sale' ? record.command.saleId : '',
    );

    const [beforeRow] = await tenant.scope.select(batches, eq(batches.productId, product.id));
    const before = beforeRow?.qtyRemainingBase ?? 0;

    for (let delivery = 0; delivery < 5; delivery += 1) {
      const report = await ingestBatch(tenant.scope, batch);
      expect(report.complete, `delivery ${delivery + 1} did not complete`).toBe(true);
      expect(report.outcomes.every((outcome) => outcome.status === 'synced')).toBe(true);
    }

    // One sale row, one set of lines, one set of allocations — per sale, once.
    for (const saleId of saleIds) {
      expect(await tenant.scope.select(sales, eq(sales.id, saleId))).toHaveLength(1);
      expect(await tenant.scope.select(saleLines, eq(saleLines.saleId, saleId))).toHaveLength(1);
    }

    // And stock moved exactly twice four units, not ten times.
    const [after] = await tenant.scope.select(batches, eq(batches.productId, product.id));
    expect(before - (after?.qtyRemainingBase ?? 0)).toBe(8);

    // The crown's own check agrees the cache still matches the records.
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('replays a settlement without paying the balance down twice', async () => {
    const record: IngestibleRecord = {
      kind: 'settlement',
      command: {
        paymentId: uuidv7(),
        receiptNumber: nextReceipt(),
        customerId,
        amountPaisa: 2_500,
        origin: 'offline_sync',
        clientSchemaVersion: 1,
        clientCommittedAt: new Date(),
      },
    };

    const before = await customerBalance(tenant.scope, customerId);
    for (let delivery = 0; delivery < 3; delivery += 1) {
      expect((await ingestBatch(tenant.scope, [record])).complete).toBe(true);
    }

    expect(await customerBalance(tenant.scope, customerId)).toBe(before - 2_500);
    expect(
      await tenant.scope.select(payments, eq(payments.id, record.command.paymentId)),
    ).toHaveLength(1);
  });

  it('replays a quick item without creating a second product', async () => {
    const id = uuidv7();
    const record: IngestibleRecord = {
      kind: 'quick_item',
      command: { id, name: 'Shelf item', pricePaisa: 4_500, baseUnitName: 'item' },
    };

    for (let delivery = 0; delivery < 3; delivery += 1) {
      expect((await ingestBatch(tenant.scope, [record])).complete).toBe(true);
    }

    const rows = await tenant.scope.select(products, eq(products.id, id));
    expect(rows).toHaveLength(1);
    // D3 — a quick item is a real product that cannot be silently forgotten.
    expect(rows[0]?.needsCompletion).toBe(true);
    expect(rows[0]?.name).toBe('Shelf item');
  });

  it('replays a customer without creating a duplicate', async () => {
    const id = uuidv7();
    const record: IngestibleRecord = {
      kind: 'customer',
      command: { id, name: 'Walk-in Sahib', phone: null },
    };

    for (let delivery = 0; delivery < 3; delivery += 1) {
      expect((await ingestBatch(tenant.scope, [record])).complete).toBe(true);
    }
    expect(await customerBalance(tenant.scope, id)).toBe(0);
  });

  /* ---------------------------------------------------------------------- */
  /* Day 5 — ingestion equivalence                                           */
  /* ---------------------------------------------------------------------- */

  it('produces the same domain effects for an offline-origin sale as an online one', async () => {
    const online = saleRecord({ origin: 'online' });
    const offline = saleRecord({ origin: 'offline_sync' });

    expect((await ingestBatch(tenant.scope, [online])).complete).toBe(true);
    expect((await ingestBatch(tenant.scope, [offline])).complete).toBe(true);

    const onlineId = online.kind === 'sale' ? online.command.saleId : '';
    const offlineId = offline.kind === 'sale' ? offline.command.saleId : '';

    const [onlineRow] = await tenant.scope.select(sales, eq(sales.id, onlineId));
    const [offlineRow] = await tenant.scope.select(sales, eq(sales.id, offlineId));

    // Everything a report derives from is identical; `origin` is the single
    // column that differs, and it exists precisely so the owner can tell them
    // apart (ADR-3's late-sync surfacing).
    expect(onlineRow?.origin).toBe('online');
    expect(offlineRow?.origin).toBe('offline_sync');
    expect(offlineRow?.subtotalPaisa).toBe(onlineRow?.subtotalPaisa);
    expect(offlineRow?.totalPaisa).toBe(onlineRow?.totalPaisa);
    expect(offlineRow?.cashPaisa).toBe(onlineRow?.cashPaisa);
    expect(offlineRow?.creditPaisa).toBe(onlineRow?.creditPaisa);
    expect(offlineRow?.createdBy).toBe(onlineRow?.createdBy);

    // Including the part ADR-5 is actually about: allocation happened
    // server-side, the same way, for both.
    const onlineLines = await tenant.scope.select(saleLines, eq(saleLines.saleId, onlineId));
    const offlineLines = await tenant.scope.select(saleLines, eq(saleLines.saleId, offlineId));
    const allocationsFor = async (lineId: string) =>
      tenant.scope.select(saleLineAllocations, eq(saleLineAllocations.saleLineId, lineId));

    const onlineAllocations = await allocationsFor(onlineLines[0]?.id ?? '');
    const offlineAllocations = await allocationsFor(offlineLines[0]?.id ?? '');

    expect(offlineAllocations).toHaveLength(onlineAllocations.length);
    expect(offlineAllocations[0]?.batchId).toBe(onlineAllocations[0]?.batchId);
    expect(offlineAllocations[0]?.qtyBase).toBe(onlineAllocations[0]?.qtyBase);
    expect(offlineAllocations[0]?.unitCostPaisa).toBe(onlineAllocations[0]?.unitCostPaisa);
  });

  /* ---------------------------------------------------------------------- */
  /* Delivery ordering and failure handling                                  */
  /* ---------------------------------------------------------------------- */

  it('creates a quick item before the sale that references it, in one batch', async () => {
    const productId = uuidv7();
    const batch: IngestibleRecord[] = [
      {
        kind: 'quick_item',
        command: { id: productId, name: 'Ordered item', pricePaisa: 300, baseUnitName: 'item' },
      },
      {
        kind: 'sale',
        command: {
          saleId: uuidv7(),
          receiptNumber: nextReceipt(),
          customerId: null,
          lines: [
            {
              lineId: uuidv7(),
              productId,
              qtyBase: 2,
              enteredUnitLevel: 'item',
              unitPricePaisa: 300,
              lineDiscountPaisa: 0,
              priceOverridden: false,
            },
          ],
          invoiceDiscountPaisa: 0,
          cashPaisa: 600,
          creditPaisa: 0,
          changePaisa: 0,
          origin: 'offline_sync',
          clientSchemaVersion: 1,
          clientCommittedAt: new Date(),
        },
      },
    ];

    // This is the whole reason delivery is FIFO: the sale's foreign key only
    // resolves because the quick item went first.
    const report = await ingestBatch(tenant.scope, batch);
    expect(report.complete).toBe(true);

    // The sale outran stock the product never had, which is D2 working exactly
    // as designed rather than a failure — the pending layer records it.
    const [row] = await tenant.scope.select(products, eq(products.id, productId));
    expect(row?.needsCompletion).toBe(true);
  });

  it('stops the batch at the first failure and reports what landed', async () => {
    const good = saleRecord();
    // cash + credit must equal the total (Phase 5 invariant 4), so this one
    // cannot be stored no matter how many times it is delivered.
    const bad = saleRecord({ cashPaisa: 1, creditPaisa: 0 });
    const afterBad = saleRecord();

    const report = await ingestBatch(tenant.scope, [good, bad, afterBad]);

    expect(report.complete).toBe(false);
    expect(report.outcomes).toHaveLength(2);
    expect(report.outcomes[0]?.status).toBe('synced');
    expect(report.outcomes[1]?.status).toBe('rejected');
    expect(report.outcomes[1]?.reason).toBe('split_mismatch');

    // The record behind the failure was never attempted, so it stays in the
    // counter's outbox in its original position.
    const untouchedId = afterBad.kind === 'sale' ? afterBad.command.saleId : '';
    expect(await tenant.scope.select(sales, eq(sales.id, untouchedId))).toHaveLength(0);
  });

  it('reports a taken receipt number as re-mintable rather than as a rejection', async () => {
    const receiptNumber = nextReceipt();
    const first = saleRecord({ receiptNumber });
    expect((await ingestBatch(tenant.scope, [first])).complete).toBe(true);

    // A different sale claiming a number already on the books — two devices
    // sharing a prefix, or a restored backup (Phase 9 §3).
    const collision = saleRecord({ receiptNumber });
    const report = await ingestBatch(tenant.scope, [collision]);

    expect(report.outcomes[0]?.status).toBe('receipt_taken');
  });
});
