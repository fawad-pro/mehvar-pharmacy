/**
 * REBUILD EQUIVALENCE — the crown (Phase 11 §3.1, ADR-8, Phase 5 invariant 6).
 *
 *   "Seed randomized event sequences (property-style: purchases, sales incl.
 *    offline-origin, returns, adjustments, settlements) → assert `qty_remaining`
 *    rebuild matches live values and every Phase 5 §5 invariant holds. This one
 *    suite guards the entire trust promise."
 *
 * The product sells one thing above all others: that its numbers can be
 * believed. That promise reduces to a single testable claim — invariant 6:
 *
 *   "Derived figures are reproducible from records alone — dropping every cache
 *    and recomputing changes nothing."
 *
 * The system keeps exactly one cache (`batches.qty_remaining`, ADR-8) and the
 * only justification for keeping it is that this suite can prove it right after
 * an arbitrary history. So the shape here is deliberate: rather than assert
 * hand-picked scenarios, generate long randomized histories through the real
 * writers against a real database, then recompute from records and demand
 * agreement.
 *
 * Failures are reproducible: every run prints its seed, and the same seed
 * replays the same history exactly.
 *
 * ## Scope today, and what extends it
 *
 * Day 3 has sales (online and offline-origin, including replays), opening-stock
 * adjustments, and stock adjustments. Purchases arrive on Day 6 and returns on
 * Day 7; each must add its event kind to `applyRandomEvent` below rather than
 * get its own separate suite — the whole point is that one history mixes
 * everything.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { adjustments, batches, saleLineAllocations, saleLines, sales } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

import {
  addOpeningStock,
  between,
  createTestProduct,
  pick,
  provisionTestTenant,
  seededRandom,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';
import { derivedStock, rebuildQuantity, verifyBatches } from './rebuild';
import { batchLedger } from '@/db/sales-queries';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

/** Deterministic by default; override to reproduce a reported failure. */
const SEED = Number(process.env.REBUILD_SEED ?? 20260730);
const HISTORIES = Number(process.env.REBUILD_HISTORIES ?? 4);
const EVENTS_PER_HISTORY = Number(process.env.REBUILD_EVENTS ?? 40);

interface World {
  tenant: TestTenant;
  products: TestProduct[];
  random: () => number;
  /** Every sale command issued, so replays can be produced from real history. */
  issued: SaleCommand[];
  /**
   * Receipt counter for this history.
   *
   * A counter, not a timestamp: receipt numbers derived from a clock collide
   * when two sales land in the same millisecond, which the unique index on
   * (tenant_id, receipt_number) rightly refuses. The real scheme is a
   * per-device counter for exactly this reason (Phase 9 §3).
   */
  receiptCounter: number;
}

/**
 * One random event against the world.
 *
 * The mix is chosen so the interesting states actually occur: shortfalls that
 * create pending allocations, multi-batch consumption, replays, and adjustments
 * against specific batches. A generator that only ever sold within stock would
 * pass while proving nothing about D2.
 */
async function applyRandomEvent(world: World): Promise<void> {
  const { random, tenant } = world;
  const roll = random();

  if (roll < 0.14) {
    // New stock arrives as an opening/count batch. (Day 6 replaces this with a
    // real purchase; the ledger arithmetic is the same shape.)
    const product = pick(random, world.products);
    await addOpeningStock(tenant.scope, product.id, between(random, 5, 200), {
      expiryDate: pick(random, ['2026-09-01', '2027-01-01', '2027-06-01', null]),
      unitCostPaisa: between(random, 100, 500),
      pricePaisa: product.pricePaisa,
    });
    return;
  }

  if (roll < 0.24) {
    // A negative adjustment against a specific batch: damage or a write-off.
    const stocked = await tenant.scope.select(batches);
    const withStock = stocked.filter((batch) => batch.qtyRemainingBase > 0);
    if (withStock.length === 0) {
      return;
    }
    const batch = pick(random, withStock);
    const delta = -between(random, 1, Math.min(batch.qtyRemainingBase, 20));

    await tenant.scope.insert(adjustments, {
      id: uuidv7(),
      productId: batch.productId,
      batchId: batch.id,
      qtyBaseDelta: delta,
      reason: pick(random, ['damage', 'expiry_writeoff', 'distributor_return'] as const),
      note: null,
    });
    // The adjustment is the record; the cache must follow it in the same breath,
    // exactly as a real adjustment writer will on Day 6.
    await tenant.scope.update(
      batches,
      { qtyRemainingBase: batch.qtyRemainingBase + delta },
      eq(batches.id, batch.id),
    );
    return;
  }

  if (roll < 0.32 && world.issued.length > 0) {
    // A replay: sync delivering a sale the server already has (ADR-3).
    const earlier = pick(random, world.issued);
    await commitSale(tenant.scope, earlier);
    return;
  }

  // A sale. Quantities deliberately overshoot available stock sometimes, so the
  // pending layer is exercised rather than assumed.
  const lineCount = between(random, 1, 3);
  const lines = Array.from({ length: lineCount }, () => {
    const product = pick(random, world.products);
    return {
      lineId: uuidv7(),
      productId: product.id,
      qtyBase: between(random, 1, 60),
      enteredUnitLevel: pick(random, ['tab', 'strip']),
      unitPricePaisa: product.pricePaisa,
      lineDiscountPaisa: random() < 0.2 ? between(random, 1, 100) : 0,
      priceOverridden: random() < 0.1,
    };
  });

  const subtotal = lines.reduce(
    (sum, line) => sum + Math.max(0, line.unitPricePaisa * line.qtyBase - line.lineDiscountPaisa),
    0,
  );
  const invoiceDiscount = random() < 0.2 ? Math.min(subtotal, between(random, 1, 200)) : 0;
  const total = subtotal - invoiceDiscount;

  const command: SaleCommand = {
    saleId: uuidv7(),
    receiptNumber: `A-${(world.receiptCounter += 1)}`,
    customerId: null,
    lines,
    invoiceDiscountPaisa: invoiceDiscount,
    cashPaisa: total,
    creditPaisa: 0,
    changePaisa: 0,
    origin: random() < 0.3 ? 'offline_sync' : 'online',
    clientSchemaVersion: 1,
    clientCommittedAt: new Date(),
  };

  const result = await commitSale(tenant.scope, command);
  if (result.ok) {
    world.issued.push(command);
  }
}

