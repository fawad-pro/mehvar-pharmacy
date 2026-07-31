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
 * Day 3 has sales (online and offline-origin, including replays). Day 4 adds
 * udhaar sales and standalone settlements, and checks Phase 5 invariant 3
 * (customer balance) alongside the stock invariants. Day 6 replaces the
 * hand-rolled stock stand-ins with the real writers — `commitPurchase` and
 * `commitAdjustment` — so scheme purchases, batch materialization and
 * pending-layer resolution are now mixed into every history rather than tested
 * only in isolation. Returns arrive on Day 7 and must add their event kind to
 * `applyRandomEvent` below rather than get a separate suite: the whole point is
 * that one history mixes everything.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { commitSettlement, type SettlementCommand } from '@/domain/udhaar/commit-settlement';
import { commitPurchase } from '@/domain/purchases/commit-purchase';
import { commitAdjustment } from '@/domain/inventory/commit-adjustment';
import { customerBalance } from '@/db/udhaar-queries';
import {
  batches,
  customers,
  payments,
  saleLineAllocations,
  saleLines,
  sales,
} from '@/db/schema';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  between,
  createTestCustomer,
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
  customers: Uuid[];
  random: () => number;
  /** Every sale command issued, so replays can be produced from real history. */
  issued: SaleCommand[];
  /** Every settlement issued, so replays can exercise its idempotency too. */
  issuedPayments: SettlementCommand[];
  /**
   * Receipt counter for this history.
   *
   * A counter, not a timestamp: receipt numbers derived from a clock collide
   * when two sales land in the same millisecond, which the unique index on
   * (tenant_id, receipt_number) rightly refuses. The real scheme is a
   * per-device counter for exactly this reason (Phase 9 §3). Sales and
   * payments share one sequence (PCN-002), so both draw from this counter.
   */
  receiptCounter: number;
}

/**
 * Evidence, accumulated across every history, that the generator actually
 * reached the states it claims to cover.
 *
 * A randomized suite that never happens to produce a shortfall would pass
 * forever while proving nothing about D2 — the failure mode Phase 11 §3 calls
 * "unit-test theater" in another guise. The final assertion in this file spends
 * these counters.
 */
