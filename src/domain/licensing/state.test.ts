import { describe, expect, it } from 'vitest';

import { businessNow, corroboratedWitness } from './clock';
import { evaluateLicence, TRIAL_DAYS, type LicencePayload, type VerifiedLicence } from './state';
import { permits, withheldBy } from './capabilities';

const DAY = 86_400_000;
const at = (iso: string): Date => new Date(iso);

function licence(over: Partial<LicencePayload> = {}): VerifiedLicence {
  return {
    token: 'MEHVAR1.stub.stub',
    payload: {
      v: 1,
      kid: 'dev-1',
      licenceId: '0198a000-0000-7000-8000-000000000001',
      tenantSlug: 'al-shifa',
      customerName: 'Al-Shifa Medical Store',
      plan: 'standard',
      branches: 1,
      issuedAt: '2026-01-01T00:00:00Z',
      entitlementEndsAt: '2027-01-01T00:00:00Z',
      expiresAt: '2027-03-01T00:00:00Z',
      graceDays: 30,
      warnDays: 45,
      ...over,
    },
  };
}

describe('evaluateLicence — the ladder', () => {
  it('is licensed comfortably inside the term', () => {
    const state = evaluateLicence({
      now: at('2026-06-01T09:00:00Z'),
      effective: licence(),
      boundHere: true,
    });
    expect(state.status).toBe('licensed');
    expect(state.tier).toBe('full');
  });

  it('warns from warnDays out — 45 days, because an annual bill is cash', () => {
    const state = evaluateLicence({
      now: at('2026-12-01T09:00:00Z'),
      effective: licence(),
      boundHere: true,
    });
    expect(state.status).toBe('expiring');
    expect(state.tier).toBe('full_notice');
  });

  it('keeps full capability through grace', () => {
    const state = evaluateLicence({
      now: at('2027-01-20T09:00:00Z'),
      effective: licence(),
      boundHere: true,
    });
    expect(state.status).toBe('grace');
    expect(state.tier).toBe('full_notice');
  });

  it('restricts past entitlement plus grace', () => {
    const state = evaluateLicence({
      now: at('2027-03-01T09:00:00Z'),
      effective: licence(),
      boundHere: true,
    });
    expect(state.status).toBe('lapsed');
    expect(state.tier).toBe('restricted');
  });

  it('NEVER degrades on a stale token while the entitlement is live', () => {
    // One cloud outage longer than a lease window must not lapse the fleet.
    const state = evaluateLicence({
      now: at('2026-06-01T09:00:00Z'),
      effective: licence({ expiresAt: '2026-02-01T00:00:00Z' }),
      boundHere: true,
    });
    expect(state.status).toBe('stale');
    expect(state.tier).toBe('full_notice');
  });

  it('reports unbound before lapsed, and carries the dates for both', () => {
    const state = evaluateLicence({
      now: at('2026-06-01T09:00:00Z'),
      effective: licence(),
      boundHere: false,
    });
    expect(state.status).toBe('unbound');
    expect(state.tier).toBe('restricted');
    // Both facts at once, so an owner who is unbound AND lapsed learns it in
    // one trip rather than two.
    expect(state.entitlementEndsOn).toBe('2027-01-01');
  });

  it('is invalid, not lapsed, when a token was present but did not verify', () => {
    const state = evaluateLicence({
      now: at('2026-06-01T09:00:00Z'),
      invalidReason: 'bad_signature',
    });
    expect(state.status).toBe('invalid');
    expect(state.tier).toBe('restricted');
  });
});

describe('the trial', () => {
  it('runs 14 days from the derived anchor', () => {
    const started = at('2026-09-01T00:00:00Z');
    const state = evaluateLicence({ now: at('2026-09-10T09:00:00Z'), trialStartedAt: started });
    expect(state.status).toBe('trial');
    expect(state.tier).toBe('full');
    expect(state.trialEndsOn).toBe('2026-09-15');
  });

  it('restricts once it runs out, and says it was never licensed', () => {
    const state = evaluateLicence({
      now: at('2026-09-30T09:00:00Z'),
      trialStartedAt: at('2026-09-01T00:00:00Z'),
    });
    expect(state.status).toBe('lapsed');
    expect(state.neverLicensed).toBe(true);
  });

  it('cannot be extended by rolling the clock back once events exist', () => {
    const started = at('2026-09-01T00:00:00Z');
    const rolledBack = businessNow({
      systemNow: at('2026-09-02T00:00:00Z'),
      ledgerHighWater: at('2026-09-30T00:00:00Z'),
    });
    expect(evaluateLicence({ now: rolledBack, trialStartedAt: started }).status).toBe('lapsed');
  });
});

