import { describe, expect, it } from 'vitest';

import {
  exceedsMrp,
  packStructureChange,
  validateBarcode,
  validatePackLevels,
  validateProductDraft,
  type ProductDraft,
} from './product';

function draft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    name: 'Panadol',
    globalProductId: null,
    manufacturer: 'GSK',
    form: 'Tablet',
    strength: '500mg',
    formulaText: 'Paracetamol',
    baseUnitName: 'tab',
    packLevels: [
      { name: 'strip', factor: 10 },
      { name: 'box', factor: 200 },
    ],
    pricePaisa: 350,
    mrpPaisa: 350,
    minStockBaseUnits: 400,
    needsCompletion: false,
    ...overrides,
  };
}

function reasons(result: ReturnType<typeof validateProductDraft>): string[] {
  return result.ok ? [] : result.rejections.map((rejection) => rejection.reason);
}

describe('pack levels — the structure stock arithmetic depends on', () => {
  it('accepts a normal medicine', () => {
    expect(validatePackLevels([{ name: 'strip', factor: 10 }], 'tab')).toEqual([]);
  });

  it('accepts a single-level product (Phase 5 §2: pharmacies sell sundries too)', () => {
    expect(validatePackLevels([], 'piece')).toEqual([]);
  });

  it('rejects a factor of one — that is the base unit, not a level above it', () => {
    expect(validatePackLevels([{ name: 'strip', factor: 1 }], 'tab')).toEqual([
      { reason: 'pack_level_factor_invalid', index: 0 },
    ]);
  });

  it('rejects fractional and negative factors', () => {
    expect(validatePackLevels([{ name: 'strip', factor: 10.5 }], 'tab')).toHaveLength(1);
    expect(validatePackLevels([{ name: 'strip', factor: -10 }], 'tab')).toHaveLength(1);
  });

  it('rejects a level that shadows the base unit', () => {
    expect(validatePackLevels([{ name: 'Tab', factor: 10 }], 'tab')).toEqual([
      { reason: 'pack_level_collides_with_base', name: 'Tab' },
    ]);
  });

  it('rejects duplicate level names', () => {
    const rejections = validatePackLevels(
      [
        { name: 'strip', factor: 10 },
        { name: 'Strip', factor: 20 },
      ],
      'tab',
    );
    expect(rejections).toContainEqual({ reason: 'pack_level_duplicate_name', name: 'Strip' });
  });

  it('rejects out-of-order factors', () => {
    // The natural-language renderer walks levels largest-first; an unsorted list
    // decomposes "1 box + 3 strip" incorrectly and nobody notices until a receipt
    // reads wrong.
    const rejections = validatePackLevels(
      [
        { name: 'box', factor: 200 },
        { name: 'strip', factor: 10 },
      ],
      'tab',
    );
    expect(rejections).toEqual([{ reason: 'pack_level_not_ascending', index: 1 }]);
  });
});

describe('pack sizes nest (PCN-012)', () => {
  it('accepts a box that holds whole strips', () => {
    expect(
      validatePackLevels(
        [
          { name: 'strip', factor: 10 },
          { name: 'box', factor: 100 },
        ],
        'tab',
      ),
    ).toEqual([]);
  });

  it('refuses a box that holds two and a half strips, naming the level below', () => {
    // No screen can state 25 tablets as boxes and strips truthfully.
    expect(
      validatePackLevels(
        [
          { name: 'strip', factor: 10 },
          { name: 'box', factor: 25 },
        ],
        'tab',
      ),
    ).toEqual([{ reason: 'pack_level_not_nested', index: 1, below: 'strip' }]);
  });

  it('exempts levels an edit keeps unchanged, but not one it adds', () => {
    const legacy = [
      { name: 'strip', factor: 10 },
      { name: 'box', factor: 25 },
    ];
    // A product already trading with this structure can still have its price edited.
    expect(validatePackLevels(legacy, 'tab', 2)).toEqual([]);
    // A carton added on top must nest in the box below it.
    expect(validatePackLevels([...legacy, { name: 'carton', factor: 60 }], 'tab', 2)).toEqual([
      { reason: 'pack_level_not_nested', index: 2, below: 'box' },
    ]);
    expect(validatePackLevels([...legacy, { name: 'carton', factor: 250 }], 'tab', 2)).toEqual([]);
  });

  it('reaches the draft validator', () => {
    const result = validateProductDraft(
      draft({
        packLevels: [
          { name: 'strip', factor: 10 },
          { name: 'box', factor: 25 },
        ],
      }),
    );
    expect(reasons(result)).toEqual(['pack_level_not_nested']);
  });
});

