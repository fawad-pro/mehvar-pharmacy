import { describe, expect, it } from 'vitest';

import { formatExpiry, parseExpiryInput } from './expiry';

describe('parseExpiryInput — PCN-017', () => {
  it('stores a month and year as the last day of that month', () => {
    expect(parseExpiryInput('03/2028')).toBe('2028-03-31');
    expect(parseExpiryInput('03/28')).toBe('2028-03-31');
    expect(parseExpiryInput('11/27')).toBe('2027-11-30');
  });

  it('knows February, leap years included', () => {
    expect(parseExpiryInput('02/2028')).toBe('2028-02-29');
    expect(parseExpiryInput('02/27')).toBe('2027-02-28');
  });

  it('agrees with a scanned pack whose day is 00 (GS1)', () => {
    // barcode.ts reads YYMMDD 280300 as 2028-03-31; typed, the same pack is:
    expect(parseExpiryInput('3/28')).toBe('2028-03-31');
  });

  it('takes the separators people type, and bare digits from a number pad', () => {
    expect(parseExpiryInput(' 6-2030 ')).toBe('2030-06-30');
    expect(parseExpiryInput('06.30')).toBe('2030-06-30');
    expect(parseExpiryInput('06 2030')).toBe('2030-06-30');
    expect(parseExpiryInput('0630')).toBe('2030-06-30');
  });

  it('refuses what is not a month and year, rather than guessing a day', () => {
    for (const text of ['', '13/28', '00/28', '2028-03-31', '15/03/2028', '3/2', '063', 'soon']) {
      expect(parseExpiryInput(text)).toBeNull();
    }
  });
});

describe('formatExpiry', () => {
  it('reads any stored date as MM/YYYY, including rows from before PCN-017', () => {
    expect(formatExpiry('2028-03-31')).toBe('03/2028');
    expect(formatExpiry('2027-06-15')).toBe('06/2027');
  });
});
