import { describe, expect, it } from 'vitest';

import { uuidv7, uuidv7Timestamp } from './uuid';

describe('uuidv7', () => {
  it('is a well-formed v7 UUID', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('encodes the timestamp it was given', () => {
    const now = Date.UTC(2026, 6, 30, 12, 0, 0);
    expect(uuidv7Timestamp(uuidv7(now))).toBe(now);
  });

  it('sorts lexicographically in time order — the reason v7 was chosen', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it('does not collide within the same millisecond', () => {
    const now = Date.now();
    const ids = new Set(Array.from({ length: 5_000 }, () => uuidv7(now)));
    expect(ids.size).toBe(5_000);
  });
});
