/**
 * The ranking table — Phase 13 Day 2's named test, and the artefact that settles
 * the day's risk note: "fuzzy tuning is a rabbit hole — time-box it; the ranking
 * table defines 'good enough'."
 *
 * So this file is the specification, not a check on one. Each case is a query a
 * salesman actually types and the product he expects first. Tuning is finished
 * when these pass; anything not listed here is not a requirement.
 */

import { describe, expect, it } from 'vitest';

import {
  CatalogIndex,
  MatchTier,
  applyDelta,
  type CatalogPayload,
  type IndexedProduct,
} from './catalog-index';

function product(id: string, name: string, extra: Partial<IndexedProduct> = {}): IndexedProduct {
  return {
    id,
    name,
    strength: null,
    form: 'Tablet',
    manufacturer: null,
    formulaText: null,
    baseUnitName: 'tab',
    packLevels: [{ name: 'strip', factor: 10 }],
    pricePaisa: 350,
    mrpPaisa: 350,
    needsCompletion: false,
    ...extra,
  };
}

const CATALOG: IndexedProduct[] = [
  product('panadol', 'Panadol', {
    strength: '500mg',
    manufacturer: 'GSK',
    formulaText: 'Paracetamol',
  }),
  product('panadol-extra', 'Panadol Extra', {
    strength: '500mg+65mg',
    manufacturer: 'GSK',
    formulaText: 'Paracetamol + Caffeine',
  }),
  product('calpol', 'Calpol Syrup', {
    strength: '120mg/5ml',
    manufacturer: 'GSK',
    formulaText: 'Paracetamol',
    baseUnitName: 'bottle',
    packLevels: [],
  }),
  product('brufen', 'Brufen', {
    strength: '400mg',
    manufacturer: 'Abbott',
    formulaText: 'Ibuprofen',
  }),
  product('augmentin', 'Augmentin', {
    strength: '625mg',
    manufacturer: 'GSK',
    formulaText: 'Amoxicillin + Clavulanic Acid',
  }),
  product('risek', 'Risek', {
    strength: '20mg',
    manufacturer: 'Getz Pharma',
    formulaText: 'Omeprazole',
  }),
  product('ventolin', 'Ventolin Inhaler', {
    strength: '100mcg',
    manufacturer: 'GSK',
    formulaText: 'Salbutamol',
    baseUnitName: 'inhaler',
    packLevels: [],
  }),
  product('glucophage', 'Glucophage', {
    strength: '500mg',
    manufacturer: 'Merck',
    formulaText: 'Metformin',
  }),
  product('surbex', 'Surbex Z', { manufacturer: 'Abbott', formulaText: 'Multivitamin + Zinc' }),
  product('disprin', 'Disprin', { strength: '300mg', formulaText: 'Aspirin' }),
];

const PAYLOAD: CatalogPayload = {
  products: CATALOG,
  barcodes: [
    { barcode: '8964000101018', productId: 'panadol', unitLevelName: 'strip' },
    { barcode: '8964000202025', productId: 'brufen', unitLevelName: 'box' },
  ],
  stock: { panadol: 340, brufen: 0, augmentin: 12 },
  syncedAt: '2026-07-30T00:00:00.000Z',
};

const index = CatalogIndex.build(PAYLOAD);

function topName(query: string): string | undefined {
  return index.search(query)[0]?.product.name;
}

function names(query: string, limit?: number): string[] {
  return index.search(query, limit).map((hit) => hit.product.name);
}

