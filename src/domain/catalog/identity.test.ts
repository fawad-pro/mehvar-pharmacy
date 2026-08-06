/**
 * Duplicate versus alternative — the distinction the whole catalogue rests on.
 *
 * The failure to avoid is not "misses a duplicate". It is "merges two medicines
 * a pharmacy stocks on purpose", because that destroys real inventory and the
 * operator cannot undo it by typing more carefully. Every assertion here is
 * pointed at one of those two directions, and where they conflict the tests
 * pick the safe one.
 */

import { describe, expect, it } from 'vitest';

import {
  equivalenceKey,
  findCatalogMatches,
  identityKey,
  normaliseFormula,
  normaliseManufacturer,
  normaliseText,
  type MedicineIdentity,
} from './identity';

const PANADOL: MedicineIdentity = {
  name: 'Panadol',
  strength: '500mg',
  form: 'Tablet',
  manufacturer: 'GSK',
  formulaText: 'Paracetamol',
};

describe('normalising the pieces', () => {
  it('folds case and punctuation but keeps word boundaries', () => {
    expect(normaliseText('Panadol  Extra!')).toBe('panadol extra');
    // "Panadol Extra" is a different medicine from "Panadol". A normaliser
    // that removed the space would be one step from merging them.
    expect(normaliseText('Panadol Extra')).not.toBe(normaliseText('PanadolExtra'));
  });

  it('strips the legal furniture off a company name', () => {
    const canonical = normaliseManufacturer('Getz Pharma');
    expect(normaliseManufacturer('Getz Pharma (Pvt) Ltd')).toBe(canonical);
    expect(normaliseManufacturer('GETZ PHARMA PRIVATE LIMITED')).toBe(canonical);
    expect(normaliseManufacturer('Getz Pharmaceuticals')).toBe(canonical);
  });

  it('does not collapse a company whose name IS the furniture', () => {
    // Stripping everything would leave an empty string and make every such
    // company identical to every other.
    expect(normaliseManufacturer('Pharma Ltd')).not.toBe('');
    expect(normaliseManufacturer('Pharma Ltd')).not.toBe(normaliseManufacturer('Labs Pvt Ltd'));
  });

  it('splits a formula on every separator a label uses', () => {
    expect(normaliseFormula('Paracetamol + Caffeine')).toEqual(['paracetamol', 'caffeine']);
    expect(normaliseFormula('Amoxicillin and Clavulanic Acid')).toEqual([
      'amoxicillin',
      'clavulanic acid',
    ]);
    expect(normaliseFormula('Paracetamol BP')).toEqual(['paracetamol']);
  });
});

describe('identity — have I already got this?', () => {
  it('matches the same product typed carelessly', () => {
    expect(identityKey({ ...PANADOL, name: 'PANADOL', form: 'tab', strength: '500 mg' })).toBe(
      identityKey(PANADOL),
    );
  });

  it('matches the same strength written in another unit', () => {
    expect(identityKey({ ...PANADOL, strength: '0.5g' })).toBe(identityKey(PANADOL));
  });

  it('separates a different strength', () => {
    expect(identityKey({ ...PANADOL, strength: '650mg' })).not.toBe(identityKey(PANADOL));
  });

  it('separates a different form', () => {
    expect(identityKey({ ...PANADOL, form: 'Syrup' })).not.toBe(identityKey(PANADOL));
  });

  it('separates the same brand from a different manufacturer', () => {
    // Two companies selling a similarly named product is normal in Pakistan,
    // and they are separately stocked and separately priced.
    expect(identityKey({ ...PANADOL, manufacturer: 'Highnoon' })).not.toBe(identityKey(PANADOL));
  });

  it('does not match a recorded manufacturer against a missing one', () => {
    expect(identityKey({ ...PANADOL, manufacturer: null })).not.toBe(identityKey(PANADOL));
  });

  it('still deduplicates a strength it cannot parse, against itself', () => {
    const odd = { ...PANADOL, strength: 'as directed' };
    expect(identityKey(odd)).toBe(identityKey({ ...odd, strength: 'AS DIRECTED' }));
    expect(identityKey(odd)).not.toBe(identityKey(PANADOL));
  });
});

