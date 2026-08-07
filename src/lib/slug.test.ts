import { describe, expect, it } from 'vitest';

import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates an ordinary shop name', () => {
    expect(slugify('Al-Shifa Medical Store')).toBe('al-shifa-medical-store');
  });

  it('collapses runs of punctuation into one hyphen', () => {
    expect(slugify('Khan & Sons  Pharmacy (Main)')).toBe('khan-sons-pharmacy-main');
  });

  it('strips leading and trailing separators', () => {
    expect(slugify('  --Noor Pharmacy--  ')).toBe('noor-pharmacy');
  });

  it('folds accents rather than dropping the letters', () => {
    expect(slugify('Café Pharmacie')).toBe('cafe-pharmacie');
  });

  it('generates a usable slug for a name with no ASCII letters at all', () => {
    // The common case in this market: a shop named only in Urdu script would
    // otherwise reduce to an empty string, and nothing could be typed at login.
    const slug = slugify('دواخانہ', 'abcdef1234');

    expect(slug).toBe('shop-cdef1234');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('draws the fallback from the random tail, not the uuid timestamp', () => {
    // `tenants.slug` is unique, and UUIDv7 leads with 48 bits of millisecond
    // timestamp — a fallback taken from the front collides for two installs in
    // the same millisecond, and is near-identical across any two at all.
    const slugs = new Set(Array.from({ length: 50 }, () => slugify('دواخانہ')));

    expect(slugs.size).toBe(50);
  });

  it('bounds length so the slug stays retypable', () => {
    const slug = slugify('A'.repeat(120));

    expect(slug.length).toBeLessThanOrEqual(40);
  });

  it('never ends in a hyphen, even when the length bound cuts mid-separator', () => {
    // 'aaa…a Pharmacy' sliced at 40 can land exactly on the hyphen.
    const slug = slugify(`${'a'.repeat(39)} Pharmacy`);

    expect(slug.endsWith('-')).toBe(false);
  });
});