/**
 * Every Phase 5 §5 invariant that Day 3's event kinds can violate.
 *
 * Asserted after each history rather than at the end of the suite, so a failure
 * names the history that produced it.
 */
async function assertInvariants(world: World, label: string): Promise<void> {
  const { tenant } = world;

  /* Invariant 6 / ADR-8 — the crown. Recompute from records; demand agreement. */
  const report = await verifyBatches(tenant.scope);
  if (report.mismatches.length > 0) {
    const ledger = await batchLedger(tenant.scope);
    const detail = ledger.filter((row) => report.mismatches.some((m) => m.batchId === row.batchId));
    throw new Error(
      `${label}: qty_remaining disagrees with the records\n` +
        JSON.stringify(
          { mismatches: report.mismatches.slice(0, 3), ledger: detail.slice(0, 3) },
          null,
          2,
        ),
    );
  }

  /* Invariant 2 — batch quantity ≥ 0; the pending layer is the only construct
     that may represent unresolved negative consumption. */
  expect(report.negativeBatches, `${label}: a batch went negative`).toEqual([]);

  /* Invariant 1 — product stock is derivable. Compared against an independent
     recomputation from the ledger, so the two paths must agree. */
  const derived = await derivedStock(tenant.scope);
  const ledger = await batchLedger(tenant.scope);
  const fromLedger = new Map<string, number>();
  for (const row of ledger) {
    fromLedger.set(row.productId, (fromLedger.get(row.productId) ?? 0) + rebuildQuantity(row));
  }
  for (const [productId, expected] of fromLedger) {
    const pending = report.pendingByProduct[productId] ?? 0;
    expect(derived.get(productId), `${label}: derived stock for ${productId}`).toBe(
      expected - pending,
    );
  }

  /* Invariant 4 — sale total = Σ line totals − invoice discount, and
     cash + credit = total, exactly. */
  const allSales = await tenant.scope.select(sales);
  const allLines = await tenant.scope.select(saleLines);
  const linesBySale = new Map<string, typeof allLines>();
  for (const line of allLines) {
    linesBySale.set(line.saleId, [...(linesBySale.get(line.saleId) ?? []), line]);
  }

  for (const sale of allSales) {
    const own = linesBySale.get(sale.id) ?? [];
    const subtotal = own.reduce(
      (sum, line) => sum + Math.max(0, line.unitPricePaisa * line.qtyBase - line.lineDiscountPaisa),
      0,
    );
    expect(sale.subtotalPaisa, `${label}: subtotal of ${sale.receiptNumber}`).toBe(subtotal);
    expect(sale.totalPaisa, `${label}: total of ${sale.receiptNumber}`).toBe(
      subtotal - sale.invoiceDiscountPaisa,
    );
    expect(sale.cashPaisa + sale.creditPaisa, `${label}: split of ${sale.receiptNumber}`).toBe(
      sale.totalPaisa,
    );
  }

  /* Every sale line is fully allocated: Σ allocation quantities equals the line
     quantity, whether the units came from batches or from the pending layer.
     This is what makes negative stock *visible* rather than lost — an
     under-allocated line would simply vanish from the ledger. */
  const allocations = await tenant.scope.select(saleLineAllocations);
  const byLine = new Map<string, number>();
  for (const allocation of allocations) {
    byLine.set(
      allocation.saleLineId,
      (byLine.get(allocation.saleLineId) ?? 0) + allocation.qtyBase,
    );
  }
  for (const line of allLines) {
    expect(byLine.get(line.id) ?? 0, `${label}: allocation total for line ${line.id}`).toBe(
      line.qtyBase,
    );
  }

  /* Invariant 5 — every record is attributed. */
  for (const sale of allSales) {
    expect(sale.createdBy, `${label}: attribution on ${sale.receiptNumber}`).toBe(tenant.userId);
  }

  /* A pending allocation carries no cost until it resolves (Phase 9 §3). */
  for (const allocation of allocations) {
    if (allocation.batchId === null) {
      expect(allocation.unitCostPaisa, `${label}: pending row carries a cost`).toBeNull();
    }
  }
}