describe('the ranking table (Phase 10 §5)', () => {
  /**
   * Query → the product that must come first. This table is the contract.
   */
  const cases: Array<[query: string, expected: string, why: string]> = [
    // Tier 1–2: exact and prefix. The everyday case — three characters is the
    // Day 2 "done when" (Phase 13 §3).
    ['panadol', 'Panadol', 'exact name beats its own longer variant'],
    ['pan', 'Panadol', 'three characters, correctly ranked'],
    ['pana', 'Panadol', 'prefix prefers the shorter, more specific name'],
    ['bru', 'Brufen', 'prefix'],
    ['ris', 'Risek', 'prefix'],
    ['gluco', 'Glucophage', 'prefix'],

    // Tier 3: word boundary. Salesmen type the distinguishing word.
    ['extra', 'Panadol Extra', 'a word inside the name'],
    ['inhaler', 'Ventolin Inhaler', 'a word inside the name'],
    ['syrup', 'Calpol Syrup', 'a word inside the name'],

    // Tier 4: fuzzy. Phase 10 §5's named example, plus the drift around it.
    ['pandol', 'Panadol', 'the canonical transliteration case'],
    ['penadol', 'Panadol', 'vowel drift'],
    ['panadal', 'Panadol', 'vowel drift'],
    ['panadlo', 'Panadol', 'transposition — one slip, not two'],
    ['broofen', 'Brufen', 'oo for u'],
    ['wentolin', 'Ventolin Inhaler', 'v and w are interchangeable in Roman Urdu'],
    ['agmentin', 'Augmentin', 'dropped vowel'],
    ['glukophage', 'Glucophage', 'k for c'],
    ['risak', 'Risek', 'vowel drift'],
    ['disprin', 'Disprin', 'exact'],

    // Tier 5: formula and manufacturer. Substitution support (Phase 1 §5) —
    // "the asked-for brand is out, an equivalent salt is offered".
    ['ibuprofen', 'Brufen', 'salt match finds the brand'],
    ['omeprazole', 'Risek', 'salt match'],
    ['metformin', 'Glucophage', 'salt match'],
    ['salbutamol', 'Ventolin Inhaler', 'salt match'],
  ];

  for (const [query, expected, why] of cases) {
    it(`"${query}" → ${expected} (${why})`, () => {
      expect(topName(query)).toBe(expected);
    });
  }
});

describe('the ladder is ordered, not just scored', () => {
  it('puts an exact name above a fuzzy neighbour', () => {
    const hits = index.search('panadol');
    expect(hits[0]?.tier).toBe(MatchTier.ExactName);
    expect(hits[0]?.product.name).toBe('Panadol');
  });

  it('puts a prefix match above a salt match', () => {
    // "para" prefixes nothing, but is a salt fragment for three products.
    const hits = index.search('paracetamol');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.tier >= MatchTier.Fuzzy)).toBe(true);
  });

  it('labels a salt match as such, so the UI can say why it is showing (Phase 10 §5)', () => {
    const hits = index.search('ibuprofen');
    expect(hits[0]?.matchedOn).toBe('formula');
  });

  it('labels a manufacturer match', () => {
    const hits = index.search('abbott');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.matchedOn === 'manufacturer')).toBe(true);
    expect(hits.map((hit) => hit.product.name).sort()).toEqual(['Brufen', 'Surbex Z']);
  });

  it('finds every paracetamol brand when asked by salt — the substitution moment', () => {
    const hits = index.search('paracetamol', 20);
    expect(hits.map((hit) => hit.product.name).sort()).toEqual([
      'Calpol Syrup',
      'Panadol',
      'Panadol Extra',
    ]);
  });
});

describe('barcodes bypass ranking (Phase 10 §5)', () => {
  it('resolves a scanned code to one product and its unit level', () => {
    const hits = index.search('8964000101018');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.product.name).toBe('Panadol');
    expect(hits[0]?.tier).toBe(MatchTier.Barcode);
  });

  it('carries the unit level the code maps to — a box code is not a strip code', () => {
    expect(index.resolveBarcode('8964000202025')?.unitLevelName).toBe('box');
    expect(index.resolveBarcode('8964000101018')?.unitLevelName).toBe('strip');
  });

  it('tolerates the whitespace a scanner sometimes emits', () => {
    expect(index.resolveBarcode(' 8964000101018 ')?.product.name).toBe('Panadol');
  });

  it('returns nothing for an unknown code, so the UI can offer the link prompt', () => {
    expect(index.resolveBarcode('0000000000000')).toBeUndefined();
    // Falls through to ranking rather than dead-ending (P2).
    expect(index.search('0000000000000')).toEqual([]);
  });
});

describe('stock is advisory and separate', () => {
  it('reports stock where known and null where not', () => {
    expect(index.search('panadol')[0]?.stockBase).toBe(340);
    expect(index.search('disprin')[0]?.stockBase).toBeNull();
  });

  it('reports zero as zero, not as unknown — the badge has to distinguish them', () => {
    // D2: a zero-stock line still sells. The badge says so; it never blocks.
    expect(index.search('brufen')[0]?.stockBase).toBe(0);
  });
});

