import { describe, expect, it } from 'vitest';

import { recordedMrpFor } from './mrp';
import { unitsFromEnteredPrices } from './units';

const units =
  unitsFromEnteredPrices(
    [
      { name: 'tab', factor: 1 },
      { name: 'strip', factor: 10 },
      { name: 'box', factor: 100 },
    ],
    [null, 3_500, null],
  ) ?? [];
const [tab, strip, box] = units as [(typeof units)[0], (typeof units)[0], (typeof units)[0]];

describe('the MRP on record, for one unit (PCN-012)', () => {
  it('is the recorded figure for the unit it was recorded on', () => {
    expect(
      recordedMrpFor({ mrpPaisa: null, mrpUnit: { key: 'u2', paisa: 40_000 }, units }, box),
    ).toBe(40_000);
  });

  it('scales to other units — exactly upwards, rounded up downwards', () => {
    const product = { mrpPaisa: null, mrpUnit: { key: 'u1', paisa: 3_999 }, units };
    expect(recordedMrpFor(product, box)).toBe(39_990);
    expect(recordedMrpFor(product, tab)).toBe(400);
  });

  it('reads a per-tablet MRP from before PCN-012', () => {
    expect(recordedMrpFor({ mrpPaisa: 400, units }, strip)).toBe(4_000);
  });

  it('is nothing when nothing is recorded', () => {
    expect(recordedMrpFor({ mrpPaisa: null, mrpUnit: null, units }, strip)).toBeNull();
  });
});
