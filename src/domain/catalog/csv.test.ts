/**
 * Reading the files that actually arrive.
 *
 * Every case here is something a real distributor list or competitor export
 * does: an Excel BOM, CRLF, quoted commas, "Rs 1,250/-", "1x10", a totals row,
 * headers spelled six ways, and the same medicine twice because somebody
 * edited it.
 *
 * The governing rule is that a row is failed rather than guessed at. A rejected
 * row is visible; a misread one is not, and a price out by a hundredfold or a
 * strength in the wrong field is the kind of wrong that reaches a patient.
 */

import { describe, expect, it } from 'vitest';

import {
  applyColumnOverrides,
  inferColumns,
  parseCatalogCsv,
  parseMoneyCell,
  parsePackSizeCell,
  rowsToPackProducts,
  splitCsv,
} from './csv';

describe('splitting the text', () => {
  it('handles the plain case', () => {
    expect(splitCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips the BOM Excel writes', () => {
    // Left in place it becomes part of the first header, which then matches
    // nothing and the file looks like it has no columns at all.
    const [headers] = splitCsv('﻿name,price\nPanadol,350');
    expect(headers?.[0]).toBe('name');
  });

  it('handles CRLF', () => {
    expect(splitCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a comma inside quotes', () => {
    const rows = splitCsv('name,formula\n"Augmentin","Amoxicillin, Clavulanic Acid"');
    expect(rows[1]).toEqual(['Augmentin', 'Amoxicillin, Clavulanic Acid']);
  });

  it('reads a doubled quote as a literal one', () => {
    expect(splitCsv('a\n"say ""hi"""')[1]).toEqual(['say "hi"']);
  });

  it('drops blank lines, which every hand-kept sheet has', () => {
    expect(splitCsv('a,b\n\n1,2\n,\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('guessing which column is which', () => {
  it('recognises the obvious headers', () => {
    expect(inferColumns(['Name', 'Company', 'Salt', 'Pack', 'MRP'])).toEqual([
      'name',
      'manufacturer',
      'formula',
      'packSize',
      'mrp',
    ]);
  });

  it('does not care about punctuation or case', () => {
    expect(inferColumns(['PRODUCT_NAME', 'Trade Price'])).toEqual(['name', 'mrp']);
  });

  it('gives a role to at most one column', () => {
    // A file with both "Price" and "Trade Price" must not map both to MRP and
    // silently keep whichever came last.
    const roles = inferColumns(['Name', 'Price', 'Trade Price']);
    expect(roles.filter((role) => role === 'mrp')).toHaveLength(1);
  });

  it('prefers an exact header over a partial one', () => {
    // "Code" partially matches the barcode hints; a column literally headed
    // "Barcode" must win it.
    const roles = inferColumns(['Name', 'Code', 'Barcode']);
    expect(roles[2]).toBe('barcode');
  });

  it('leaves a column it does not recognise alone', () => {
    const roles = inferColumns(['Name', 'Shelf Location']);
    expect(roles[1]).toBeNull();
  });
});

describe('reading a price cell', () => {
  it('reads the plain forms as integer paisa', () => {
    expect(parseMoneyCell('350')).toBe(35_000);
    expect(parseMoneyCell('350.00')).toBe(35_000);
    expect(parseMoneyCell('350.5')).toBe(35_050);
    expect(parseMoneyCell('350.07')).toBe(35_007);
  });

  it('reads the forms a Pakistani price list uses', () => {
    expect(parseMoneyCell('Rs 350')).toBe(35_000);
    expect(parseMoneyCell('PKR 350.00')).toBe(35_000);
    expect(parseMoneyCell('1,250.50')).toBe(125_050);
    expect(parseMoneyCell('350/-')).toBe(35_000);
  });

  it('returns null rather than zero for anything unreadable', () => {
    // Zero is a real price — it means free. Conflating it with "could not read
    // this" would import silence as a fact.
    expect(parseMoneyCell('on request')).toBeNull();
    expect(parseMoneyCell('')).toBeNull();
    expect(parseMoneyCell('12.345')).toBeNull();
    expect(parseMoneyCell('-50')).toBeNull();
  });

  it('reads zero as zero', () => {
    expect(parseMoneyCell('0')).toBe(0);
  });
});

describe('reading a pack size', () => {
  it('reads the forms a distributor writes', () => {
    expect(parsePackSizeCell('10')).toBe(10);
    expect(parsePackSizeCell("10's")).toBe(10);
    expect(parsePackSizeCell('strip of 10')).toBe(10);
    expect(parsePackSizeCell('10 tab')).toBe(10);
  });

  it('takes the units per pack from an "N x M"', () => {
    expect(parsePackSizeCell('1x10')).toBe(10);
    expect(parsePackSizeCell('2 x 15')).toBe(15);
  });

  it('returns null when there is no number', () => {
    expect(parsePackSizeCell('loose')).toBeNull();
    expect(parsePackSizeCell('')).toBeNull();
  });
});

describe('reading a whole file', () => {
  const file = [
    'Product Name,Company,Salt,Form,Strength,Pack,MRP',
    'Panadol,GSK,Paracetamol,Tablet,500mg,1x10,Rs 35.00',
    'Augmentin,GSK,"Amoxicillin, Clavulanic Acid",Tablet,875mg/125mg,1x6,Rs 350/-',
    'Brufen,Abbott,Ibuprofen,Tab,400mg,10\'s,45',
  ].join('\n');

  it('reads every row and counts what is usable', () => {
    const parsed = parseCatalogCsv(file);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.usableCount).toBe(3);
  });

  it('reads the values the way the rest of the system expects them', () => {
    const [panadol] = parseCatalogCsv(file).rows;
    expect(panadol?.name).toBe('Panadol');
    expect(panadol?.mrpPaisa).toBe(3_500);
    expect(panadol?.packSize).toBe(10);
    // Forms are canonicalised on the way in, so "Tab" and "Tablet" in the same
    // file do not become two different medicines.
    expect(panadol?.form).toBe('tablet');
    expect(panadol?.strengthParsed).toBe(true);
  });

  it('numbers rows the way the operator sees them in Excel', () => {
    // Line 1 is the header, so the first medicine is line 2. Off-by-one here
    // makes every reported problem point at the wrong row.
    expect(parseCatalogCsv(file).rows[0]?.line).toBe(2);
  });

  it('flags a row with no name instead of dropping it', () => {
    const parsed = parseCatalogCsv(`${file}\n,,,,,,`);
    // A blank-ish row is filtered as empty; one with any content is kept and
    // flagged, so 400 rows never quietly become 380.
    const withStray = parseCatalogCsv(`${file}\n,,,,,,99`);
    expect(withStray.rows).toHaveLength(4);
    expect(withStray.rows[3]?.problems).toContain('no-name');
    expect(parsed.usableCount).toBe(3);
  });

  it('flags an unreadable price rather than importing it as free', () => {
    const parsed = parseCatalogCsv(
      `${file}\nDisprin,Reckitt,Aspirin,Tablet,300mg,1x10,on request`,
    );
    expect(parsed.rows[3]?.problems).toContain('unreadable-price');
    expect(parsed.usableCount).toBe(3);
  });

  it('keeps the first of a repeated medicine and flags the second', () => {
    const parsed = parseCatalogCsv(`${file}\nPanadol,GSK,Paracetamol,Tab,0.5g,1x10,Rs 36`);
    // Same medicine — abbreviated form, strength in grams. The second is
    // flagged rather than silently overwriting, because "which one did it
    // take?" is a question nobody should have to ask.
    expect(parsed.rows[3]?.problems).toContain('duplicate-in-file');
    expect(parsed.rows[0]?.problems).toEqual([]);
  });

  it('does not call two brands of one molecule a duplicate', () => {
    const parsed = parseCatalogCsv(
      `${file}\nParacip,Cipla,Paracetamol,Tablet,500mg,1x10,Rs 30`,
    );
    // The distinction the whole catalogue rests on, applied at import.
    expect(parsed.rows[3]?.problems).toEqual([]);
  });

  it('reads a file whose columns are in another order', () => {
    const other = ['MRP,Item,Manufacturer', '35,Panadol,GSK'].join('\n');
    const parsed = parseCatalogCsv(other);
    expect(parsed.rows[0]?.name).toBe('Panadol');
    expect(parsed.rows[0]?.mrpPaisa).toBe(3_500);
  });

  it('accepts a corrected column mapping from the operator', () => {
    // The whole reason inference returns a guess rather than applying one.
    const odd = ['A,B', 'Panadol,GSK'].join('\n');
    const parsed = parseCatalogCsv(odd, ['name', 'manufacturer']);
    expect(parsed.rows[0]?.name).toBe('Panadol');
    expect(parsed.rows[0]?.manufacturer).toBe('GSK');
  });

  it('survives an empty file without throwing', () => {
    expect(parseCatalogCsv('').rows).toEqual([]);
    expect(parseCatalogCsv('name,price').rows).toEqual([]);
  });
});

describe('correcting the guessed mapping', () => {
  const guessed = inferColumns(['Name', 'Company', 'Junk', 'MRP']);

  it('changes only what is named', () => {
    const result = applyColumnOverrides(guessed, '2=strength');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns[0]).toBe('name');
      expect(result.columns[1]).toBe('manufacturer');
      expect(result.columns[2]).toBe('strength');
      expect(result.columns[3]).toBe('mrp');
    }
  });

  it('releases a role from wherever it was', () => {
    // A role belongs to one column. Two MRP columns would mean one of them
    // quietly winning, which is invisible after the import.
    const result = applyColumnOverrides(guessed, '2=mrp');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns.filter((role) => role === 'mrp')).toHaveLength(1);
      expect(result.columns[3]).toBeNull();
    }
  });

  it('ignores a column on request', () => {
    const result = applyColumnOverrides(guessed, '3=none');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.columns[3]).toBeNull();
  });

  it('takes several corrections at once', () => {
    const result = applyColumnOverrides(guessed, '2=strength,3=packSize');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns[2]).toBe('strength');
      expect(result.columns[3]).toBe('packSize');
    }
  });

  it('refuses a column that does not exist, naming how many there are', () => {
    const result = applyColumnOverrides(guessed, '9=name');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('4');
  });

  it('refuses an unknown role and lists the real ones', () => {
    const result = applyColumnOverrides(guessed, '0=colour');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('strength');
  });

  it('leaves the guess alone when nothing is specified', () => {
    const result = applyColumnOverrides(guessed, '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.columns).toEqual(guessed);
  });
});

