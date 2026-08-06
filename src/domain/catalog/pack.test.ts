/**
 * The pack format, and the ways a catalogue file goes wrong in the field.
 *
 * These are not schema-validation exercises. Each case is a thing that will
 * actually happen once packs are being emailed and copied onto pharmacy
 * machines: a truncated download, a file from a newer Mehvar, a curator's
 * export with rupees where paisa belong.
 */

import { describe, expect, it } from 'vitest';

import {
  compareCatalogVersions,
  describeProblem,
  PACK_FORMAT,
  readPack,
  readPackJson,
} from './pack';

const product = {
  name: 'Panadol',
  manufacturer: 'GSK',
  formulaText: 'Paracetamol',
  form: 'Tablet',
  strength: '500mg',
  packLevels: [{ name: 'strip', factor: 10 }],
  referenceMrpPaisa: 350,
  quality: 'verified' as const,
};

const pack = {
  format: PACK_FORMAT,
  catalogVersion: '2026.08.1',
  generatedAt: '2026-08-06T00:00:00Z',
  productCount: 1,
  products: [product],
};

describe('reading a good pack', () => {
  it('accepts it and keeps the products', () => {
    const result = readPack(pack);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.products).toHaveLength(1);
      expect(result.pack.catalogVersion).toBe('2026.08.1');
    }
  });

  it('does not require the optional fields', () => {
    const result = readPack({
      ...pack,
      products: [{ name: 'Some Local Item', quality: 'reference' }],
    });
    expect(result.ok).toBe(true);
  });
});

describe('a pack this build must refuse', () => {
  it('refuses a newer format outright rather than importing what it recognises', () => {
    // The important half is that it does NOT partially import. A catalogue
    // where some fields silently did not arrive is worse than an old one,
    // because nobody can tell which fields are missing.
    const result = readPack({ ...pack, format: PACK_FORMAT + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.kind).toBe('format-too-new');
      expect(describeProblem(result.problem)).toContain('Update Mehvar');
    }
  });

  it('catches a file cut short in transit', () => {
    const result = readPack({ ...pack, productCount: 5000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.kind).toBe('count-mismatch');
      expect(describeProblem(result.problem)).toContain('cut short');
    }
  });

  it('rejects rupees where paisa belong', () => {
    // A curator exporting 350.50 rather than 35050 is a hundredfold error in
    // the one field that looks plausible either way.
    const result = readPack({
      ...pack,
      products: [{ ...product, referenceMrpPaisa: 350.5 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.kind).toBe('bad-product');
  });

  it('names which medicine is unusable, in the operator’s numbering', () => {
    const result = readPack({
      ...pack,
      productCount: 2,
      products: [product, { name: '', quality: 'verified' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(describeProblem(result.problem)).toContain('Medicine 2');
    }
  });

  it('rejects an unknown quality rather than defaulting it', () => {
    // Defaulting to "verified" would launder unreviewed data into the tier the
    // whole catalogue's trustworthiness rests on (Phase 6 §5).
    const result = readPack({
      ...pack,
      products: [{ ...product, quality: 'probably-fine' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a nonsense pack level', () => {
    const result = readPack({
      ...pack,
      products: [{ ...product, packLevels: [{ name: 'strip', factor: 0 }] }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty catalogue instead of wiping nothing over something', () => {
    const result = readPack({ ...pack, productCount: 0, products: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.kind).toBe('no-products');
  });

  it('turns a JSON syntax error into a readable problem', () => {
    const result = readPackJson('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.kind).toBe('unreadable');
      expect(describeProblem(result.problem)).toContain('not a catalogue pack');
    }
  });
});

describe('comparing catalogue versions', () => {
  it('orders by segment, not alphabetically', () => {
    // The whole reason this function exists: "2026.8.9" sorts after
    // "2026.8.10" as text, which would let an import silently go backwards.
    expect(compareCatalogVersions('2026.8.10', '2026.8.9')).toBe(1);
    expect(compareCatalogVersions('2026.8.9', '2026.8.10')).toBe(-1);
  });

  it('treats equal versions as equal', () => {
    expect(compareCatalogVersions('2026.08.1', '2026.08.1')).toBe(0);
  });

  it('orders across months and years', () => {
    expect(compareCatalogVersions('2026.9.1', '2026.8.99')).toBe(1);
    expect(compareCatalogVersions('2027.1.1', '2026.12.9')).toBe(1);
  });

  it('rejects a version that is not YYYY.MM.N', () => {
    const result = readPack({ ...pack, catalogVersion: 'august-2026' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.kind).toBe('bad-version');
  });
});
