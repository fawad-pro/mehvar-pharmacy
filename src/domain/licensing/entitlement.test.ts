import { describe, expect, it } from 'vitest';

import { effectiveEntitlement, evaluateEntitlement, type EntitlementRow } from './entitlement';

const NOW = new Date('2030-06-15T12:00:00Z');
const row = (grantedAt: string, endsAt: string | null, plan = 'pilot'): EntitlementRow => ({
  plan,
  grantedAt: new Date(grantedAt),
  endsAt: endsAt === null ? null : new Date(endsAt),
});

describe('cloud entitlement (PCN-019)', () => {
  it('an open-ended entitlement is authorized with the full tier', () => {
    const state = evaluateEntitlement({
      now: NOW,
      customerName: 'Pilot Pharmacy',
      rows: [row('2030-01-01T00:00:00Z', null)],
    });
    expect(state).toMatchObject({ status: 'authorized', tier: 'full' });
  });

  it('a tenant with no entitlement is restricted, not evaluating', () => {
    const state = evaluateEntitlement({ now: NOW, customerName: 'x', rows: [] });
    expect(state).toMatchObject({ status: 'unauthorized', tier: 'restricted' });
  });

  it('a lapsed entitlement is restricted', () => {
    const state = evaluateEntitlement({
      now: NOW,
      customerName: 'x',
      rows: [row('2030-01-01T00:00:00Z', '2030-06-01T00:00:00Z')],
    });
    expect(state).toMatchObject({ status: 'unauthorized', tier: 'restricted' });
  });

  it('an entitlement that ends exactly now has ended', () => {
    const state = evaluateEntitlement({
      now: NOW,
      customerName: 'x',
      rows: [row('2030-01-01T00:00:00Z', NOW.toISOString())],
    });
    expect(state.tier).toBe('restricted');
  });

  it('an extension is a newer row and supersedes the lapsed one', () => {
    const rows = [
      row('2030-01-01T00:00:00Z', '2030-06-01T00:00:00Z'),
      row('2030-06-10T00:00:00Z', '2031-06-01T00:00:00Z'),
    ];
    expect(effectiveEntitlement(rows)?.endsAt?.toISOString()).toBe('2031-06-01T00:00:00.000Z');
    expect(evaluateEntitlement({ now: NOW, customerName: 'x', rows }).tier).toBe('full');
  });

  it('row order does not matter, only grantedAt', () => {
    const rows = [
      row('2030-06-10T00:00:00Z', null),
      row('2030-01-01T00:00:00Z', '2030-02-01T00:00:00Z'),
    ];
    expect(evaluateEntitlement({ now: NOW, customerName: 'x', rows }).tier).toBe('full');
  });
});