describe('the seven clock cases, end to end (§5)', () => {
  const issued = licence();
  const entitlementOver = at('2027-03-05T09:00:00Z');

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly anchors: Parameters<typeof businessNow>[0];
    readonly expect: 'full' | 'restricted';
  }> = [
    {
      name: 'active pharmacy, normal clock, inside term',
      anchors: {
        systemNow: at('2026-06-01T09:00:00Z'),
        ledgerHighWater: at('2026-06-01T08:00:00Z'),
      },
      expect: 'full',
    },
    {
      name: 'closed several months, correct clock, term now over',
      anchors: { systemNow: entitlementOver, ledgerHighWater: at('2026-11-01T00:00:00Z') },
      expect: 'restricted',
    },
    {
      name: 'NO ledger activity at all since issue — still elapses',
      anchors: { systemNow: entitlementOver, licenceIssuedAt: at('2026-01-01T00:00:00Z') },
      expect: 'restricted',
    },
    {
      name: 'malicious rollback — the witness wins',
      anchors: {
        systemNow: at('2026-06-01T00:00:00Z'),
        witness: corroboratedWitness(
          Array.from(
            { length: 40 },
            (_, i) => new Date(entitlementOver.getTime() - i * 6 * 3600_000),
          ),
        ),
      },
      expect: 'restricted',
    },
    {
      name: 'malicious clock-forward — self-harm, expires sooner',
      anchors: { systemNow: at('2099-03-12T00:00:00Z') },
      expect: 'restricted',
    },
    {
      name: 'accidental forward spike, fixed same day — uncorroborated, absorbed',
      anchors: {
        systemNow: at('2026-06-01T09:00:00Z'),
        witness: corroboratedWitness([
          ...Array.from(
            { length: 40 },
            (_, i) => new Date(at('2026-06-01T09:00:00Z').getTime() - i * 6 * 3600_000),
          ),
          at('2099-03-12T00:00:00Z'),
        ]),
      },
      expect: 'full',
    },
    {
      name: 'persistent forward fault — corroborated, and it does restrict',
      anchors: {
        systemNow: at('2026-06-01T09:00:00Z'),
        witness: corroboratedWitness(
          Array.from(
            { length: 40 },
            (_, i) => new Date(at('2099-03-12T00:00:00Z').getTime() - i * 6 * 3600_000),
          ),
        ),
      },
      expect: 'restricted',
    },
  ];

  it.each(cases)('$name', ({ anchors, expect: tier }) => {
    const state = evaluateLicence({
      now: businessNow(anchors),
      effective: issued,
      boundHere: true,
    });
    expect(state.tier === 'restricted' ? 'restricted' : 'full').toBe(tier);
  });
});

describe('the elapse guarantee (D5a)', () => {
  it('a fixed licence, no events, no connectivity, clock advanced — MUST restrict', () => {
    // This is the assertion finding 10 existed for. It must never be weakened:
    // if it can be made to pass with time standing still, "do not trade"
    // becomes a licence-extension strategy.
    const state = evaluateLicence({
      now: businessNow({ systemNow: at('2027-06-01T09:00:00Z') }),
      effective: licence(),
      boundHere: true,
    });
    expect(state.status).toBe('lapsed');
    expect(state.tier).toBe('restricted');
  });
});

describe('what restricted actually costs (PCN-005)', () => {
  it('never touches selling, printing or export — in any tier', () => {
    for (const tier of ['full', 'full_notice', 'restricted'] as const) {
      expect(permits(tier, 'sell')).toBe(true);
      expect(permits(tier, 'print')).toBe(true);
      expect(permits(tier, 'export')).toBe(true);
      // The licence is pasted in Settings, so Settings can never be the wall.
      expect(permits(tier, 'manage_settings')).toBe(true);
    }
  });

  it('withholds exactly the four off-the-sale-path capabilities', () => {
    expect([...withheldBy('restricted')].sort()).toEqual([
      'adjust_stock',
      'auto_update',
      'catalog_pack',
      'receive_stock',
    ]);
    expect(withheldBy('full_notice')).toHaveLength(0);
  });
});

describe('boundaries fall at local midnight, never mid-trading-day (D12)', () => {
  it('holds the tier across a UTC boundary inside the Karachi business day', () => {
    // 2026-12-31T20:00Z is 01:00 on 2027-01-01 in Karachi — the entitlement's
    // last day. A naive UTC comparison would flip the tier mid-shift.
    const state = evaluateLicence({
      now: at('2026-12-31T20:00:00Z'),
      effective: licence(),
      boundHere: true,
    });
    expect(state.tier).toBe('full_notice');
    expect(state.status).toBe('expiring');
  });
});

it('sanity: a day is a day', () => {
  expect(DAY).toBe(86_400_000);
  expect(TRIAL_DAYS).toBe(14);
});
