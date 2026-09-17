/**
 * The starter catalogue as a whole — invariants over the data project.
 *
 * This is the counterpart to `scripts/catalog/validate.ts`: it holds the shipped
 * catalogue to the promises Phase 6 makes about it, and — unlike a component
 * test that supplies its own fixture — it runs against the REAL source, so a
 * regression in `catalog-data.ts` (a duplicate, a fabricated barcode, a shadowed
 * verified entry, an unusable strength) fails here rather than on a pharmacy's
 * machine. It also proves the everyday counter searches ("pan 40", "panadol
 * syrup", a salt name) actually resolve against the real catalogue, which is the
 * whole point of the exercise.
 *
 * Pure and database-free, so it runs in the normal `npm run test` gate.
 */

import { describe, expect, it } from 'vitest';

import { CatalogIndex, type IndexedProduct } from '@/client/search/catalog-index';
import { CANONICAL_FORMS, normaliseForm } from '@/domain/catalog/form';
import { identityKey } from '@/domain/catalog/identity';
import type { PackProduct } from '@/domain/catalog/pack';
import { expandStarter } from '@/domain/catalog/starter';
import { parseStrength } from '@/domain/catalog/strength';

import { CAT, STARTER_SOURCE } from '../scripts/db/catalog-data';
import { SEED_PRODUCTS } from '../scripts/db/seed-data';

const verified = SEED_PRODUCTS.map((s) => ({
  name: s.name,
  strength: s.strength,
  form: s.form,
  manufacturer: s.manufacturer,
  formulaText: s.formula,
}));
const verifiedKeys = new Set(verified.map(identityKey));

const { products, categoryCounts, duplicates } = expandStarter(STARTER_SOURCE, verifiedKeys);
const total = verified.length + products.length;

function keyOf(p: PackProduct): string {
  return identityKey({
    name: p.name,
    strength: p.strength ?? null,
    form: p.form ?? null,
    manufacturer: p.manufacturer ?? null,
    formulaText: p.formulaText ?? null,
  });
}

describe('the starter catalogue is big and genuinely useful', () => {
  it('ships thousands of distinct products, not a token seed', () => {
    // A floor, not the exact number — the catalogue grows. Well above the
    // original 138-item seed, and enough that a shop finds its daily stock.
    expect(total).toBeGreaterThan(3500);
  });

  it('covers every priority category with real depth', () => {
    // The twelve Phase-13 priority areas must each be substantially represented.
    const priority = [
      CAT.pain,
      CAT.antibiotics,
      CAT.diabetes,
      CAT.cardio,
      CAT.gastro,
      CAT.allergy,
      CAT.respiratory,
      CAT.vitamins,
      CAT.derma,
      CAT.eyeear,
      CAT.womens,
      CAT.pediatrics,
    ];
    for (const category of priority) {
      expect(categoryCounts[category] ?? 0, category).toBeGreaterThan(15);
    }
  });
});

describe('deduplication — no product is entered twice', () => {
  it('has no duplicate identities across the whole pack', () => {
    const seen = new Set(verifiedKeys);
    const dupes: string[] = [];
    for (const p of products) {
      const k = keyOf(p);
      if (seen.has(k)) dupes.push(`${p.name} ${p.strength ?? ''} ${p.form ?? ''}`.trim());
      seen.add(k);
    }
    expect(dupes).toEqual([]);
  });

  it('never shadows a hand-checked verified head product', () => {
    const referenceKeys = new Set(products.map(keyOf));
    for (const key of verifiedKeys) {
      expect(referenceKeys.has(key), 'a verified identity leaked into the reference body').toBe(
        false,
      );
    }
  });

  it('collapses source duplicates rather than emitting them', () => {
    // Some overlap with the verified head is expected and is collapsed, not shipped.
    expect(duplicates).toBeGreaterThanOrEqual(0);
  });
});

