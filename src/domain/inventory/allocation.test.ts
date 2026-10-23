import { describe, expect, it } from 'vitest';

import { baseQty } from '@/lib/branded';

import {
  allocatedQty,
  consumingBatchPrice,
  fefoOrder,
  isExpired,
  planAllocation,
  type BatchAvailability,
} from './allocation';

/** Every default batch expires in 2027, so none is expired on this day. */
const TODAY = '2026-06-01';

function batch(
  batchId: string,
  qtyRemainingBase: number,
  overrides: Partial<BatchAvailability> = {},
): BatchAvailability {
  return {
    batchId,
    expiryDate: '2027-01-01',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    qtyRemainingBase,
    unitCostPaisa: 280,
    pricePerBaseUnitPaisa: 350,
    ...overrides,
  };
}

describe('FEFO ordering (Phase 9 §4)', () => {
  it('takes the earliest expiry first', () => {
    const soon = batch('soon', 100, { expiryDate: '2026-09-01' });
    const later = batch('later', 100, { expiryDate: '2027-09-01' });

    const plan = planAllocation([later, soon], baseQty(10), TODAY);
    expect(plan.allocations[0]?.batchId).toBe('soon');
  });

  it('sorts NULL expiry LAST, not first', () => {
    // The clause that matters: a non-perishable with no expiry must not jump
    // ahead of a syrup expiring next month, or the shelf rots while the system
    // sells the wrong thing.
    const perishable = batch('perishable', 100, { expiryDate: '2026-09-01' });
    const nonPerishable = batch('non-perishable', 100, { expiryDate: null });

    expect([nonPerishable, perishable].sort(fefoOrder).map((b) => b.batchId)).toEqual([
      'perishable',
      'non-perishable',
    ]);
    expect(
      planAllocation([nonPerishable, perishable], baseQty(10), TODAY).allocations[0]?.batchId,
    ).toBe('perishable');
  });

  it('breaks an expiry tie by creation time', () => {
    const older = batch('older', 100, { createdAt: new Date('2026-01-01T00:00:00Z') });
    const newer = batch('newer', 100, { createdAt: new Date('2026-06-01T00:00:00Z') });

    expect(planAllocation([newer, older], baseQty(10), TODAY).allocations[0]?.batchId).toBe(
      'older',
    );
  });

  it('is a total order, so the same inputs always plan the same way', () => {
    // Two batches created in the same millisecond still need a fixed sequence,
    // or the rebuild verifier can disagree with live values for no real reason.
    const a = batch('aaa', 100, { expiryDate: null, createdAt: new Date(0) });
    const b = batch('bbb', 100, { expiryDate: null, createdAt: new Date(0) });

    expect([b, a].sort(fefoOrder).map((x) => x.batchId)).toEqual(['aaa', 'bbb']);
    expect([a, b].sort(fefoOrder).map((x) => x.batchId)).toEqual(['aaa', 'bbb']);
  });

  it('does not mutate the caller’s array', () => {
    const batches = [
      batch('b', 10, { expiryDate: '2027-01-01' }),
      batch('a', 10, { expiryDate: '2026-01-01' }),
    ];
    planAllocation(batches, baseQty(5), TODAY);
    expect(batches.map((b) => b.batchId)).toEqual(['b', 'a']);
  });
});

describe('consuming stock', () => {
  it('takes everything from one batch when it covers the line', () => {
    const plan = planAllocation([batch('only', 100)], baseQty(30), TODAY);

    expect(plan.allocations).toEqual([
      { batchId: 'only', qtyBase: 30, unitCostPaisa: 280, batchPricePaisa: 350 },
    ]);
    expect(plan.pendingQtyBase).toBe(0);
  });

  it('spans batches in FEFO order when one is not enough', () => {
    const plan = planAllocation(
      [
        batch('first', 4, { expiryDate: '2026-09-01', unitCostPaisa: 200 }),
        batch('second', 100, { expiryDate: '2027-09-01', unitCostPaisa: 300 }),
      ],
      baseQty(10),
      TODAY,
    );

    expect(plan.allocations).toEqual([
      { batchId: 'first', qtyBase: 4, unitCostPaisa: 200, batchPricePaisa: 350 },
      { batchId: 'second', qtyBase: 6, unitCostPaisa: 300, batchPricePaisa: 350 },
    ]);
    expect(plan.pendingQtyBase).toBe(0);
  });

  it('skips exhausted batches', () => {
    const plan = planAllocation(
      [batch('empty', 0, { expiryDate: '2026-01-01' }), batch('stocked', 50)],
      baseQty(5),
      TODAY,
    );

    expect(plan.allocations.map((a) => a.batchId)).toEqual(['stocked']);
  });

  it('allocates exactly the quantity asked for, never more', () => {
    const plan = planAllocation(
      [batch('a', 7), batch('b', 7, { expiryDate: '2027-06-01' })],
      baseQty(9),
      TODAY,
    );
    expect(allocatedQty(plan)).toBe(9);
  });
});

