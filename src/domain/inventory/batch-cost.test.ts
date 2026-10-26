import { describe, expect, it } from 'vitest';

import { costMovements, cumulativeCostPaisa, type BatchMovement } from './batch-cost';

/** Deterministic pseudo-random, so a failure reproduces. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const between = (random: () => number, low: number, high: number) =>
  low + Math.floor(random() * (high - low + 1));

/** Random outflows (and the odd restock) that end with the batch used up. */
function history(random: () => number, received: number): BatchMovement[] {
  const movements: BatchMovement[] = [];
  let left = received;
  while (left > 0) {
    const out = Math.min(left, between(random, 1, Math.max(1, Math.ceil(received / 4))));
    movements.push({ id: `m${movements.length}`, qtyBase: out });
    left -= out;
    const outSoFar = received - left;
    if (random() < 0.15 && outSoFar > 0) {
      const back = between(random, 1, outSoFar);
      movements.push({ id: `m${movements.length}`, qtyBase: -back });
      left += back;
    }
  }
  return movements;
}

describe('batch cost, counted cumulatively (PCN-012)', () => {
  it('a box of 14 at Rs 250 sold one capsule at a time costs exactly Rs 250', () => {
    const basis = { totalPaisa: 25_000, receivedBase: 14 };
    const movements = Array.from({ length: 14 }, (_, index) => ({ id: `c${index}`, qtyBase: 1 }));
    const costs = [...costMovements(basis, movements).values()];
    expect(costs.reduce((sum, cost) => sum + cost, 0)).toBe(25_000);
    // Each capsule is 1,785 or 1,786 paisa — never a flat figure that drifts.
    expect(new Set(costs)).toEqual(new Set([1_785, 1_786]));
  });

  it('10 + 1 free at Rs 35 spreads Rs 350 over 11 units, exactly', () => {
    const basis = { totalPaisa: 35_000, receivedBase: 11 };
    const costs = costMovements(basis, [
      { id: 'a', qtyBase: 4 },
      { id: 'b', qtyBase: 7 },
    ]);
    expect((costs.get('a') ?? 0) + (costs.get('b') ?? 0)).toBe(35_000);
  });

  it('never recognises less than the exact proportional cost, and reconciles when used up', () => {
    const random = seeded(20261027);
    for (let trial = 0; trial < 400; trial += 1) {
      const basis = {
        totalPaisa: between(random, 0, 5_000_000),
        receivedBase: between(random, 1, 300),
      };
      const movements = history(random, basis.receivedBase);
      let taken = 0;
      let recognised = 0;
      const costs = costMovements(basis, movements);
      for (const movement of movements) {
        taken += movement.qtyBase;
        recognised += costs.get(movement.id) ?? 0;
        // C(n) ≥ total × n ÷ received, compared without division.
        expect(recognised * basis.receivedBase).toBeGreaterThanOrEqual(basis.totalPaisa * taken);
        expect(recognised).toBe(cumulativeCostPaisa(basis, taken));
      }
      expect(taken).toBe(basis.receivedBase);
      expect(recognised, `trial ${trial}`).toBe(basis.totalPaisa);
    }
  });

  it('per-unit costing fails the same properties — the reason for this module', () => {
    // Seen to fail (Day 8): flooring understates, rounding up overshoots.
    const basis = { totalPaisa: 25_000, receivedBase: 14 };
    const floored = Math.floor(25_000 / 14) * 14;
    const roundedUp = Math.ceil(25_000 / 14) * 14;
    expect(floored).toBeLessThan(basis.totalPaisa);
    expect(roundedUp).toBeGreaterThan(basis.totalPaisa);
    expect(cumulativeCostPaisa(basis, 14)).toBe(basis.totalPaisa);
  });

  it('a restock gives back the cost those units left with', () => {
    const basis = { totalPaisa: 1_000, receivedBase: 3 };
    const costs = costMovements(basis, [
      { id: 'sale', qtyBase: 2 },
      { id: 'back', qtyBase: -1 },
    ]);
    // Two of three units: ⌈666.6⌉ = 667; one back leaves ⌈333.3⌉ = 334.
    expect(costs.get('sale')).toBe(667);
    expect(costs.get('back')).toBe(-333);
  });

  it('costs nothing from a batch that has no units', () => {
    expect(cumulativeCostPaisa({ totalPaisa: 500, receivedBase: 0 }, 3)).toBe(0);
  });

  it('holds exactly where floating point would not', () => {
    // 9,007,199,254,740 paisa × 7,000 units passes 2^53.
    const basis = { totalPaisa: 9_007_199_254_740, receivedBase: 7_000 };
    expect(cumulativeCostPaisa(basis, 7_000)).toBe(9_007_199_254_740);
  });
});
