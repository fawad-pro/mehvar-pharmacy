import { describe, expect, it } from 'vitest';

import { reversalRefusal } from './reversal';

describe('reversalRefusal', () => {
  it('a recorded entry with no reversal may be reversed', () => {
    expect(reversalRefusal({ reversesId: null }, undefined)).toBeNull();
  });

  it('a missing entry is named as missing', () => {
    expect(reversalRefusal(undefined, undefined)).toBe('not_found');
  });

  it('a reversal is never reversed — the fix is a new, right entry', () => {
    expect(reversalRefusal({ reversesId: 'x' }, undefined)).toBe('is_reversal');
  });

  it('an entry is reversed once', () => {
    expect(reversalRefusal({ reversesId: null }, { id: 'r' })).toBe('already_reversed');
  });
});
