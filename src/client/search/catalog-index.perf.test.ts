/**
 * Scale characteristics at a realistic catalog size.
 *
 * Phase 6 §3.2 sizes the curated head at 1,500–3,000 SKUs, and ADR-4 asserts
 * that "a tenant catalog of a few thousand items is trivially memory-resident".
 * This file holds that claim to account against 3,000 products, because the
 * failure mode is invisible on a 53-product seed: a naive implementation — scan
 * the catalog, edit-distance every product, per keystroke — feels instant in a
 * demo and misses I2's budget at the counter.
 *
 * ## How to read the thresholds
 *
 * These are algorithmic guards, not latency budgets. I2 sets the real
 * expectation ("search feels instant") and says the numbers are "verified during
 * implementation against real hardware" — an aging Windows PC (Phase 2), not
 * this machine. So the bounds below are deliberately loose: generous enough that
 * a slow or contended CI box passes, tight enough that losing the trigram
 * prefilter or the prefix binary search fails.
 *
 * The ratio assertions matter more than the absolute ones. A per-keystroke cost
 * that grows linearly with catalog size is the regression worth catching, and no
 * absolute threshold catches it as reliably as comparing 300 products to 3,000.
 */

import { describe, expect, it } from 'vitest';

import { CatalogIndex, type CatalogPayload, type IndexedProduct } from './catalog-index';

/**
 * Brand names are generated from syllable pairs rather than a short list of
 * stems with many variants each.
 *
 * This matters more than it looks. A catalog of twenty stems × a hundred
 * variants gives every brand trigram a hundred-entry posting list, which is not
 * what a real catalog looks like — Phase 6 §3.2's curated head is a couple of
 * thousand *distinct* brands with a handful of strengths apiece. Testing against
 * the adversarial shape hid a recall cliff: postings grew past the stopword
 * ceiling and fuzzy matching silently stopped running, which a timing assertion
 * would never have caught.
 */
const PREFIXES = [
  'Pan',
  'Bru',
  'Aug',
  'Ris',
  'Ven',
  'Glu',
  'Cal',
  'Fla',
  'Mot',
  'Con',
  'Ama',
  'Lip',
  'Zyr',
  'Nex',
  'Vel',
  'Azo',
  'Cip',
  'Kla',
  'Ten',
  'Nor',
  'Sur',
  'Dis',
  'Poly',
  'Bet',
  'Pyo',
  'Rem',
  'Tora',
  'Qal',
  'San',
  'Hyd',
];

const SUFFIXES = [
  'adol',
  'fen',
  'mentin',
  'sek',
  'tolin',
  'cophage',
  'pol',
  'gyl',
  'lium',
  'cor',
  'ryl',
  'itor',
  'tec',
  'xum',
  'osef',
  'max',
  'roxin',
  'ricid',
  'ormin',
  'vasc',
  'bex',
  'prin',
  'fax',
  'dine',
  'zole',
  'cillin',
  'mycin',
  'pride',
  'sartan',
  'olol',
];

const SALTS = [
  'Paracetamol',
  'Ibuprofen',
  'Amoxicillin',
  'Omeprazole',
  'Salbutamol',
  'Metformin',
  'Metronidazole',
  'Domperidone',
  'Bisoprolol',
  'Glimepiride',
  'Atorvastatin',
  'Cetirizine',
  'Esomeprazole',
  'Cephradine',
  'Azithromycin',
];

const MAKERS = ['GSK', 'Abbott', 'Getz Pharma', 'Merck', 'Sanofi', 'Pfizer', 'Searle', 'Hilton'];
const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Sachet'];

/**
 * A synthetic catalog shaped like a real one: ~900 distinct brand names, a
 * handful of strengths each, salts shared widely across brands (which is true —
 * dozens of brands are paracetamol), and one deliberately crowded brand so the
 * stopword ceiling is exercised rather than merely present.
 *
 * "Panadol" is always present and always the shortest of its family, so the
 * ranking assertions below mean the same thing at every catalog size.
 */
