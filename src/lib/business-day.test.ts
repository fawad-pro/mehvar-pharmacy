import { describe, expect, it } from 'vitest';

import {
  businessDayBounds,
  businessDayOf,
  DEFAULT_TIME_ZONE,
  endOfBusinessDay,
  startOfBusinessDay,
} from './business-day';

describe('businessDayOf', () => {
  it('uses tenant-local time, not UTC (Phase 9 §1)', () => {
    // 21:30 UTC is 02:30 the next morning in Karachi — a late-night sale in a
    // pharmacy trading past midnight belongs to the local day, not the UTC one.
    expect(businessDayOf(new Date('2026-07-30T21:30:00Z'))).toBe('2026-07-31');
    expect(businessDayOf(new Date('2026-07-30T18:29:00Z'))).toBe('2026-07-30');
  });

  it('honours an explicit time zone', () => {
    expect(businessDayOf(new Date('2026-07-30T21:30:00Z'), 'UTC')).toBe('2026-07-30');
  });
});

describe('business day bounds', () => {
  it('starts at local midnight, expressed as a UTC instant', () => {
    expect(startOfBusinessDay('2026-07-30').toISOString()).toBe('2026-07-29T19:00:00.000Z');
  });

  it('ends at the next local midnight, exclusive', () => {
    expect(endOfBusinessDay('2026-07-30').toISOString()).toBe('2026-07-30T19:00:00.000Z');
  });

  it('produces a half-open range exactly 24 hours wide', () => {
    const { start, end } = businessDayBounds('2026-07-30');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('rounds-trips: every instant inside the bounds reports that day', () => {
    const { start, end } = businessDayBounds('2026-07-30');
    expect(businessDayOf(start)).toBe('2026-07-30');
    expect(businessDayOf(new Date(end.getTime() - 1))).toBe('2026-07-30');
    expect(businessDayOf(end)).toBe('2026-07-31');
  });

  it('crosses month and year boundaries', () => {
    const { start } = businessDayBounds('2027-01-01');
    expect(start.toISOString()).toBe('2026-12-31T19:00:00.000Z');
    expect(businessDayOf(start)).toBe('2027-01-01');
  });

  it('rejects malformed days', () => {
    expect(() => startOfBusinessDay('30-07-2026')).toThrow(RangeError);
  });

  it('defaults to Asia/Karachi', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Asia/Karachi');
  });
});
