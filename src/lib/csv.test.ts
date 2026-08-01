import { describe, expect, it } from 'vitest';

import { toCsv } from './csv';

describe('toCsv', () => {
  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('writes a header from the first row and one line per row', () => {
    const csv = toCsv([
      { id: 1, name: 'Panadol' },
      { id: 2, name: 'Brufen' },
    ]);
    expect(csv).toBe('id,name\r\n1,Panadol\r\n2,Brufen');
  });

  it('renders null and undefined as empty cells', () => {
    expect(toCsv([{ a: null, b: undefined, c: 0 }])).toBe('a,b,c\r\n,,0');
  });

  it('formats a Date as ISO', () => {
    const date = new Date('2027-06-30T00:00:00.000Z');
    expect(toCsv([{ createdAt: date }])).toBe('createdAt\r\n2027-06-30T00:00:00.000Z');
  });

  it('quotes a cell containing a comma, quote, or newline, doubling internal quotes', () => {
    const csv = toCsv([{ note: 'found "behind" the counter, on the shelf\nlow' }]);
    expect(csv).toBe('note\r\n"found ""behind"" the counter, on the shelf\nlow"');
  });
});
