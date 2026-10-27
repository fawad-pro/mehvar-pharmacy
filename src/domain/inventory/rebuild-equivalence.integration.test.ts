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
 * only in isolation. Day 7 adds returns and cash movements as event kinds
 * here, the same way rather than a separate suite: the whole point is that one
 * history mixes everything.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { saleLineGrossPaisa, type SaleLineCommand } from '@/domain/sales/sale-command';
import { commitSettlement, type SettlementCommand } from '@/domain/udhaar/commit-settlement';
import { commitPaymentReversal } from '@/domain/udhaar/commit-payment-reversal';
import { commitSupplierPayment } from '@/domain/suppliers/commit-supplier-payment';
import { commitSupplierPaymentReversal } from '@/domain/suppliers/commit-supplier-payment-reversal';
import { commitCashReversal } from '@/domain/cash/commit-cash-reversal';
import { threeNumbers } from '@/db/reporting-queries';
import { commitPurchase, type PurchaseLineCommand } from '@/domain/purchases/commit-purchase';
import { commitPurchaseCorrection } from '@/domain/purchases/commit-purchase-correction';
import { correctedLine, lineStateOf } from '@/domain/purchases/purchase-correction';
import { commitSupplierReturn } from '@/domain/suppliers/commit-supplier-return';
import { balancesBySupplier, supplierBalance } from '@/db/supplier-queries';
import { commitAdjustment } from '@/domain/inventory/commit-adjustment';
import { replaceIntoProduct, replaceProduct } from '@/domain/inventory/replace-product';
import { commitReturn } from '@/domain/sales/commit-return';
import { commitCashMovement } from '@/domain/cash/commit-cash-movement';
import { CASH_REASONS, directionFor } from '@/domain/cash/cash-command';
import { customerBalance, customerLedger } from '@/db/udhaar-queries';
import { returnableLinesForSale } from '@/db/returns-queries';
import {
  adjustments,
  batches,
  cashMovements,
  customers,
  payments,
  purchaseCorrections,
  purchaseLines,
  purchases,
  saleLineAllocations,
  saleLines,
  saleReturnLines,
  saleReturns,
  sales,
  supplierPayments,
  supplierReturns,
  suppliers,
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
import { batchCostLedger } from '@/db/batch-cost-queries';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

/** Deterministic by default; override to reproduce a reported failure. */
const SEED = Number(process.env.REBUILD_SEED ?? 20260730);
/*
 * 16 since PCN-013/014: with that many rare event kinds (cancellations, moves
 * into an existing product, returns against a bill discount), 4 histories of
 * 40 events left some unreached on some seeds, and the "actually exercised"
 * guard below — rightly — failed. Checked across ten seeds.
 */
const HISTORIES = Number(process.env.REBUILD_HISTORIES ?? 16);
const EVENTS_PER_HISTORY = Number(process.env.REBUILD_EVENTS ?? 40);

/**
 * Expiry dates for generated batches. One is always in the past and one is
 * absent, so every history mixes expired, unexpired and non-perishable stock:
 * PCN-008 changed the order sales consume them in, and the rebuild has to
 * agree whatever that order is.
 */
const EXPIRY_CHOICES = ['2020-01-01', '2030-01-01', '2030-06-01', null] as const;

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
  /** [PCN-009] One distributor per history, so returns have someone to credit. */
  supplierId: Uuid;
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
const observed = {
  resolvedPendingBase: 0,
  schemeLines: 0,
  batchesMaterialized: 0,
  returnsCommitted: 0,
  /** Returns that actually gave credit back — the ledger's third term. */
  creditReducingReturns: 0,
  cashMovementsCommitted: 0,
  /** [PCN-009] Corrections and supplier returns that actually committed. */
  correctionsCommitted: 0,
  supplierReturnsCommitted: 0,
  /** [PCN-012] Sale lines entered as a count of strips at the strip's own price. */
  unitPricedLines: 0,
  /** Adjustments asking for more than the batch had, and refused. */
  adjustmentsRefused: 0,
  /** [PCN-012] Purchase lines entered per strip, at a strip cost of their own. */
  packPurchaseLines: 0,
  /** [PCN-012] Batches checked fully used up, so the exact reconciliation ran. */
  batchesReconciled: 0,
  /** [PCN-012] Products replaced mid-history, their stock and cost carried across. */
  productsReplaced: 0,
  /** [PCN-013] Udhaar payments, supplier payments and cash movements cancelled. */
  paymentsReversed: 0,
  supplierPaymentsReversed: 0,
  cashMovementsReversed: 0,
  /** [PCN-014] Returns against a sale with a bill discount, and such sales returned whole. */
  returnsAgainstBillDiscounts: 0,
  discountedSalesReturnedWhole: 0,
  /** [PCN-013] Products whose stock moved into another the shop already had. */
  productsMovedInto: 0,
  /** [PCN-013] Stock removed as entered by mistake, and refused on invoiced stock. */
  mistakesRemoved: 0,
  mistakesRefused: 0,
};

/**
 * [PCN-013] Rows that still stand: neither a cancellation nor cancelled. An
 * independent figure computed from these alone is the figure as if the
 * mistyped entry had never been typed, which is what a cancellation promises.
 */
function standing<T extends { id: string; reversesId: string | null }>(rows: readonly T[]): T[] {
  const cancelled = new Set(rows.map((row) => row.reversesId).filter((id) => id !== null));
  return rows.filter((row) => row.reversesId === null && !cancelled.has(row.id));
}

/**
 * [PCN-012] A random sale line: half the time a version-1 line (base units at
 * the per-base price), half the time strips at a strip price of their own —
 * sometimes cheaper than ten tablets, so the two pricing paths cannot agree by
 * accident. One history mixes both, as a real outbox does across an update.
 */
function randomSaleLine(
  random: () => number,
  product: TestProduct,
  lineDiscountPaisa: number,
  priceOverridden: boolean,
): SaleLineCommand {
  if (random() < 0.5) {
    return {
      lineId: uuidv7(),
      productId: product.id,
      qtyBase: between(random, 1, 60),
      enteredUnitLevel: pick(random, ['tab', 'strip']),
      unitPricePaisa: product.pricePaisa,
      lineDiscountPaisa,
      priceOverridden,
    };
  }
  observed.unitPricedLines += 1;
  const count = between(random, 1, 6);
  const stripPrice = product.pricePaisa * 10 - between(random, 0, 50);
  return {
    lineId: uuidv7(),
    productId: product.id,
    qtyBase: count * 10,
    enteredUnitLevel: 'strip',
    unitPricePaisa: Math.floor(stripPrice / 10),
    unitKey: 'u1',
    unitName: 'strip',
    unitCount: count,
    unitPricePaisaEntered: stripPrice,
    lineDiscountPaisa,
    priceOverridden,
  };
}

function lineGross(line: SaleLineCommand): number {
  return saleLineGrossPaisa(line) ?? 0;
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

  if (roll < 0.1) {
    // A real purchase (W7), through the real writer — often a multi-line
    // invoice, often with scheme bonus units, and always with the chance of
    // resolving whatever the pending layer is currently holding.
    const lineCount = between(random, 1, 3);
    const lines: PurchaseLineCommand[] = Array.from({ length: lineCount }, () => {
      const product = pick(random, world.products);
      if (random() < 0.5) {
        // [PCN-012] Bought per strip at a strip cost that is often not a
        // whole number of paisa per tablet, so only exact costing reconciles.
        observed.packPurchaseLines += 1;
        const count = between(random, 1, 20);
        const bonusCount = random() < 0.3 ? between(random, 1, 2) : 0;
        const stripCost = between(random, 800, 5_000);
        return {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: count * 10,
          bonusQtyBase: bonusCount * 10,
          unitCostPaisa: Math.ceil(stripCost / 10),
          expiryDate: pick(random, EXPIRY_CHOICES),
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: product.pricePaisa,
          entered: {
            unitKey: 'u1',
            unitName: 'strip',
            unitCount: count,
            bonusUnitCount: bonusCount,
            unitCostPaisa: stripCost,
            pricePaisa: product.pricePaisa * 10,
          },
        };
      }
      return {
        lineId: uuidv7(),
        productId: product.id,
        qtyBase: between(random, 5, 200),
        // Scheme purchases are the norm in this market, not an edge case, so
        // the blended-cost path gets exercised constantly rather than rarely.
        bonusQtyBase: random() < 0.3 ? between(random, 1, 5) : 0,
        unitCostPaisa: between(random, 100, 500),
        expiryDate: pick(random, EXPIRY_CHOICES),
        batchNumber: random() < 0.5 ? `B-${between(random, 1, 9999)}` : null,
        mrpAtReceivingPaisa: null,
        priceAtReceivingPaisa: product.pricePaisa,
      };
    });
    observed.schemeLines += lines.filter((line) => line.bonusQtyBase > 0).length;

    // Most invoices name the history's distributor, and some are bought on
    // credit, so supplier balances and supplier returns have real history.
    const withSupplier = random() < 0.7;
    const received = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: withSupplier ? world.supplierId : null,
      invoiceRef: `INV-${world.receiptCounter}`,
      invoiceDate: null,
      note: null,
      lines,
      ...(withSupplier && random() < 0.4 ? { cashPaidPaisa: 0 } : {}),
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
      expiryDate: pick(random, EXPIRY_CHOICES),
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
    // Now and then the operator asks for more than the batch has — a typo, or
    // a sale that took the units while the screen was open. The refusal must
    // leave no adjustment behind, or the next verification sees a mismatch.
    const overshoot = random() < 0.15;
    const reason = pick(random, [
      'damage',
      'expiry_writeoff',
      'distributor_return',
      'count_correction',
      'entered_by_mistake',
    ] as const);
    // [PCN-013] Only stock typed in by hand may be removed as never there.
    // Such batches are a minority, so "entered by mistake" usually aims at
    // one half the time — and otherwise at any batch, so the refusal is reached too.
    const handTyped = new Set(
      (await tenant.scope.select(adjustments))
        .filter((row) => row.reason === 'opening_stock' || row.reason === 'count_correction')
        .map((row) => row.id),
    );
    const isByHand = (candidate: (typeof withStock)[number]) =>
      candidate.source === 'adjustment' && handTyped.has(candidate.sourceId);
    const typedBatches = withStock.filter(isByHand);
    const batch =
      reason === 'entered_by_mistake' && typedBatches.length > 0 && random() < 0.5
        ? pick(random, typedBatches)
        : pick(random, withStock);
    const byHand = isByHand(batch);

    const result = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: batch.productId,
      batchId: batch.id,
      qtyBaseDelta: overshoot
        ? -(batch.qtyRemainingBase + between(random, 1, 5))
        : -between(random, 1, Math.min(batch.qtyRemainingBase, 20)),
      reason,
      note: null,
    });
    if (reason === 'entered_by_mistake' && !byHand) {
      expect(result).toEqual({ ok: false, reason: 'mistake_on_purchased_stock' });
      observed.mistakesRefused += 1;
    } else if (overshoot) {
      expect(result).toEqual({ ok: false, reason: 'stale_batch_state' });
      observed.adjustmentsRefused += 1;
    } else if (reason === 'entered_by_mistake' && result.ok) {
      observed.mistakesRemoved += 1;
    }
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
    const lines = Array.from({ length: lineCount }, () =>
      randomSaleLine(random, pick(random, world.products), 0, false),
    );
    const subtotal = lines.reduce((sum, line) => sum + lineGross(line), 0);
    // [PCN-014] Bill discounts on udhaar sales too: the customer owes the
    // discounted total, and a return of it gives back what each line paid.
    const invoiceDiscount = random() < 0.3 ? Math.min(subtotal, between(random, 1, 300)) : 0;
    const total = subtotal - invoiceDiscount;
    // Sometimes fully on credit, sometimes a cash/credit split.
    const cashPaisa = random() < 0.4 ? 0 : between(random, 0, total);
    const creditPaisa = total - cashPaisa;

    const command: SaleCommand = {
      saleId: uuidv7(),
      receiptNumber: `A-${(world.receiptCounter += 1)}`,
      customerId,
      lines,
      invoiceDiscountPaisa: invoiceDiscount,
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

  if (roll < 0.48 && world.issuedPayments.length > 0 && random() < 0.25) {
    // [PCN-013] A payment typed wrong, cancelled — sometimes one already
    // cancelled, which must be refused and change nothing.
    const target = pick(random, world.issuedPayments);
    const cancelled = await commitPaymentReversal(tenant.scope, {
      reversalId: uuidv7(),
      paymentId: target.paymentId,
      receiptNumber: `A-${(world.receiptCounter += 1)}`,
      clientCommittedAt: new Date(),
    });
    if (cancelled.ok) observed.paymentsReversed += 1;
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

  if (roll < 0.52 && world.issued.length > 0) {
    // W4: a return against a sale this history already made, through the real
    // writer — restocking a named batch or writing off, cash back or credit
    // reduced, exercising `batchLedger`'s `restockedBase` term.
    // Prefer a sale that actually put something on udhaar when one exists.
    // Picking uniformly leaves the credit-reducing return — the ledger's third
    // term — at roughly a one-in-ten chance per history, which is how it went
    // unexercised: udhaar sales are a narrow band of the roll and cash sales
    // are the fallback, so `issued` is overwhelmingly cash. Randomness is
    // worth keeping; leaving a whole refund path to chance is not.
    const creditSales = world.issued.filter((sale) => sale.customerId !== null);
    // [PCN-014] Likewise a sale with a bill discount, often enough that one
    // is returned whole: only then can a refund exceed what it collected.
    const discountedSales = world.issued.filter((sale) => sale.invoiceDiscountPaisa > 0);
    const which = random();
    const chosen =
      discountedSales.length > 0 && which < 0.25
        ? pick(random, discountedSales)
        : creditSales.length > 0 && which < 0.75
          ? pick(random, creditSales)
          : pick(random, world.issued);
    const lines = await returnableLinesForSale(tenant.scope, chosen.saleId);
    const returnable = lines.filter((line) => line.qtyBase - line.alreadyReturnedBase > 0);
    if (returnable.length === 0) {
      return;
    }
    if (random() < (chosen.invoiceDiscountPaisa > 0 ? 0.6 : 0.3)) {
      // Everything still on the sale comes back, in one return.
      const whole = await commitReturn(tenant.scope, {
        returnId: uuidv7(),
        saleId: chosen.saleId,
        receiptNumber: `A-${(world.receiptCounter += 1)}`,
        lines: returnable.map((each) => ({
          saleLineId: each.saleLineId,
          qtyBase: each.qtyBase - each.alreadyReturnedBase,
          restockBatchId: each.sourceBatches[0]?.batchId ?? null,
        })),
        refundMethod: chosen.customerId && random() < 0.6 ? 'credit' : 'cash',
        reasonNote: null,
      });
      if (whole.ok) {
        observed.returnsCommitted += 1;
        if (whole.value.creditReducedPaisa > 0) observed.creditReducingReturns += 1;
      }
      return;
    }
    const line = pick(random, returnable);
    const remaining = line.qtyBase - line.alreadyReturnedBase;
    const qtyBase = between(random, 1, remaining);
    // Sometimes a write-off (no source batch known, or the operator chooses
    // not to restock), sometimes back onto the shelf.
    const restockBatchId = random() < 0.7 ? (line.sourceBatches[0]?.batchId ?? null) : null;
    const refundMethod = chosen.customerId && random() < 0.6 ? 'credit' : 'cash';

    const result = await commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId: chosen.saleId,
      receiptNumber: `A-${(world.receiptCounter += 1)}`,
      lines: [{ saleLineId: line.saleLineId, qtyBase, restockBatchId }],
      refundMethod,
      reasonNote: null,
    });
    if (result.ok) {
      observed.returnsCommitted += 1;
      if (result.value.creditReducedPaisa > 0) {
        observed.creditReducingReturns += 1;
      }
    }
    return;
  }

  const recordedMovements =
    roll >= 0.52 && roll < 0.56 ? await tenant.scope.select(cashMovements) : [];
  if (roll < 0.56 && recordedMovements.length > 0 && random() < 0.5) {
    // [PCN-013] A cash movement typed wrong, cancelled. With nothing yet to
    // cancel the band records a movement instead: returning empty-handed
    // left whole runs of histories without a single cancellation.
    const recorded = recordedMovements;
    const cancelled = await commitCashReversal(tenant.scope, {
      reversalId: uuidv7(),
      movementId: pick(random, recorded).id as Uuid,
    });
    if (cancelled.ok) observed.cashMovementsReversed += 1;
    return;
  }

  if (roll < 0.56) {
    // W10: a cash movement — opening float, a withdrawal, an expense, or an
    // over/short entry from a drawer count. Isolated from every other
    // invariant here (it touches no stock, no customer balance), so it needs
    // only to commit cleanly and stay out of the way.
    const reason = pick(random, CASH_REASONS);
    const direction = directionFor(reason) ?? pick(random, ['in', 'out'] as const);
    const committed = await commitCashMovement(tenant.scope, {
      movementId: uuidv7(),
      direction,
      amountPaisa: between(random, 100, 5000),
      reason,
      note: null,
    });
    if (committed.ok) {
      observed.cashMovementsCommitted += 1;
    }
    return;
  }

  if (roll < 0.6) {
    // [PCN-009] A purchase correction: the cost, the quantity or the bonus of a
    // received line, stated as what the line should have said. Reductions can
    // exceed what the batch still holds, and are then refused.
    const received = (await tenant.scope.select(batches)).filter(
      (batch) => batch.source === 'purchase_line',
    );
    if (received.length === 0) {
      return;
    }
    const batch = pick(random, received);
    const [line] = await tenant.scope.select(purchaseLines, eq(purchaseLines.id, batch.sourceId));
    if (!line) {
      return;
    }
    const current = correctedLine(
      lineStateOf(line),
      await tenant.scope.select(
        purchaseCorrections,
        eq(purchaseCorrections.purchaseLineId, line.id),
      ),
    );
    const which = random();
    const committed = await commitPurchaseCorrection(tenant.scope, {
      correctionId: uuidv7(),
      purchaseLineId: line.id as Uuid,
      // Whole packs of the line's own unit (1 for a per-base line, PCN-012).
      qtyBase:
        which < 0.4
          ? Math.max(0, current.qtyBase + between(random, -15, 15) * current.factor)
          : current.qtyBase,
      bonusQtyBase:
        which >= 0.4 && which < 0.6
          ? Math.max(0, current.bonusQtyBase + between(random, -3, 3) * current.factor)
          : current.bonusQtyBase,
      unitCostPaisa: which >= 0.6 ? between(random, 100, 500) : current.unitCostPaisa,
      note: 'generated correction',
    });
    if (committed.ok && !committed.value.alreadyCommitted) {
      observed.correctionsCommitted += 1;
    }
    return;
  }

  if (roll < 0.64) {
    // [PCN-009] Goods back to the distributor, from a batch that arrived on one
    // of its invoices — the credit reduces what is owed.
    const stocked = (await tenant.scope.select(batches)).filter(
      (batch) => batch.source === 'purchase_line' && batch.qtyRemainingBase > 0,
    );
    if (stocked.length === 0) {
      return;
    }
    const batch = pick(random, stocked);
    const committed = await commitSupplierReturn(tenant.scope, {
      returnId: uuidv7(),
      batchId: batch.id as Uuid,
      qtyBase: between(random, 1, Math.min(batch.qtyRemainingBase, 10)),
      creditPaisa: between(random, 0, 3_000),
      note: null,
    });
    if (committed.ok) {
      observed.supplierReturnsCommitted += 1;
    }
    return;
  }

  if (roll < 0.66) {
    // [PCN-012] "Replace this product": every batch with stock moves to a new
    // product at the same count, with its remaining cost. Later events sell,
    // receive and adjust the replacement, so one history mixes both products.
    const index = between(random, 0, world.products.length - 1);
    const old = world.products[index]!;
    const onHand = (await tenant.scope.select(batches)).filter(
      (batch) => batch.productId === old.id && batch.qtyRemainingBase > 0,
    );
    const replaced = await replaceProduct(tenant.scope, {
      oldProductId: old.id,
      product: {
        name: `${old.name} (replaced)`,
        globalProductId: null,
        manufacturer: null,
        form: null,
        strength: null,
        formulaText: null,
        baseUnitName: 'tab',
        packLevels: [{ name: 'strip', factor: 10 }],
        pricePaisa: old.pricePaisa,
        mrpPaisa: null,
        minStockBaseUnits: null,
        needsCompletion: false,
      },
      batches: onHand.map((batch) => ({
        batchId: batch.id as Uuid,
        expectedRemainingBase: batch.qtyRemainingBase,
        newQtyBase: batch.qtyRemainingBase,
      })),
      note: 'generated replacement',
    });
    if (replaced.ok) {
      observed.productsReplaced += 1;
      world.products[index] = {
        ...old,
        id: replaced.value.newProductId,
        name: `${old.name} (replaced)`,
      };
    }
    return;
  }

  if (roll < 0.7) {
    // [PCN-007] A payment to the distributor and, as often as not, [PCN-013]
    // the cancellation of an earlier one typed wrong.
    const earlier = (await tenant.scope.select(supplierPayments)).filter(
      (row) => row.reversesId === null,
    );
    if (earlier.length > 0 && random() < 0.5) {
      const cancelled = await commitSupplierPaymentReversal(tenant.scope, {
        reversalId: uuidv7(),
        paymentId: pick(random, earlier).id as Uuid,
      });
      if (cancelled.ok) observed.supplierPaymentsReversed += 1;
      return;
    }
    await commitSupplierPayment(tenant.scope, {
      paymentId: uuidv7(),
      supplierId: world.supplierId,
      amountPaisa: between(random, 100, 3_000),
      purchaseId: null,
      note: null,
    });
    return;
  }

  if (roll < 0.72) {
    // [PCN-013] Stock moved into a product the shop already has — which may
    // have sold short, so the moved stock answers its shortfalls (D2). A band
    // of its own: as a share of the replace band it was too rare to rely on.
    const index = between(random, 0, world.products.length - 1);
    const old = world.products[index]!;
    const others = world.products.filter((product) => product.id !== old.id);
    if (others.length === 0) return;
    const onHand = (await tenant.scope.select(batches)).filter(
      (batch) => batch.productId === old.id && batch.qtyRemainingBase > 0,
    );
    const into = pick(random, others);
    const moved = await replaceIntoProduct(tenant.scope, {
      oldProductId: old.id,
      intoProductId: into.id,
      batches: onHand.map((batch) => ({
        batchId: batch.id as Uuid,
        expectedRemainingBase: batch.qtyRemainingBase,
        newQtyBase: batch.qtyRemainingBase,
      })),
      note: 'generated move into an existing product',
    });
    if (moved.ok) {
      observed.productsMovedInto += 1;
      observed.resolvedPendingBase += moved.value.resolvedPendingBase;
      world.products[index] = into;
    }
    return;
  }

  // A cash sale. Quantities deliberately overshoot available stock sometimes,
  // so the pending layer is exercised rather than assumed.
  const lineCount = between(random, 1, 3);
  const lines = Array.from({ length: lineCount }, () =>
    randomSaleLine(
      random,
      pick(random, world.products),
      random() < 0.2 ? between(random, 1, 100) : 0,
      random() < 0.1,
    ),
  );

  const subtotal = lines.reduce(
    (sum, line) => sum + Math.max(0, lineGross(line) - line.lineDiscountPaisa),
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

  /* [PCN-012] Cost reconciliation (D1, D2). Every batch's movements — sales,
     write-offs, supplier returns, restocks — costed cumulatively from its
     CURRENT basis: never less than the exact proportional cost, and exactly
     what was paid once the batch is used up. */
  const costLedger = await batchCostLedger(tenant.scope);
  const byBatch = new Map<string, { taken: number; cost: number }>();
  for (const movement of costLedger.movements) {
    const running = byBatch.get(movement.batchId) ?? { taken: 0, cost: 0 };
    running.taken += movement.qtyBase;
    running.cost += movement.costPaisa;
    byBatch.set(movement.batchId, running);
  }
  for (const [batchId, { taken, cost }] of byBatch) {
    const basis = costLedger.basis.get(batchId);
    if (!basis || basis.receivedBase <= 0) continue;
    expect(
      cost * basis.receivedBase,
      `${label}: batch ${batchId} cost understated`,
    ).toBeGreaterThanOrEqual(basis.totalPaisa * taken);
    if (taken === basis.receivedBase) {
      expect(cost, `${label}: used-up batch ${batchId} does not reconcile`).toBe(basis.totalPaisa);
      observed.batchesReconciled += 1;
    }
  }

  /* [PCN-009] The supplier balance, recomputed from the raw rows — tracked
     invoices as corrected, less cash paid, supplier payments and the credit for
     goods sent back — must equal both the one-supplier figure and the
     all-suppliers expansion (Day 8: a figure and its expansion are one thing). */
  const tracked = (await tenant.scope.select(purchases)).filter(
    (row) => row.supplierId === world.supplierId && row.creditTracked,
  );
  const trackedIds = new Set(tracked.map((row) => row.id));
  const trackedLines = (await tenant.scope.select(purchaseLines)).filter((row) =>
    trackedIds.has(row.purchaseId),
  );
  const trackedLineIds = new Set(trackedLines.map((row) => row.id));
  const expectedOwed =
    trackedLines.reduce(
      (sum, row) => sum + (row.lineCostPaisa ?? row.qtyBase * row.unitCostPaisa),
      0,
    ) +
    (await tenant.scope.select(purchaseCorrections))
      .filter((row) => trackedLineIds.has(row.purchaseLineId))
      .reduce((sum, row) => sum + row.invoiceDeltaPaisa, 0) -
    tracked.reduce((sum, row) => sum + row.cashPaidPaisa, 0) -
    standing(await tenant.scope.select(supplierPayments))
      .filter((row) => row.supplierId === world.supplierId)
      .reduce((sum, row) => sum + row.amountPaisa, 0) -
    (await tenant.scope.select(supplierReturns))
      .filter((row) => row.supplierId === world.supplierId)
      .reduce((sum, row) => sum + row.creditPaisa, 0);
  expect(await supplierBalance(tenant.scope, world.supplierId), `${label}: supplier balance`).toBe(
    expectedOwed,
  );
  expect(
    (await balancesBySupplier(tenant.scope))[world.supplierId] ?? 0,
    `${label}: supplier balances expansion`,
  ).toBe(expectedOwed);

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
    // [PCN-012] The stored amount when the line has one, else per-base × base
    // quantity — exactly what each kind of line charged.
    const subtotal = own.reduce(
      (sum, line) =>
        sum +
        Math.max(
          0,
          (line.lineAmountPaisa ?? line.unitPricePaisa * line.qtyBase) - line.lineDiscountPaisa,
        ),
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

  /* Invariant 3 — a customer's balance is Σ credit extended − Σ payments −
     Σ credit reversed (Day 7's return term), always derived, never stored.
     Checked two ways: independently recomputed from the raw rows here, and
     through `customerBalance` itself, so the query the product actually calls
     is what gets proven right. */
  const allCustomers = await tenant.scope.select(customers);
  const allPayments = await tenant.scope.select(payments);
  const allReturns = await tenant.scope.select(saleReturns);
  const saleById = new Map(allSales.map((sale) => [sale.id, sale]));
  for (const customer of allCustomers) {
    const extended = allSales
      .filter((sale) => sale.customerId === customer.id)
      .reduce((sum, sale) => sum + sale.creditPaisa, 0);
    // [PCN-013] From the payments that still stand: a cancelled payment and
    // its cancellation must leave the balance exactly where it was.
    const paid = standing(allPayments)
      .filter((payment) => payment.customerId === customer.id)
      .reduce((sum, payment) => sum + payment.amountPaisa, 0);
    const reversed = allReturns
      .filter((row) => saleById.get(row.saleId)?.customerId === customer.id)
      .reduce((sum, row) => sum + row.creditReducedPaisa, 0);
    const expectedBalance = extended - paid - reversed;

    const actualBalance = await customerBalance(tenant.scope, customer.id);
    expect(actualBalance, `${label}: balance for customer ${customer.id}`).toBe(expectedBalance);

    /* T4 — the ledger is the balance expanded into the rows that produced it,
       so its running total must arrive at exactly that balance. This is the
       screen an udhaar dispute is settled on: a running total that cannot
       reach the headline figure is worse than showing nothing, because it
       looks authoritative while disagreeing with itself. It caught a real
       omission — the ledger read sales and payments but not the returns term
       that `customerBalance` had subtracted since Day 7. */
    const ledger = await customerLedger(tenant.scope, customer.id);
    const ledgerTotal = ledger.reduce((sum, row) => sum + row.amountPaisa, 0);
    expect(ledgerTotal, `${label}: ledger total for customer ${customer.id}`).toBe(actualBalance);
  }

  /* [PCN-013] Expected cash, recomputed from the entries that still stand: a
     cancelled settlement or cash movement and its cancellation net to nothing
     in the drawer. */
  const standingMovements = standing(await tenant.scope.select(cashMovements));
  const expectedCash =
    allSales.reduce((sum, sale) => sum + sale.cashPaisa, 0) +
    standing(allPayments).reduce((sum, payment) => sum + payment.amountPaisa, 0) -
    allReturns.reduce((sum, row) => sum + row.cashOutPaisa, 0) +
    standingMovements.reduce(
      (sum, row) => sum + (row.direction === 'in' ? row.amountPaisa : -row.amountPaisa),
      0,
    );
  expect(
    (await threeNumbers(tenant.scope, new Date(0), new Date('2999-01-01'))).expectedCashPaisa,
    `${label}: expected cash`,
  ).toBe(expectedCash);

  /* Every payment is attributed, same as invariant 5 for sales. */
  for (const payment of allPayments) {
    expect(payment.createdBy, `${label}: attribution on payment ${payment.receiptNumber}`).toBe(
      tenant.userId,
    );
  }

  /* [PCN-014] A sale's refunds never exceed what it collected, and a sale
     returned whole refunds exactly that — whatever its item and bill
     discounts, and however many returns it took. */
  const returnedBySale = new Map<string, number>();
  for (const row of allReturns) {
    returnedBySale.set(
      row.saleId,
      (returnedBySale.get(row.saleId) ?? 0) + row.cashOutPaisa + row.creditReducedPaisa,
    );
  }
  const soldLines = await tenant.scope.select(saleLines);
  const returnedLines = await tenant.scope.select(saleReturnLines);
  const returnedByLine = new Map<string, number>();
  for (const row of returnedLines) {
    returnedByLine.set(row.saleLineId, (returnedByLine.get(row.saleLineId) ?? 0) + row.qtyBase);
  }
  for (const sale of allSales) {
    const refunded = returnedBySale.get(sale.id) ?? 0;
    expect(
      refunded,
      `${label}: ${sale.receiptNumber} refunded more than it collected`,
    ).toBeLessThanOrEqual(sale.totalPaisa);
    const own = soldLines.filter((line) => line.saleId === sale.id);
    const wholeBack =
      own.length > 0 && own.every((line) => (returnedByLine.get(line.id) ?? 0) === line.qtyBase);
    if (wholeBack) {
      expect(refunded, `${label}: ${sale.receiptNumber} returned whole`).toBe(sale.totalPaisa);
      if (sale.invoiceDiscountPaisa > 0) observed.discountedSalesReturnedWhole += 1;
    }
    if (refunded > 0 && sale.invoiceDiscountPaisa > 0) observed.returnsAgainstBillDiscounts += 1;
  }

  /* PCN-002/PCN-003 — sales, payments and returns share one receipt sequence:
     no number may appear on more than one of the three. */
  const saleReceipts = new Set(allSales.map((sale) => sale.receiptNumber));
  const paymentReceipts = new Set(allPayments.map((payment) => payment.receiptNumber));
  for (const payment of allPayments) {
    expect(
      saleReceipts.has(payment.receiptNumber),
      `${label}: receipt ${payment.receiptNumber} used by both a sale and a payment`,
    ).toBe(false);
  }
  for (const row of allReturns) {
    expect(
      saleReceipts.has(row.receiptNumber) || paymentReceipts.has(row.receiptNumber),
      `${label}: receipt ${row.receiptNumber} used by both a return and a sale/payment`,
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

      const supplierId = uuidv7();
      await tenant.scope.insert(suppliers, {
        id: supplierId,
        name: `Distributor ${uuidv7().slice(-6)}`,
        phone: null,
      });

      const world: World = {
        tenant,
        products,
        customers: customerIds,
        random,
        issued: [],
        issuedPayments: [],
        receiptCounter: 0,
        supplierId,
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
    expect(observed.returnsCommitted, 'no return was ever committed').toBeGreaterThan(0);
    /* Without this the ledger-vs-balance invariant above is vacuous: it can
       only catch a missing returns term if some return actually reduced
       credit. A green suite that never exercised the case it exists to guard
       is worse than no suite, because it reads as proof. */
    expect(
      observed.creditReducingReturns,
      'no return ever reduced credit — the ledger/balance invariant proved nothing',
    ).toBeGreaterThan(0);
    expect(observed.cashMovementsCommitted, 'no cash movement was ever committed').toBeGreaterThan(
      0,
    );
    expect(observed.correctionsCommitted, 'no purchase correction ever committed').toBeGreaterThan(
      0,
    );
    expect(observed.supplierReturnsCommitted, 'no supplier return ever committed').toBeGreaterThan(
      0,
    );
    expect(observed.unitPricedLines, 'no sale line was ever priced per strip').toBeGreaterThan(0);
    expect(
      observed.packPurchaseLines,
      'no purchase line was ever entered per strip',
    ).toBeGreaterThan(0);
    expect(
      observed.batchesReconciled,
      'no batch was ever used up — the exact cost reconciliation never ran',
    ).toBeGreaterThan(0);
    expect(observed.productsReplaced, 'no product was ever replaced').toBeGreaterThan(0);
    expect(
      observed.productsMovedInto,
      'no product was ever moved into one the shop already had',
    ).toBeGreaterThan(0);
    expect(
      observed.adjustmentsRefused,
      'no adjustment was ever refused — the refusal path went untested',
    ).toBeGreaterThan(0);
    expect(observed.paymentsReversed, 'no udhaar payment was ever cancelled').toBeGreaterThan(0);
    expect(
      observed.returnsAgainstBillDiscounts,
      'no return was ever made against a sale with a bill discount',
    ).toBeGreaterThan(0);
    expect(
      observed.discountedSalesReturnedWhole,
      'no sale with a bill discount was ever returned whole — the refund cap proved nothing',
    ).toBeGreaterThan(0);
    expect(
      observed.supplierPaymentsReversed,
      'no supplier payment was ever cancelled',
    ).toBeGreaterThan(0);
    expect(observed.cashMovementsReversed, 'no cash movement was ever cancelled').toBeGreaterThan(
      0,
    );
    expect(
      observed.mistakesRemoved,
      'no stock was ever removed as entered by mistake',
    ).toBeGreaterThan(0);
    expect(
      observed.mistakesRefused,
      'entered by mistake was never refused on invoiced stock',
    ).toBeGreaterThan(0);
  });
});