describe('the pending layer (D2)', () => {
  it('records a shortfall rather than blocking the sale', () => {
    // The shelf has it, the system does not. P2: the sale proceeds.
    const plan = planAllocation([batch('short', 4)], baseQty(10), TODAY);

    expect(plan.pendingQtyBase).toBe(6);
    expect(plan.allocations).toEqual([
      { batchId: 'short', qtyBase: 4, unitCostPaisa: 280, batchPricePaisa: 350 },
      { batchId: null, qtyBase: 6, unitCostPaisa: null, batchPricePaisa: null },
    ]);
  });

  it('puts the whole line in the pending layer when there is no stock at all', () => {
    const plan = planAllocation([], baseQty(12), TODAY);

    expect(plan.allocations).toEqual([
      { batchId: null, qtyBase: 12, unitCostPaisa: null, batchPricePaisa: null },
    ]);
    expect(plan.pendingQtyBase).toBe(12);
  });

  it('writes one pending row for the shortfall, not one per unit', () => {
    const plan = planAllocation([], baseQty(500), TODAY);
    expect(plan.allocations).toHaveLength(1);
  });

  it('carries no cost while pending — Phase 9 §3 and its CHECK constraint', () => {
    const plan = planAllocation([], baseQty(3), TODAY);
    expect(plan.allocations[0]?.unitCostPaisa).toBeNull();
  });

  it('still allocates the full quantity across real and pending rows', () => {
    const plan = planAllocation([batch('some', 2)], baseQty(9), TODAY);
    expect(allocatedQty(plan)).toBe(9);
  });
});

describe('batch price for D1’s variance display', () => {
  it('reports the consuming batch’s own price', () => {
    const plan = planAllocation(
      [batch('old', 100, { expiryDate: '2026-09-01', pricePerBaseUnitPaisa: 300 })],
      baseQty(5),
      TODAY,
    );
    expect(consumingBatchPrice(plan)).toBe(300);
  });

  it('reports nothing when the line is entirely pending', () => {
    expect(consumingBatchPrice(planAllocation([], baseQty(5), TODAY))).toBeNull();
  });
});

describe('edges', () => {
  it('plans nothing for a zero or negative quantity', () => {
    expect(planAllocation([batch('a', 10)], baseQty(0), TODAY)).toEqual({
      allocations: [],
      pendingQtyBase: 0,
    });
    expect(planAllocation([batch('a', 10)], baseQty(-5), TODAY).allocations).toEqual([]);
  });
});

describe('expired batches (PCN-008)', () => {
  const expired = batch('expired', 100, { expiryDate: '2026-05-31' });
  const good = batch('good', 100, { expiryDate: '2026-09-30' });

  it('treats a batch as expired from the day after its expiry date', () => {
    expect(isExpired({ expiryDate: '2026-05-31' }, TODAY)).toBe(true);
    expect(isExpired({ expiryDate: '2026-06-01' }, TODAY)).toBe(false);
    expect(isExpired({ expiryDate: null }, TODAY)).toBe(false);
  });

  it('skips an expired batch even though its expiry is the earliest', () => {
    const plan = planAllocation([expired, good], baseQty(10), TODAY);
    expect(plan.allocations.map((allocation) => allocation.batchId)).toEqual(['good']);
  });

  it('prefers a non-perishable over an expired batch', () => {
    const forever = batch('forever', 100, { expiryDate: null });
    expect(planAllocation([expired, forever], baseQty(10), TODAY).allocations[0]?.batchId).toBe(
      'forever',
    );
  });

  it('uses expired stock only once every unexpired batch is exhausted', () => {
    const plan = planAllocation(
      [expired, batch('good', 4, { expiryDate: '2026-09-30' })],
      baseQty(10),
      TODAY,
    );
    expect(plan.allocations.map((allocation) => [allocation.batchId, allocation.qtyBase])).toEqual([
      ['good', 4],
      ['expired', 6],
    ]);
    expect(plan.pendingQtyBase).toBe(0);
  });

  it('goes to the pending layer only after expired stock too is gone', () => {
    const plan = planAllocation(
      [batch('expired', 3, { expiryDate: '2026-01-01' })],
      baseQty(5),
      TODAY,
    );
    expect(plan.allocations.map((allocation) => allocation.batchId)).toEqual(['expired', null]);
    expect(plan.pendingQtyBase).toBe(2);
  });

  it('orders several expired batches earliest-expiry-first among themselves', () => {
    const older = batch('older', 5, { expiryDate: '2025-12-31' });
    const newer = batch('newer', 5, { expiryDate: '2026-03-31' });
    expect(
      planAllocation([newer, older], baseQty(7), TODAY).allocations.map((a) => a.batchId),
    ).toEqual(['older', 'newer']);
  });
});