describe('becoming a pack', () => {
  const file = [
    'Name,Company,Salt,Form,Strength,Pack,MRP',
    'Alpha,Acme,Alphamol,Tablet,500mg,1x10,Rs 35.00',
    'Beta,Acme,Betamol,Tablet,250mg,1x10,on request',
  ].join('\n');

  it('drops the rows that could not be read', () => {
    // The commit half of review-before-commit: by the time this runs, the
    // operator has already been shown what is being left out.
    const products = rowsToPackProducts(parseCatalogCsv(file).rows);
    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe('Alpha');
  });

  it('imports everything as reference, never as verified', () => {
    // Verified means somebody checked a real box (Phase 6 §5). A distributor's
    // spreadsheet has been checked by nobody, and laundering it into the tier
    // the catalogue's trustworthiness rests on would destroy the distinction.
    const products = rowsToPackProducts(parseCatalogCsv(file).rows);
    expect(products.every((product) => product.quality === 'reference')).toBe(true);
  });

  it('turns a pack size into a level above a neutral base unit', () => {
    const products = rowsToPackProducts(parseCatalogCsv(file).rows, { packLevelName: 'strip' });
    // "unit" rather than a guessed "tab": a distributor's "pack of 10" does not
    // say what the ten are, and a wrong base unit NAME is visible where a wrong
    // factor would silently corrupt stock arithmetic.
    expect(products[0]?.packLevels).toEqual([
      { name: 'unit', factor: 1 },
      { name: 'strip', factor: 10 },
    ]);
  });

  it('carries the price through as integer paisa', () => {
    const products = rowsToPackProducts(parseCatalogCsv(file).rows);
    expect(products[0]?.referenceMrpPaisa).toBe(3_500);
  });

  it('only keeps a barcode that looks like one', () => {
    const withCodes = [
      'Name,Barcode',
      'Good,8964000900011',
      'Bad,N/A',
    ].join('\n');
    const products = rowsToPackProducts(parseCatalogCsv(withCodes).rows);
    expect(products[0]?.barcodes).toHaveLength(1);
    // A barcode index is unique; importing "N/A" once would block every later
    // product whose code was also unreadable.
    expect(products[1]?.barcodes).toBeUndefined();
  });
});