const observed = { resolvedPendingBase: 0, schemeLines: 0, batchesMaterialized: 0 };

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

  if (roll < 0.10) {
    // A real purchase (W7), through the real writer — often a multi-line
    // invoice, often with scheme bonus units, and always with the chance of
    // resolving whatever the pending layer is currently holding.
    const lineCount = between(random, 1, 3);
    const lines = Array.from({ length: lineCount }, () => {
      const product = pick(random, world.products);
      return {
        lineId: uuidv7(),
        productId: product.id,
        qtyBase: between(random, 5, 200),
        // Scheme purchases are the norm in this market, not an edge case, so
        // the blended-cost path gets exercised constantly rather than rarely.
        bonusQtyBase: random() < 0.3 ? between(random, 1, 5) : 0,
        unitCostPaisa: between(random, 100, 500),
        expiryDate: pick(random, ['2026-09-01', '2027-01-01', '2027-06-01', null]),
        batchNumber: random() < 0.5 ? `B-${between(random, 1, 9999)}` : null,
        mrpAtReceivingPaisa: null,
        priceAtReceivingPaisa: product.pricePaisa,
      };
    });
    observed.schemeLines += lines.filter((line) => line.bonusQtyBase > 0).length;

    const received = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: `INV-${world.receiptCounter}`,
      invoiceDate: null,
      note: null,
      lines,
    });
    if (received.ok) {
      observed.resolvedPendingBase += received.value.resolvedPendingBase;
      observed.batchesMaterialized += received.value.batchIds.length;
    }
    return;
  }

  if (roll < 0.14) {
    // Opening stock or an upward count correction (W9, W8) — the other way
    // stock comes into existence, and the one that materializes a batch from
    // an adjustment rather than a purchase line.
    const product = pick(random, world.products);
    const corrected = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: between(random, 5, 200),
      reason: pick(random, ['opening_stock', 'count_correction'] as const),
      batchId: null,
      note: null,
      unitCostPaisa: between(random, 100, 500),
      pricePerBaseUnitPaisa: product.pricePaisa,
      expiryDate: pick(random, ['2026-09-01', '2027-01-01', '2027-06-01', null]),
      batchNumber: null,
    });
    if (corrected.ok) {
      observed.resolvedPendingBase += corrected.value.resolvedPendingBase;
      observed.batchesMaterialized += corrected.value.batchId ? 1 : 0;
    }
    return;
  }

  if (roll < 0.24) {
    // Stock leaving for a reason that is not a sale (W8), through the real
    // writer — damage, an expiry write-off, a return to the distributor, or a
    // downward count correction.
    const stocked = await tenant.scope.select(batches);
    const withStock = stocked.filter((batch) => batch.qtyRemainingBase > 0);
    if (withStock.length === 0) {
      return;
    }
    const batch = pick(random, withStock);

    await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: batch.productId,
      batchId: batch.id,
      qtyBaseDelta: -between(random, 1, Math.min(batch.qtyRemainingBase, 20)),
      reason: pick(
        random,
        ['damage', 'expiry_writeoff', 'distributor_return', 'count_correction'] as const,
      ),
      note: null,
    });
    return;
  }

  if (roll < 0.32 && (world.issued.length > 0 || world.issuedPayments.length > 0)) {
    // A replay: sync delivering a sale or a settlement the server already has
    // (ADR-3). Either can repeat; delivery repeats, effects never do.
    if (world.issuedPayments.length > 0 && random() < 0.3) {
      const earlier = pick(random, world.issuedPayments);
      await commitSettlement(tenant.scope, earlier);
    } else if (world.issued.length > 0) {
      const earlier = pick(random, world.issued);
      await commitSale(tenant.scope, earlier);
    }
    return;
  }

  if (roll < 0.4 && world.customers.length > 0) {
    // An udhaar sale (W2): some or all of the total goes on a customer's
    // account rather than being paid in cash.
    const customerId = pick(random, world.customers);
    const lineCount = between(random, 1, 3);
    const lines = Array.from({ length: lineCount }, () => {
      const product = pick(random, world.products);
      return {
        lineId: uuidv7(),
        productId: product.id,
        qtyBase: between(random, 1, 60),
        enteredUnitLevel: pick(random, ['tab', 'strip']),
        unitPricePaisa: product.pricePaisa,
        lineDiscountPaisa: 0,
        priceOverridden: false,
      };
    });
    const total = lines.reduce((sum, line) => sum + line.unitPricePaisa * line.qtyBase, 0);
    // Sometimes fully on credit, sometimes a cash/credit split.
    const cashPaisa = random() < 0.4 ? 0 : between(random, 0, total);
    const creditPaisa = total - cashPaisa;

    const command: SaleCommand = {
      saleId: uuidv7(),
      receiptNumber: `A-${(world.receiptCounter += 1)}`,
      customerId,
      lines,
      invoiceDiscountPaisa: 0,
      cashPaisa,
      creditPaisa,
      changePaisa: 0,
      origin: random() < 0.3 ? 'offline_sync' : 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    };

    const result = await commitSale(tenant.scope, command);
    if (result.ok) {
      world.issued.push(command);
    }
    return;
  }

  if (roll < 0.48 && world.customers.length > 0) {
    // A settlement (W3): the customer pays down debt, unrelated to any sale.
    // No floor on the amount — Phase 5 invariant 3 allows an overpayment to
    // leave the customer in credit, so this is not clamped to their balance.
    const customerId = pick(random, world.customers);
    const command: SettlementCommand = {
      paymentId: uuidv7(),
      receiptNumber: `A-${(world.receiptCounter += 1)}`,
      customerId,
      amountPaisa: between(random, 50, 5000),
      origin: random() < 0.3 ? 'offline_sync' : 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    };

    const result = await commitSettlement(tenant.scope, command);
    if (result.ok) {
      world.issuedPayments.push(command);
    }
    return;
  }

  // A cash sale. Quantities deliberately overshoot available stock sometimes,
  // so the pending layer is exercised rather than assumed.
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
      expect(allocation.resolvedAt, `${label}: unbatched row claims to be resolved`).toBeNull();
    }
  }

  /* D2 resolution integrity — a resolved allocation is fully resolved.
     Half a resolution (pointing at a batch with no cost, or claiming a
     resolver that does not exist) would make margin silently wrong for that
     sale, which is exactly the class of quiet error ADR-8 exists to catch. */
  for (const allocation of allocations) {
    if (allocation.resolvedAt === null) {
      continue;
    }
    expect(allocation.batchId, `${label}: resolved row has no batch`).not.toBeNull();
    expect(allocation.unitCostPaisa, `${label}: resolved row has no cost`).not.toBeNull();

    const resolvers = [
      allocation.resolvedByPurchaseLineId,
      allocation.resolvedByAdjustmentId,
    ].filter((id) => id !== null);
    // Phase 9 §3 renders `resolved_by` as two nullable FKs precisely so
    // referential integrity survives; at most one may be set, and a resolved
    // row must name exactly which arrival answered it.
    expect(resolvers, `${label}: resolved row names ${resolvers.length} resolvers`).toHaveLength(1);
  }

  /* Invariant 3 — a customer's balance is Σ credit extended − Σ payments,
     always derived, never stored. Checked two ways: independently recomputed
     from the raw rows here, and through `customerBalance` itself, so the query
     the product actually calls is what gets proven right. */
  const allCustomers = await tenant.scope.select(customers);
  const allPayments = await tenant.scope.select(payments);
  for (const customer of allCustomers) {
    const extended = allSales
      .filter((sale) => sale.customerId === customer.id)
      .reduce((sum, sale) => sum + sale.creditPaisa, 0);
    const paid = allPayments
      .filter((payment) => payment.customerId === customer.id)
      .reduce((sum, payment) => sum + payment.amountPaisa, 0);
    const expectedBalance = extended - paid;

    const actualBalance = await customerBalance(tenant.scope, customer.id);
    expect(actualBalance, `${label}: balance for customer ${customer.id}`).toBe(expectedBalance);
  }

  /* Every payment is attributed, same as invariant 5 for sales. */
  for (const payment of allPayments) {
    expect(payment.createdBy, `${label}: attribution on payment ${payment.receiptNumber}`).toBe(
      tenant.userId,
    );
  }

  /* PCN-002 — sales and payments share one receipt sequence: no number may
     appear on both sides of the split. */
  const saleReceipts = new Set(allSales.map((sale) => sale.receiptNumber));
  for (const payment of allPayments) {
    expect(
      saleReceipts.has(payment.receiptNumber),
      `${label}: receipt ${payment.receiptNumber} used by both a sale and a payment`,
    ).toBe(false);
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

      const customerIds: Uuid[] = [];
      for (let index = 0; index < 3; index += 1) {
        customerIds.push(
          await createTestCustomer(tenant.scope, `Customer ${index} ${uuidv7().slice(0, 6)}`),
        );
      }

      const world: World = {
        tenant,
        products,
        customers: customerIds,
        random,
        issued: [],
        issuedPayments: [],
        receiptCounter: 0,
      };

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

  /**
   * The generator has to have reached the interesting states, or every
   * assertion above passed over a history that never tested anything.
   *
   * Runs last so it can spend what the histories accumulated. If a future
   * change to the event mix quietly stops producing shortfalls or scheme
   * purchases, this fails loudly rather than the suite going quietly green.
   */
  it('actually exercised scheme purchases, materialization and pending resolution', () => {
    expect(observed.schemeLines, 'no bonus-quantity purchase lines were generated').toBeGreaterThan(
      0,
    );
    expect(observed.batchesMaterialized, 'no batches were materialized').toBeGreaterThan(0);
    expect(
      observed.resolvedPendingBase,
      'no pending allocation was ever resolved — D2’s second half went untested',
    ).toBeGreaterThan(0);
  });
});