describe('what an edit does to a product’s units (PCN-012)', () => {
  const current = {
    baseUnitName: 'tab',
    packLevels: [
      { name: 'strip', factor: 10 },
      { name: 'box', factor: 100 },
    ],
  };

  it('the same units are unchanged, whitespace aside', () => {
    expect(packStructureChange(current, { ...current, baseUnitName: ' tab ' })).toBe('unchanged');
  });

  it('a larger pack added on top extends it', () => {
    expect(
      packStructureChange(current, {
        ...current,
        packLevels: [...current.packLevels, { name: 'carton', factor: 1000 }],
      }),
    ).toBe('extended');
  });

  it('a quick item gaining its strip during completion extends it', () => {
    expect(
      packStructureChange(
        { baseUnitName: 'tab', packLevels: [] },
        { baseUnitName: 'tab', packLevels: [{ name: 'strip', factor: 10 }] },
      ),
    ).toBe('extended');
  });

  it('a new base unit, a new pack size, a removed pack, a rename or an insertion change it', () => {
    expect(packStructureChange(current, { ...current, baseUnitName: 'strip' })).toBe('changed');
    expect(
      packStructureChange(current, {
        ...current,
        packLevels: [
          { name: 'strip', factor: 10 },
          { name: 'box', factor: 200 },
        ],
      }),
    ).toBe('changed');
    expect(
      packStructureChange(current, { ...current, packLevels: [{ name: 'strip', factor: 10 }] }),
    ).toBe('changed');
    expect(
      packStructureChange(current, {
        ...current,
        packLevels: [
          { name: 'Strip', factor: 10 },
          { name: 'box', factor: 100 },
        ],
      }),
    ).toBe('changed');
    // A level slipped in BELOW an existing one renumbers it, so it is not an extension.
    expect(
      packStructureChange(current, {
        ...current,
        packLevels: [
          { name: 'pair', factor: 2 },
          { name: 'strip', factor: 10 },
          { name: 'box', factor: 100 },
        ],
      }),
    ).toBe('changed');
  });
});

describe('product drafts', () => {
  it('accepts a well-formed draft and trims it', () => {
    const result = validateProductDraft(draft({ name: '  Panadol  ', manufacturer: '   ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Panadol');
      // Blank optional fields become null rather than empty strings, so search
      // and the result row never render an empty secondary line.
      expect(result.value.manufacturer).toBeNull();
    }
  });

  it('requires a name and a base unit', () => {
    expect(reasons(validateProductDraft(draft({ name: '   ' })))).toContain('name_required');
    expect(reasons(validateProductDraft(draft({ baseUnitName: '' })))).toContain(
      'base_unit_required',
    );
  });

  it('requires an integer price in paisa', () => {
    expect(reasons(validateProductDraft(draft({ pricePaisa: 12.5 })))).toContain('price_required');
    expect(reasons(validateProductDraft(draft({ pricePaisa: Number.NaN })))).toContain(
      'price_required',
    );
    expect(reasons(validateProductDraft(draft({ pricePaisa: -1 })))).toContain('price_negative');
  });

  it('allows a zero price — a free sample is a real line, and P2 forbids a wall', () => {
    expect(validateProductDraft(draft({ pricePaisa: 0 })).ok).toBe(true);
  });

  it('allows a product with no MRP recorded', () => {
    expect(validateProductDraft(draft({ mrpPaisa: null })).ok).toBe(true);
  });

  it('rejects a negative minimum stock level', () => {
    expect(reasons(validateProductDraft(draft({ minStockBaseUnits: -5 })))).toContain(
      'min_stock_negative',
    );
  });

  it('reports every problem at once, not one at a time', () => {
    const result = validateProductDraft(draft({ name: '', baseUnitName: '', pricePaisa: -1 }));
    expect(reasons(result).length).toBeGreaterThanOrEqual(3);
  });
});

describe('MRP is a ceiling that warns, never blocks (D4)', () => {
  it('warns when the price is above recorded MRP', () => {
    expect(exceedsMrp(400, 350)).toBe(true);
  });

  it('says nothing when at or below MRP, or when no MRP is known', () => {
    expect(exceedsMrp(350, 350)).toBe(false);
    expect(exceedsMrp(300, 350)).toBe(false);
    expect(exceedsMrp(400, null)).toBe(false);
  });

  it('is a warning, not a rejection — the pack in hand is authoritative', () => {
    expect(validateProductDraft(draft({ pricePaisa: 9_999, mrpPaisa: 350 })).ok).toBe(true);
  });
});

describe('barcodes map to a unit level', () => {
  const levels = [
    { name: 'strip', factor: 10 },
    { name: 'box', factor: 200 },
  ];

  it('accepts a code against any known level, including the base unit', () => {
    expect(
      validateBarcode({ barcode: '8964000101018', unitLevelName: 'box' }, 'tab', levels).ok,
    ).toBe(true);
    expect(
      validateBarcode({ barcode: '8964000101018', unitLevelName: 'tab' }, 'tab', levels).ok,
    ).toBe(true);
  });

  it('saves a pack’s 2D code as its GTIN, not one batch’s full string', () => {
    const result = validateBarcode(
      { barcode: '01080026600316931728053110892302XV', unitLevelName: 'box' },
      'tab',
      levels,
    );
    expect(result.ok && result.value.barcode).toBe('08002660031693');
  });

  it('strips the whitespace a scanner sometimes emits', () => {
    const result = validateBarcode(
      { barcode: ' 8964 000101018 ', unitLevelName: 'strip' },
      'tab',
      levels,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.barcode).toBe('8964000101018');
    }
  });

  it('rejects a level the product does not define', () => {
    const result = validateBarcode(
      { barcode: '8964000101018', unitLevelName: 'carton' },
      'tab',
      levels,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toContainEqual({
        reason: 'barcode_unknown_unit_level',
        unitLevelName: 'carton',
      });
    }
  });

  it('rejects an empty code', () => {
    const result = validateBarcode({ barcode: '  ', unitLevelName: 'strip' }, 'tab', levels);
    expect(result.ok).toBe(false);
  });
});
