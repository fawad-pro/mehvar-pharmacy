import { describe, expect, it } from 'vitest';

import {
  barcodeKeys,
  barcodeToStore,
  cleanScannedCode,
  gtinFromElementString,
  looksLikeScannedCode,
} from './barcode';

/** The pack scanned at the counter: (01) GTIN, (17) 2028-05-31, (10) batch. */
const PACK = '01080026600316931728053110892302XV';
const GTIN14 = '08002660031693';
const EAN13 = '8002660031693';

describe('reading a GS1 pack code', () => {
  it('finds the GTIN in the code as the scanner typed it', () => {
    expect(gtinFromElementString(PACK)).toBe(GTIN14);
  });

  it('tolerates the scanner’s framing: AIM prefix, GS separators, stray whitespace', () => {
    expect(gtinFromElementString(`]d2${PACK}`)).toBe(GTIN14);
    expect(gtinFromElementString(`0108002660031693\u001d1728053110892302XV`)).toBe(GTIN14);
    expect(gtinFromElementString(` ${PACK}\n`)).toBe(GTIN14);
    expect(cleanScannedCode(`]d2 ${PACK}\u001d`)).toBe(PACK);
  });

  it('reads the human-readable form printed under the symbol', () => {
    expect(gtinFromElementString('(01)08002660031693(17)280531(10)892302XV')).toBe(GTIN14);
  });

  it('refuses a code whose GTIN check digit is wrong — an internal code is not a pack', () => {
    expect(gtinFromElementString('0108002660031694172805')).toBeNull();
    expect(gtinFromElementString('8002660031693')).toBeNull();
  });
});

describe('the keys a code is found under', () => {
  it('a pack code is found under itself, its GTIN-14 and its GTIN-13', () => {
    expect(barcodeKeys(PACK)).toEqual([PACK, GTIN14, EAN13]);
  });

  it('the EAN under the box’s 1D barcode meets the pack code at its GTIN', () => {
    const scannedEan = new Set(barcodeKeys(EAN13));
    expect(barcodeKeys(PACK).some((key) => scannedEan.has(key))).toBe(true);
  });

  it('a different batch of the same pack shares the GTIN key', () => {
    const otherBatch = '0108002660031693173012311OTHER7';
    const keys = new Set(barcodeKeys(otherBatch));
    expect(barcodeKeys(PACK).some((key) => keys.has(key))).toBe(true);
  });

  it('a case (indicator digit 1) is never folded into the item it contains', () => {
    // 1 + the item's first 12 digits + its own check digit: a different GTIN.
    const caseGtin = '18002660031690';
    expect(barcodeKeys(caseGtin)).not.toContain(EAN13);
    expect(barcodeKeys(EAN13)).not.toContain(caseGtin);
  });

  it('a code that is not a GTIN matches only itself, unchanged', () => {
    expect(barcodeKeys('PND-500')).toEqual(['PND-500']);
    expect(barcodeKeys('123456')).toEqual(['123456']);
    expect(barcodeKeys('8964000101018')).toEqual(['8964000101018', '08964000101018']);
  });
});

describe('what gets saved when a code is linked', () => {
  it('a pack code saves its GTIN, not one batch’s full string', () => {
    expect(barcodeToStore(PACK)).toBe(GTIN14);
  });

  it('anything else saves as scanned, cleaned', () => {
    expect(barcodeToStore(' 8964000101018 ')).toBe('8964000101018');
    expect(barcodeToStore('PND-500')).toBe('PND-500');
  });
});

describe('a scanned code, as opposed to a typed name', () => {
  it('recognises a pack code and a digit run, and not a name', () => {
    expect(looksLikeScannedCode(PACK)).toBe(true);
    expect(looksLikeScannedCode('8964000101018')).toBe(true);
    expect(looksLikeScannedCode('panadol')).toBe(false);
    expect(looksLikeScannedCode('500')).toBe(false);
  });
});
