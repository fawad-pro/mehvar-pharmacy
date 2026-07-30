import { describe, expect, it } from 'vitest';

import { InvalidUnitError, paisa } from './branded';
import {
  addPaisa,
  formatPaisa,
  multiplyPaisa,
  negatePaisa,
  rupeesToPaisa,
  subtractPaisa,
  sumPaisa,
} from './money';

describe('paisa construction', () => {
  it('rejects non-integers — Phase 9 §1 forbids floats near money', () => {
    expect(() => paisa(12.5)).toThrow(InvalidUnitError);
  });

  it('accepts negative amounts (change, over/short, deltas)', () => {
    expect(paisa(-250)).toBe(-250);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(addPaisa(paisa(1250), paisa(99), paisa(1))).toBe(1350);
    expect(subtractPaisa(paisa(1000), paisa(1250))).toBe(-250);
    expect(negatePaisa(paisa(400))).toBe(-400);
    expect(sumPaisa([])).toBe(0);
  });

  it('multiplies without floating-point drift', () => {
    // 0.1 + 0.2 in rupees is the classic failure; in paisa it cannot happen.
    expect(addPaisa(rupeesToPaisa(0.1), rupeesToPaisa(0.2))).toBe(30);
    expect(multiplyPaisa(paisa(333), 3)).toBe(999);
  });

  it('rounds half away from zero, symmetrically', () => {
    expect(multiplyPaisa(paisa(101), 0.5)).toBe(51);
    expect(multiplyPaisa(paisa(-101), 0.5)).toBe(-51);
  });

  it('refuses non-finite multipliers', () => {
    expect(() => multiplyPaisa(paisa(100), Number.NaN)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('renders grouped rupees by default (I6: numerals are the loudest thing)', () => {
    expect(formatPaisa(paisa(123456700))).toBe('1,234,567');
  });

  it('renders paisa precision and the currency prefix on request', () => {
    expect(formatPaisa(paisa(125050), { withSymbol: true, decimals: true })).toBe('Rs 1,250.50');
    expect(formatPaisa(paisa(5), { decimals: true })).toBe('0.05');
  });

  it('keeps the sign in front', () => {
    expect(formatPaisa(paisa(-25000), { withSymbol: true })).toBe('-Rs 250');
  });
});