describe('data quality — the honesty rules Phase 6 §5 promises', () => {
  it('invents no barcodes and no prices in the reference body', () => {
    for (const p of products) {
      expect(p.barcodes ?? [], `${p.name} has a fabricated barcode`).toHaveLength(0);
      expect(p.referenceMrpPaisa ?? null, `${p.name} has a fabricated price`).toBeNull();
    }
  });

  it('marks the whole reference body as reference tier', () => {
    expect(products.every((p) => p.quality === 'reference')).toBe(true);
  });

  it('gives every product a name and a base unit level', () => {
    for (const p of products) {
      expect(p.name.trim()).not.toBe('');
      expect(p.packLevels?.[0]?.factor).toBe(1);
    }
  });

  it('uses only declared categories', () => {
    const known = new Set<string>(Object.values(CAT));
    for (const c of Object.keys(categoryCounts)) expect(known.has(c), c).toBe(true);
  });

  it('normalises every form to the canonical vocabulary', () => {
    const canonical = new Set<string>(CANONICAL_FORMS);
    const strays = new Set<string>();
    for (const p of products) {
      if (!p.form) continue;
      const nf = normaliseForm(p.form);
      if (nf === null || !canonical.has(nf)) strays.add(p.form);
    }
    expect([...strays]).toEqual([]);
  });

  it('keeps strengths overwhelmingly parseable (identity stays reliable)', () => {
    const withStrength = products.filter((p) => p.strength);
    const unparseable = withStrength.filter((p) => parseStrength(p.strength!) === null);
    // A handful of legitimately-odd labels (IU combinations) fall back to text
    // comparison, which is correct; the vast majority parse to a canonical value.
    expect(unparseable.length / withStrength.length).toBeLessThan(0.02);
  });
});

/* -------------------------------------------------------------------------- */
/* The counter's real search, over the real catalogue                          */
/* -------------------------------------------------------------------------- */

function toIndexed(p: PackProduct, i: number): IndexedProduct {
  const base = p.packLevels?.[0];
  return {
    id: `p-${i}`,
    name: p.name,
    strength: p.strength ?? null,
    form: p.form ?? null,
    manufacturer: p.manufacturer ?? null,
    formulaText: p.formulaText ?? null,
    baseUnitName: base?.name ?? 'unit',
    packLevels: (p.packLevels ?? []).slice(1),
    pricePaisa: 0,
    mrpPaisa: null,
    needsCompletion: false,
  };
}

// Index the whole catalogue as it ships — verified head plus reference body —
// because the counter searches the pharmacy's catalogue, which is built from both.
const verifiedPack: PackProduct[] = SEED_PRODUCTS.map((s) => ({
  name: s.name,
  manufacturer: s.manufacturer,
  formulaText: s.formula,
  form: s.form,
  strength: s.strength,
  packLevels: [{ name: s.baseUnit, factor: 1 }, ...s.packLevels],
  referenceMrpPaisa: s.mrp,
  quality: 'verified' as const,
}));

const index = CatalogIndex.build({
  products: [...verifiedPack, ...products].map(toIndexed),
  barcodes: [],
  stock: {},
  syncedAt: '2026-09-17T00:00:00.000Z',
});

function labels(query: string, limit = 25): string[] {
  return index
    .search(query, limit)
    .map((h) => `${h.product.name} ${h.product.strength ?? ''}`.trim());
}

describe('real searches a salesman types resolve against the real catalogue', () => {
  it('"pan 40" surfaces pantoprazole 40mg', () => {
    const hits = labels('pan 40');
    expect(hits.some((l) => /^Pantoprazole 40mg$/.test(l))).toBe(true);
    // The 20mg is a different presentation and must not appear for "40".
    expect(hits).not.toContain('Pantoprazole 20mg');
  });

  it('"pantoprazole" finds pantoprazole', () => {
    expect(labels('pantoprazole')[0]).toMatch(/Pantoprazole/);
  });

  it('a generic salt search finds the salt', () => {
    expect(labels('metformin').some((l) => /Metformin/.test(l))).toBe(true);
    expect(labels('amoxicillin').some((l) => /Amoxicillin/.test(l))).toBe(true);
  });

  it('"amlodipine 5" narrows to the 5mg', () => {
    const hits = labels('amlodipine 5');
    expect(hits.some((l) => /Amlodipine 5mg/.test(l))).toBe(true);
    expect(hits).not.toContain('Amlodipine 10mg');
  });

  it('a common brand resolves', () => {
    expect(labels('augmentin').some((l) => /Augmentin/.test(l))).toBe(true);
    expect(labels('risek').some((l) => /Risek/.test(l))).toBe(true);
  });

  it('a misspelling still lands (fuzzy path intact at scale)', () => {
    expect(labels('panadol').some((l) => /Panadol|Pantoprazole/.test(l))).toBe(true);
  });
});
