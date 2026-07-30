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
  it('shows paisa by default — a Rs 3.50 tablet must never render as "3"', () => {
    expect(formatPaisa(paisa(350))).toBe('3.50');
    expect(formatPaisa(paisa(5))).toBe('0.05');
    expect(formatPaisa(paisa(123456700))).toBe('1,234,567.00');
  });

  it('groups thousands and adds the currency prefix on request (I6)', () => {
    expect(formatPaisa(paisa(125050), { withSymbol: true })).toBe('Rs 1,250.50');
  });

  it('drops paisa only when explicitly asked', () => {
    expect(formatPaisa(paisa(123456700), { decimals: false })).toBe('1,234,567');
  });

  it('keeps the sign in front', () => {
    expect(formatPaisa(paisa(-25000), { withSymbol: true })).toBe('-Rs 250.00');
  });
});