describe('edges that must not throw at a counter (P2)', () => {
  it('returns nothing for an empty or punctuation-only query', () => {
    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('---')).toEqual([]);
  });

  it('returns nothing rather than everything for gibberish', () => {
    expect(index.search('xqzwmp')).toEqual([]);
  });

  it('does not fuzzy-match one- and two-character queries', () => {
    // Tolerance is zero below three characters, so nothing reaches the Fuzzy
    // tier by edit distance. Two characters cannot be meaningfully misspelled,
    // and guessing at them would put junk above real prefix matches.
    for (const query of ['p', 'pa', 'br']) {
      for (const hit of index.search(query)) {
        expect(hit.tier).not.toBe(MatchTier.Fuzzy);
      }
    }
  });

  it('still reaches products through a salt prefix on a short query', () => {
    // "pa" prefixes no product name, but it does prefix Paracetamol — so Calpol
    // is a legitimate hit, labelled as a salt match. This is substitution
    // support working, not a false positive.
    const hits = index.search('pa');
    const calpol = hits.find((hit) => hit.product.name === 'Calpol Syrup');
    expect(calpol?.matchedOn).toBe('formula');
  });

  it('respects the limit', () => {
    expect(names('a', 3).length).toBeLessThanOrEqual(3);
  });

  it('handles a catalog with no products', () => {
    const empty = CatalogIndex.build({
      products: [],
      barcodes: [],
      stock: {},
      syncedAt: PAYLOAD.syncedAt,
    });
    expect(empty.search('panadol')).toEqual([]);
    expect(empty.size).toBe(0);
  });
});

describe('incremental refresh (ADR-4: "refreshes on catalog changes")', () => {
  it('updates a changed product without touching the rest', () => {
    const merged = applyDelta(PAYLOAD, {
      products: [product('panadol', 'Panadol', { pricePaisa: 400 })],
      removedProductIds: [],
      barcodes: [],
      removedBarcodes: [],
      stock: PAYLOAD.stock,
      syncedAt: '2026-07-31T00:00:00.000Z',
    });

    expect(merged.products).toHaveLength(CATALOG.length);
    expect(merged.products.find((p) => p.id === 'panadol')?.pricePaisa).toBe(400);
    expect(merged.syncedAt).toBe('2026-07-31T00:00:00.000Z');
  });

  it('adds a new product', () => {
    const merged = applyDelta(PAYLOAD, {
      products: [product('nims', 'Nims', { formulaText: 'Nimesulide' })],
      removedProductIds: [],
      barcodes: [],
      removedBarcodes: [],
      stock: PAYLOAD.stock,
      syncedAt: '2026-07-31T00:00:00.000Z',
    });

    expect(CatalogIndex.build(merged).search('nims')[0]?.product.name).toBe('Nims');
  });

  it('drops a deactivated product, and its barcodes with it', () => {
    const merged = applyDelta(PAYLOAD, {
      products: [],
      removedProductIds: ['panadol'],
      barcodes: [],
      removedBarcodes: [],
      stock: PAYLOAD.stock,
      syncedAt: '2026-07-31T00:00:00.000Z',
    });

    const rebuilt = CatalogIndex.build(merged);
    expect(rebuilt.search('panadol').map((h) => h.product.name)).toEqual(['Panadol Extra']);
    expect(rebuilt.resolveBarcode('8964000101018')).toBeUndefined();
  });

  it('removes a barcode without removing its product', () => {
    const merged = applyDelta(PAYLOAD, {
      products: [],
      removedProductIds: [],
      barcodes: [],
      removedBarcodes: ['8964000101018'],
      stock: PAYLOAD.stock,
      syncedAt: '2026-07-31T00:00:00.000Z',
    });

    const rebuilt = CatalogIndex.build(merged);
    expect(rebuilt.resolveBarcode('8964000101018')).toBeUndefined();
    expect(rebuilt.search('panadol')[0]?.product.name).toBe('Panadol');
  });

  it('replaces the stock snapshot wholesale — it has no per-row clock', () => {
    const merged = applyDelta(PAYLOAD, {
      products: [],
      removedProductIds: [],
      barcodes: [],
      removedBarcodes: [],
      stock: { panadol: 12 },
      syncedAt: '2026-07-31T00:00:00.000Z',
    });

    const rebuilt = CatalogIndex.build(merged);
    expect(rebuilt.stockOf('panadol')).toBe(12);
    expect(rebuilt.stockOf('augmentin')).toBeNull();
  });
});
