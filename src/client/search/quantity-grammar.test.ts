import { describe, expect, it } from 'vitest';

import {
  defaultUnitLevel,
  nextUnitLevel,
  parseQuantityQuery,
  resolveQuantity,
} from './quantity-grammar';

const LEVELS = [
  { name: 'strip', factor: 10 },
  { name: 'box', factor: 200 },
];

describe('parsing a quantity out of the search box (Phase 10 §4)', () => {
  it('reads the canonical form', () => {
    expect(parseQuantityQuery('3*pana')).toEqual({
      count: 3,
      query: 'pana',
      hasExplicitCount: true,
    });
  });

  it('accepts the separators a hurried hand actually produces (I3)', () => {
    for (const input of ['3*pana', '3x pana', '3 pana', '3×pana', '3 * pana']) {
      const parsed = parseQuantityQuery(input);
      expect(parsed.count, input).toBe(3);
      expect(parsed.query, input).toBe('pana');
    }
  });

  it('defaults to one when no count is written', () => {
    expect(parseQuantityQuery('panadol')).toEqual({
      count: 1,
      query: 'panadol',
      hasExplicitCount: false,
    });
  });

  it('leaves a bare number alone — it is a strength or a barcode, not a count', () => {
    expect(parseQuantityQuery('500')).toEqual({
      count: 1,
      query: '500',
      hasExplicitCount: false,
    });
    expect(parseQuantityQuery('8964000101018').query).toBe('8964000101018');
  });

  it('treats a half-typed intention as search text, not an error', () => {
    expect(parseQuantityQuery('3*')).toEqual({ count: 1, query: '3*', hasExplicitCount: false });
  });

  it('ignores a zero or absurd count', () => {
    expect(parseQuantityQuery('0*pana').hasExplicitCount).toBe(false);
  });

  it('keeps a strength inside the query intact', () => {
    // "2 panadol 500" is two of the 500mg one, not two hundred of something.
    expect(parseQuantityQuery('2 panadol 500')).toEqual({
      count: 2,
      query: 'panadol 500',
      hasExplicitCount: true,
    });
  });

  it('handles surrounding whitespace', () => {
    expect(parseQuantityQuery('  4*bru  ')).toEqual({
      count: 4,
      query: 'bru',
      hasExplicitCount: true,
    });
  });
});

describe('resolving a count into base units (Phase 5 §2)', () => {
  it('multiplies by the pack factor', () => {
    // "3 strips" is 30 tablets in the ledger.
    expect(resolveQuantity(3, 'strip', 'tab', LEVELS)).toBe(30);
    expect(resolveQuantity(1, 'box', 'tab', LEVELS)).toBe(200);
  });

  it('leaves base units alone', () => {
    expect(resolveQuantity(4, 'tab', 'tab', LEVELS)).toBe(4);
  });

  it('falls back to base units for an unknown level rather than failing (P2)', () => {
    expect(resolveQuantity(4, 'carton', 'tab', LEVELS)).toBe(4);
  });

  it('handles a product with no pack levels', () => {
    expect(resolveQuantity(2, 'bottle', 'bottle', [])).toBe(2);
  });
});

describe('cycling unit levels — what Tab does', () => {
  it('walks base → strip → box and wraps', () => {
    expect(nextUnitLevel('tab', 'tab', LEVELS)).toBe('strip');
    expect(nextUnitLevel('strip', 'tab', LEVELS)).toBe('box');
    expect(nextUnitLevel('box', 'tab', LEVELS)).toBe('tab');
  });

  it('stays put for a single-level product', () => {
    expect(nextUnitLevel('bottle', 'bottle', [])).toBe('bottle');
  });

  it('recovers from an unknown current level', () => {
    expect(nextUnitLevel('carton', 'tab', LEVELS)).toBe('tab');
  });
});

describe('the default level for a new line (I3)', () => {
  it('is a strip when the product has one — the common case pre-selected', () => {
    expect(defaultUnitLevel('tab', LEVELS)).toBe('strip');
  });

  it('is the base unit otherwise', () => {
    expect(defaultUnitLevel('bottle', [])).toBe('bottle');
  });
});