suite('rebuild equivalence — randomized histories', () => {
  const worlds: TestTenant[] = [];

  afterAll(async () => {
    for (const tenant of worlds) {
      await tenant.cleanup();
    }
  });

  for (let history = 0; history < HISTORIES; history += 1) {
    const seed = SEED + history * 7919;

    it(`holds every invariant after ${EVENTS_PER_HISTORY} random events (seed ${seed})`, async () => {
      const tenant = await provisionTestTenant(`rb${history}`);
      worlds.push(tenant);

      const random = seededRandom(seed);
      const products: TestProduct[] = [];
      for (let index = 0; index < 5; index += 1) {
        products.push(
          await createTestProduct(
            tenant.scope,
            `Product ${index} ${uuidv7().slice(0, 6)}`,
            between(random, 100, 900),
          ),
        );
      }
      // Some products start stocked and some empty, so early sales genuinely go
      // pending rather than every history beginning comfortably.
      for (const product of products.slice(0, 3)) {
        await addOpeningStock(tenant.scope, product.id, between(random, 20, 150));
      }

      const world: World = { tenant, products, random, issued: [], receiptCounter: 0 };

      for (let event = 0; event < EVENTS_PER_HISTORY; event += 1) {
        await applyRandomEvent(world);
        // Checked continuously, not only at the end: a violation that appears
        // and is later masked by another event is exactly the kind of bug a
        // final-state-only assertion misses.
        if (event % 10 === 9) {
          await assertInvariants(world, `seed ${seed}, after event ${event + 1}`);
        }
      }

      await assertInvariants(world, `seed ${seed}, final`);

      // The history has to have been interesting, or the suite is theatre.
      const report = await verifyBatches(tenant.scope);
      expect(report.batchesChecked).toBeGreaterThan(0);
      expect(world.issued.length).toBeGreaterThan(5);
    });
  }

  it('detects a mismatch when one is introduced — the verifier can actually fail', async () => {
    // A verifier that never fires is indistinguishable from a verifier that
    // cannot. This corrupts the cache directly (the one write the app role is
    // permitted) and requires the report to notice.
    const tenant = await provisionTestTenant('rb-detect');
    worlds.push(tenant);

    const product = await createTestProduct(tenant.scope, `Detect ${uuidv7().slice(0, 6)}`);
    const batchId = await addOpeningStock(tenant.scope, product.id, 100);

    expect((await verifyBatches(tenant.scope)).ok).toBe(true);

    await tenant.scope.update(batches, { qtyRemainingBase: 93 }, eq(batches.id, batchId));

    const report = await verifyBatches(tenant.scope);
    expect(report.ok).toBe(false);
    expect(report.mismatches).toEqual([
      { batchId, productId: product.id, live: 93, rebuilt: 100, difference: -7 },
    ]);
  });

  it('repairs a mismatch when asked explicitly, and only then', async () => {
    const tenant = await provisionTestTenant('rb-repair');
    worlds.push(tenant);

    const product = await createTestProduct(tenant.scope, `Repair ${uuidv7().slice(0, 6)}`);
    const batchId = await addOpeningStock(tenant.scope, product.id, 80);
    await tenant.scope.update(batches, { qtyRemainingBase: 12 }, eq(batches.id, batchId));

    // Verification alone changes nothing: a mismatch is evidence, and repairing
    // it silently would destroy the evidence of whatever caused it.
    await verifyBatches(tenant.scope);
    const [untouched] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(untouched?.qtyRemainingBase).toBe(12);

    const { repairBatches } = await import('./rebuild');
    const repaired = await repairBatches(tenant.scope);
    expect(repaired).toHaveLength(1);

    const [fixed] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(fixed?.qtyRemainingBase).toBe(80);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });
});