function syntheticCatalog(count: number): IndexedProduct[] {
  const products: IndexedProduct[] = [
    {
      id: 'panadol',
      name: 'Panadol',
      strength: '500mg',
      form: 'Tablet',
      manufacturer: 'GSK',
      formulaText: 'Paracetamol',
      baseUnitName: 'tab',
      packLevels: [{ name: 'strip', factor: 10 }],
      pricePaisa: 350,
      mrpPaisa: 350,
      needsCompletion: false,
    },
  ];

  for (let i = products.length; i < count; i += 1) {
    const prefix = PREFIXES[i % PREFIXES.length] ?? 'Pan';
    const suffix = SUFFIXES[Math.floor(i / PREFIXES.length) % SUFFIXES.length] ?? 'adol';
    const salt = SALTS[i % SALTS.length] ?? 'Paracetamol';
    const maker = MAKERS[i % MAKERS.length] ?? 'GSK';
    const form = FORMS[i % FORMS.length] ?? 'Tablet';
    // Beyond the 900 combinations, brands acquire a strength-bearing variant —
    // the same way a real catalog carries Concor 5 and Concor 10.
    const generation = Math.floor(i / (PREFIXES.length * SUFFIXES.length));
    const base = `${prefix}${suffix}`;
    const name = generation === 0 ? base : `${base} ${generation * 5}`;

    products.push({
      id: `product-${i}`,
      name,
      strength: `${((i % 20) + 1) * 25}mg`,
      form,
      manufacturer: maker,
      formulaText: i % 3 === 0 ? `${salt} + Excipients` : salt,
      baseUnitName: 'tab',
      packLevels: [
        { name: 'strip', factor: 10 },
        { name: 'box', factor: 100 },
      ],
      pricePaisa: 100 + i,
      mrpPaisa: 100 + i,
      needsCompletion: false,
    });
  }
  return products;
}

function payloadOf(count: number): CatalogPayload {
  const products = syntheticCatalog(count);
  return {
    products,
    barcodes: products
      .filter((_, i) => i % 4 === 0)
      .map((p, i) => ({
        barcode: `896400${String(1_000_000 + i).slice(0, 7)}`,
        productId: p.id,
        unitLevelName: 'strip',
      })),
    stock: Object.fromEntries(products.map((p, i) => [p.id, i % 7 === 0 ? 0 : (i % 500) + 1])),
    syncedAt: '2026-07-30T00:00:00.000Z',
  };
}

/** Median of repeated runs — less noisy than a single sample or a mean. */
function medianMs(runs: number, body: () => void): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    body();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
}

const CATALOG_SIZE = 3_000;

/** Every keystroke of someone typing their way to a product. */
const KEYSTROKES = ['p', 'pa', 'pan', 'pana', 'panad', 'panado', 'panadol'];

/** The realistic worst case: a misspelling that engages fuzzy matching. */
const MISSPELLINGS = ['pandol', 'penadol', 'brufan', 'agmentin', 'glukophage', 'wentolin'];

/**
 * Misspellings that must still resolve to a specific product at any catalog size.
 *
 * Deliberately only the fuzzy cases. Which *prefix* match wins depends on what
 * else the catalog holds — among 900 synthetic brands, "pan" legitimately finds
 * the shortest "pan…" name, not necessarily Panadol. Pinning a prefix winner is
 * the ranking table's job, against the real vocabulary.
 */
const RECALL_CASES: Array<[query: string, expected: string]> = [
  ['panadol', 'Panadol'],
  ['pandol', 'Panadol'],
  ['penadol', 'Panadol'],
  ['panadlo', 'Panadol'],
];

