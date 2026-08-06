/**
 * Strength parsing, including the one ambiguity that actually matters.
 *
 * "875mg/125mg" and "125mg/5ml" are written identically and mean entirely
 * different things — two ingredients versus one ingredient in a volume. Getting
 * that wrong would make Augmentin 1g look like a syrup and syrups look like
 * combinations, which corrupts every identity comparison downstream.
 */

import { describe, expect, it } from 'vitest';

import { formatStrength, parseStrength, strengthKey } from './strength';

const key = (raw: string): string | null => {
  const parsed = parseStrength(raw);
  return parsed ? strengthKey(parsed) : null;
};

describe('reading a single amount', () => {
  it('parses the common case', () => {
    expect(key('500mg')).toBe('500000mcg');
  });

  it('does not care about spacing or case', () => {
    expect(key('500 mg')).toBe(key('500mg'));
    expect(key('500MG')).toBe(key('500mg'));
    expect(key('  500mg  ')).toBe(key('500mg'));
  });

  it('treats the same amount written in different units as the same strength', () => {
    // The whole reason amounts are canonicalised rather than compared as text.
    expect(key('0.5g')).toBe(key('500mg'));
    expect(key('1g')).toBe(key('1000mg'));
    expect(key('2.5mg')).toBe(key('2500mcg'));
  });

  it('keeps a fractional label exact rather than rounding it', () => {
    expect(key('2.5mg')).toBe('2500mcg');
    expect(key('0.125mg')).toBe('125mcg');
  });

  it('reads IU and percent, which are neither mass nor volume', () => {
    expect(key('100IU')).toBe('100iu');
    expect(key('5%')).toBe('5000m%');
    expect(key('0.05%')).toBe('50m%');
  });
});

describe('combination versus concentration — the ambiguity', () => {
  it('reads mass over mass as two ingredients', () => {
    // Augmentin 1g. Two components, not a ratio.
    const parsed = parseStrength('875mg/125mg');
    expect(parsed?.components).toHaveLength(2);
    expect(parsed?.components[0]).toEqual({ amount: 875_000, dimension: 'mass' });
    expect(parsed?.components[1]).toEqual({ amount: 125_000, dimension: 'mass' });
  });

  it('reads mass over volume as one ingredient in a liquid', () => {
    const parsed = parseStrength('125mg/5ml');
    expect(parsed?.components).toHaveLength(1);
    expect(parsed?.components[0]?.per).toBeDefined();
  });

  it('recognises the same syrup written at a different scale', () => {
    // A pharmacist reading "125mg/5ml" and "25mg/ml" knows these are the same
    // syrup. Reduced to lowest terms, so does the software.
    expect(key('125mg/5ml')).toBe(key('25mg/ml'));
    expect(key('250mg/10ml')).toBe(key('25mg/ml'));
  });

  it('keeps genuinely different concentrations apart', () => {
    expect(key('125mg/5ml')).not.toBe(key('250mg/5ml'));
  });

  it('does not confuse a combination with a concentration', () => {
    expect(key('875mg/125mg')).not.toBe(key('875mg/125ml'));
  });
});

describe('combinations written with a plus', () => {
  it('reads Panadol Extra', () => {
    expect(key('500mg+65mg')).toBe('500000mcg+65000mcg');
  });

  it('accepts an ampersand and surrounding spaces', () => {
    expect(key('500mg & 65mg')).toBe(key('500mg+65mg'));
    expect(key('500 mg + 65 mg')).toBe(key('500mg+65mg'));
  });

  it('preserves component order, because order pairs with the formula', () => {
    // Augmentin 875/125 is not Augmentin 125/875. Sorting happens in
    // identity.ts, where the ingredient names are known and can be kept
    // attached to their amounts.
    expect(key('875mg+125mg')).not.toBe(key('125mg+875mg'));
  });

  it('handles three ingredients', () => {
    const parsed = parseStrength('500mg+30mg+2mg');
    expect(parsed?.components).toHaveLength(3);
  });
});

describe('labels it cannot read', () => {
  it('returns null rather than guessing', () => {
    // Callers must fall back to comparing text. A wrong parse is worse than no
    // parse, because a wrong parse silently merges two medicines.
    expect(parseStrength('as directed')).toBeNull();
    expect(parseStrength('5mg/kg body weight')).toBeNull();
    expect(parseStrength('500')).toBeNull();
    expect(parseStrength('mg')).toBeNull();
  });

  it('treats absent and empty as absent', () => {
    expect(parseStrength(null)).toBeNull();
    expect(parseStrength(undefined)).toBeNull();
    expect(parseStrength('')).toBeNull();
    expect(parseStrength('   ')).toBeNull();
  });

  it('refuses a label finer than the canonical unit instead of rounding to zero', () => {
    expect(parseStrength('0.0001mcg')).toBeNull();
  });
});

describe('showing a strength back to a person', () => {
  it('renders in the unit a pharmacist would use, never the canonical one', () => {
    expect(formatStrength(parseStrength('500mg')!)).toBe('500mg');
    expect(formatStrength(parseStrength('0.5g')!)).toBe('500mg');
    expect(formatStrength(parseStrength('1g')!)).toBe('1g');
    expect(formatStrength(parseStrength('500mg+65mg')!)).toBe('500mg + 65mg');
    expect(formatStrength(parseStrength('100IU')!)).toBe('100 IU');
    expect(formatStrength(parseStrength('5%')!)).toBe('5%');
  });

  it('shows a concentration as the pack writes it, not reduced', () => {
    // Reduction is for comparison only. A syrup labelled 125mg/5ml must read
    // back as 125mg/5ml — the reduced pair is arithmetically identical and
    // unrecognisable to the person holding the bottle (D4).
    expect(formatStrength(parseStrength('125mg/5ml')!)).toBe('125mg/5ml');
    expect(formatStrength(parseStrength('250mg/10ml')!)).toBe('250mg/10ml');
  });

  it('reads a bare denominator as one of that unit', () => {
    expect(formatStrength(parseStrength('25mg/ml')!)).toBe('25mg/1ml');
  });

  it('keeps the label as written, because the pack is authoritative (D4)', () => {
    expect(parseStrength('125mg/5ml')?.raw).toBe('125mg/5ml');
  });
});
