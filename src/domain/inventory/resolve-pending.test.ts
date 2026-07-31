/**
 * Pending resolution planning — Phase 13's named Day 6 test ("pending
 * resolution"), and the other half of the promise D2 made on Day 3.
 */

import { describe, expect, it } from 'vitest';

import {
  consumedFromBatch,
  planResolution,
  pendingOrder,
  type ArrivedBatch,
  type PendingAllocation,
} from './resolve-pending';

const PRODUCT = 'product-1';

function pendingRow(overrides: Partial<PendingAllocation> = {}): PendingAllocation {
  return {
    allocationId: 'alloc-1',
    saleLineId: 'line-1',
    productId: PRODUCT,
    qtyBase: 10,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

function arrival(overrides: Partial<ArrivedBatch> = {}): ArrivedBatch {
  return {
    batchId: 'batch-1',
    productId: PRODUCT,
    qtyAvailableBase: 100,
    unitCostPaisa: 280,
    ...overrides,
  };
}

describe('pendingOrder', () => {
  it('is chronological — the earliest unexplained sale is explained first', () => {
    const older = pendingRow({ allocationId: 'a', createdAt: new Date('2026-07-01T09:00:00Z') });
    const newer = pendingRow({ allocationId: 'b', createdAt: new Date('2026-07-01T11:00:00Z') });
    expect([newer, older].sort(pendingOrder).map((row) => row.allocationId)).toEqual(['a', 'b']);
  });

  it('breaks a same-millisecond tie deterministically', () => {
    // Without a total order the rebuild verifier could disagree with live
    // values across two runs for no real reason.
    const at = new Date('2026-07-01T10:00:00Z');
    const first = pendingRow({ allocationId: 'aaa', createdAt: at });
    const second = pendingRow({ allocationId: 'bbb', createdAt: at });
    expect([second, first].sort(pendingOrder).map((row) => row.allocationId)).toEqual([
      'aaa',
      'bbb',
    ]);
  });
});

describe('planResolution', () => {
  it('resolves a shortfall against arrived stock and reports what is left', () => {
    const plan = planResolution([pendingRow({ qtyBase: 20 })], [arrival({ qtyAvailableBase: 100 })]);

    expect(plan.resolutions).toEqual([
      { allocationId: 'alloc-1', batchId: 'batch-1', qtyBase: 20, unitCostPaisa: 280 },
    ]);
    // 100 arrived, 20 immediately owed to a sale already made — 80 on the shelf.
    expect(plan.remainingByBatch['batch-1']).toBe(80);
    expect(plan.stillPendingBase).toBe(0);
  });

  it('takes the cost from the batch that answers, so margin becomes knowable', () => {
    // Until this moment the sale had no cost at all (unit_cost_paisa null on a
    // pending row, Phase 9 §3). Resolution is what makes its margin real.
    const plan = planResolution([pendingRow()], [arrival({ unitCostPaisa: 1_234 })]);
    expect(plan.resolutions[0]?.unitCostPaisa).toBe(1_234);
  });

  it('does nothing when nothing is pending', () => {
    const plan = planResolution([], [arrival()]);
    expect(plan.resolutions).toEqual([]);
    expect(plan.remainingByBatch['batch-1']).toBe(100);
  });

  it('leaves a shortfall larger than the delivery still pending', () => {
    // Honest: the hole stays visible in the exception list until real stock
    // covers it, rather than being half-answered.
    const plan = planResolution(
      [pendingRow({ qtyBase: 50 })],
      [arrival({ qtyAvailableBase: 30 })],
    );
    expect(plan.resolutions).toEqual([]);
    expect(plan.stillPendingBase).toBe(50);
    expect(plan.remainingByBatch['batch-1']).toBe(30);
  });

  it('resolves a pending row whole or not at all', () => {
    // Two arrivals of 30 cannot jointly answer a 50-unit shortfall: splitting
    // would mean mutating the row's quantity (ADR-1 forbids) or inventing an
    // allocation the sale never made.
    const plan = planResolution(
      [pendingRow({ qtyBase: 50 })],
      [
        arrival({ batchId: 'a', qtyAvailableBase: 30 }),
        arrival({ batchId: 'b', qtyAvailableBase: 30 }),
      ],
    );
    expect(plan.resolutions).toEqual([]);
    expect(plan.stillPendingBase).toBe(50);
  });

  it('answers several shortfalls in order until the delivery runs out', () => {
    const plan = planResolution(
      [
        pendingRow({ allocationId: 'a', qtyBase: 30, createdAt: new Date('2026-07-01T09:00:00Z') }),
        pendingRow({ allocationId: 'b', qtyBase: 30, createdAt: new Date('2026-07-01T10:00:00Z') }),
        pendingRow({ allocationId: 'c', qtyBase: 30, createdAt: new Date('2026-07-01T11:00:00Z') }),
      ],
      [arrival({ qtyAvailableBase: 70 })],
    );

    // 70 covers the first two; the third waits for the next delivery.
    expect(plan.resolutions.map((r) => r.allocationId)).toEqual(['a', 'b']);
    expect(plan.remainingByBatch['batch-1']).toBe(10);
    expect(plan.stillPendingBase).toBe(30);
  });

  it('never answers a shortfall with a different product’s stock', () => {
    const plan = planResolution(
      [pendingRow({ productId: 'product-1' })],
      [arrival({ productId: 'product-2' })],
    );
    expect(plan.resolutions).toEqual([]);
    expect(plan.stillPendingBase).toBe(10);
    expect(plan.remainingByBatch['batch-1']).toBe(100);
  });

  it('spreads across batches of the same product when one cannot cover a row', () => {
    const plan = planResolution(
      [
        pendingRow({ allocationId: 'a', qtyBase: 40, createdAt: new Date('2026-07-01T09:00:00Z') }),
        pendingRow({ allocationId: 'b', qtyBase: 40, createdAt: new Date('2026-07-01T10:00:00Z') }),
      ],
      [
        arrival({ batchId: 'x', qtyAvailableBase: 50 }),
        arrival({ batchId: 'y', qtyAvailableBase: 50 }),
      ],
    );

    expect(plan.resolutions).toHaveLength(2);
    expect(plan.resolutions[0]).toMatchObject({ allocationId: 'a', batchId: 'x' });
    // The second row does not fit in x's remaining 10, so it takes y whole.
    expect(plan.resolutions[1]).toMatchObject({ allocationId: 'b', batchId: 'y' });
    expect(plan.remainingByBatch).toEqual({ x: 10, y: 10 });
  });
});

describe('consumedFromBatch', () => {
  it('reports what the batch owes, which is what it must be decremented by', () => {
    const plan = planResolution(
      [
        pendingRow({ allocationId: 'a', qtyBase: 20, createdAt: new Date('2026-07-01T09:00:00Z') }),
        pendingRow({ allocationId: 'b', qtyBase: 25, createdAt: new Date('2026-07-01T10:00:00Z') }),
      ],
      [arrival({ qtyAvailableBase: 100 })],
    );
    expect(consumedFromBatch(plan, 'batch-1')).toBe(45);
    expect(consumedFromBatch(plan, 'nonexistent')).toBe(0);
  });
});