describe(`a ${CATALOG_SIZE.toLocaleString()}-product catalog`, () => {
  const payload = payloadOf(CATALOG_SIZE);
  const index = CatalogIndex.build(payload);

  it('indexes every product and barcode', () => {
    expect(index.size).toBe(CATALOG_SIZE);
    expect(index.barcodeCount).toBeGreaterThan(0);
  });

  it('builds once, in well under a second', () => {
    // Paid once on session start, off the sale path entirely.
    const elapsed = medianMs(3, () => {
      CatalogIndex.build(payload);
    });
    expect(elapsed).toBeLessThan(1_500);
  });

  it('answers each keystroke of a full word quickly', () => {
    const elapsed = medianMs(20, () => {
      for (const keystroke of KEYSTROKES) {
        index.search(keystroke);
      }
    });
    // Seven keystrokes together, not each.
    expect(elapsed).toBeLessThan(60);
  });

  it('answers a misspelling quickly — the fuzzy path is the expensive one', () => {
    const elapsed = medianMs(20, () => {
      for (const query of MISSPELLINGS) {
        index.search(query);
      }
    });
    expect(elapsed).toBeLessThan(60);
  });

  it('answers a multi-term "brand + strength" query quickly', () => {
    // The "pan 40" shape: a name term plus a short strength term, at scale. The
    // anchor-and-verify path must not turn this into a catalog walk.
    const queries = ['pan 40', 'pan 100', 'brufen 200', 'tab pan 25', 'panadol 5'];
    const elapsed = medianMs(20, () => {
      for (const query of queries) {
        index.search(query);
      }
    });
    expect(elapsed).toBeLessThan(60);
  });

  it('resolves a barcode in constant time', () => {
    const code = payload.barcodes[10]?.barcode ?? '';
    expect(index.resolveBarcode(code)).toBeDefined();

    const elapsed = medianMs(50, () => {
      for (let i = 0; i < 100; i += 1) {
        index.resolveBarcode(code);
      }
    });
    expect(elapsed).toBeLessThan(20);
  });

  it('still ranks correctly at this size — speed is worthless if it is wrong', () => {
    expect(index.search('panadol')[0]?.product.name).toBe('Panadol');
    expect(index.search('pandol')[0]?.product.name).toBe('Panadol');
    expect(index.search('ibuprofen')[0]?.matchedOn).toBe('formula');

    // A prefix query returns prefix matches, and the exact product is in the page.
    const prefixHits = index.search('pan', 25);
    expect(prefixHits.length).toBeGreaterThan(0);
    expect(prefixHits.every((hit) => hit.product.name.toLowerCase().startsWith('pan'))).toBe(true);
    expect(prefixHits.map((hit) => hit.product.name)).toContain('Panadol');
  });

  it('caps the result set regardless of how many products match', () => {
    // A one-character query matches thousands. It must still return a page.
    expect(index.search('p').length).toBeLessThanOrEqual(10);
    expect(index.search('p', 25).length).toBeLessThanOrEqual(25);
  });
});

describe('growth beyond the target size', () => {
  /**
   * The assertion that actually guards the architecture.
   *
   * 3,000 is the plan's ceiling; 12,000 is four times it. Both sizes sit above
   * the point where the work ceilings bind, so a bounded design comes in near
   * flat while a catalog scan comes in near 4×. The threshold sits between those
   * outcomes, far enough from 1 to survive a noisy machine.
   *
   * This is the test that caught the original mistake: a stopword ceiling
   * expressed as a *share* of the catalog grows with the catalog, so per-keystroke
   * work scaled linearly while looking capped.
   */
  it('4× the target catalog does not cost 4× per query', () => {
    const target = CatalogIndex.build(payloadOf(3_000));
    const oversized = CatalogIndex.build(payloadOf(12_000));

    const queries = [...KEYSTROKES, ...MISSPELLINGS];
    const run = (index: CatalogIndex) =>
      medianMs(25, () => {
        for (const query of queries) {
          index.search(query);
        }
      });

    const targetMs = Math.max(run(target), 0.05);
    const ratio = run(oversized) / targetMs;

    expect(ratio).toBeLessThan(2);
  });

  /**
   * Speed is easy to get by matching less. These assert the opposite side of the
   * trade: a bigger catalog must not quietly lose recall, which is exactly what
   * a too-aggressive stopword ceiling does.
   */
  it.each([3_000, 12_000])('still resolves misspellings at %i products', (size) => {
    const index = CatalogIndex.build(payloadOf(size));
    for (const [query, expected] of RECALL_CASES) {
      expect(index.search(query)[0]?.product.name, `"${query}"`).toBe(expected);
    }
  });
});