describe('equivalence — can I give this instead?', () => {
  it('matches two brands of the same molecule, strength and form', () => {
    const paracip = {
      name: 'Paracip',
      strength: '500mg',
      form: 'Tablet',
      manufacturer: 'Cipla',
      formulaText: 'Paracetamol',
    };
    expect(equivalenceKey(paracip)).toBe(equivalenceKey(PANADOL));
    // …and they are emphatically NOT the same product.
    expect(identityKey(paracip)).not.toBe(identityKey(PANADOL));
  });

  it('is null without a formula, rather than guessing from the brand', () => {
    expect(equivalenceKey({ ...PANADOL, formulaText: null })).toBeNull();
  });

  it('keeps ingredients attached to their own amounts', () => {
    // The subtle one. Sorting strengths and ingredients independently would
    // make these two identical; they are different medicines.
    const augmentin = {
      name: 'Augmentin',
      strength: '875mg/125mg',
      form: 'Tablet',
      formulaText: 'Amoxicillin + Clavulanic Acid',
    };
    const swapped = { ...augmentin, strength: '125mg/875mg' };
    expect(equivalenceKey(swapped)).not.toBe(equivalenceKey(augmentin));
  });

  it('recognises the same combination written in the other order', () => {
    // Same medicine, ingredients listed the other way round with the amounts
    // moved to match. This must collapse to one key.
    const written = {
      name: 'Augmentin',
      strength: '875mg/125mg',
      form: 'Tablet',
      formulaText: 'Amoxicillin + Clavulanic Acid',
    };
    const reversed = {
      ...written,
      strength: '125mg/875mg',
      formulaText: 'Clavulanic Acid + Amoxicillin',
    };
    expect(equivalenceKey(reversed)).toBe(equivalenceKey(written));
  });

  it('separates the same molecule in a different form', () => {
    expect(equivalenceKey({ ...PANADOL, form: 'Syrup' })).not.toBe(equivalenceKey(PANADOL));
  });
});

describe('checking a candidate against the shelf', () => {
  const shelf: MedicineIdentity[] = [
    PANADOL,
    { name: 'Paracip', strength: '500mg', form: 'Tablet', manufacturer: 'Cipla', formulaText: 'Paracetamol' },
    { name: 'Panadol', strength: '650mg', form: 'Tablet', manufacturer: 'GSK', formulaText: 'Paracetamol' },
    { name: 'Brufen', strength: '400mg', form: 'Tablet', manufacturer: 'Abbott', formulaText: 'Ibuprofen' },
  ];

  const check = (candidate: MedicineIdentity) =>
    findCatalogMatches(candidate, shelf, { identify: (item) => item });

  it('calls an exact re-entry a duplicate', () => {
    const matches = check({ ...PANADOL, name: 'panadol', form: 'TAB' });
    expect(matches[0]?.kind).toBe('duplicate');
    expect(matches[0]?.product.name).toBe('Panadol');
  });

  it('reports duplicates before anything else', () => {
    const matches = check({ ...PANADOL, name: 'panadol' });
    expect(matches.map((match) => match.kind)[0]).toBe('duplicate');
  });

  it('warns when the brand matches but the strength does not', () => {
    // The safety-shaped check: either a real second line or a mistyped dose.
    const matches = check({
      name: 'Panadol',
      strength: '750mg',
      form: 'Tablet',
      manufacturer: 'GSK',
      formulaText: 'Paracetamol',
    });
    expect(matches.some((match) => match.kind === 'strength-differs')).toBe(true);
    expect(matches.some((match) => match.kind === 'duplicate')).toBe(false);
  });

  it('calls another brand of the same molecule an alternative, never a duplicate', () => {
    const matches = check({
      name: 'Calpol',
      strength: '500mg',
      form: 'Tablet',
      manufacturer: 'GSK',
      formulaText: 'Paracetamol',
    });
    expect(matches.every((match) => match.kind === 'alternative')).toBe(true);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('says nothing about an unrelated medicine', () => {
    expect(
      check({
        name: 'Ventolin',
        strength: '100mcg',
        form: 'Inhaler',
        manufacturer: 'GSK',
        formulaText: 'Salbutamol',
      }),
    ).toEqual([]);
  });

  it('does not report a product as its own duplicate when it is being edited', () => {
    const withIds = shelf.map((item, index) => ({ ...item, id: `p${index}` }));
    const matches = findCatalogMatches(PANADOL, withIds, {
      identify: (item) => item,
      idOf: (item) => item.id,
      ignoreId: 'p0',
    });
    expect(matches.some((match) => match.kind === 'duplicate')).toBe(false);
  });
});
