import { describe, expect, it } from 'vitest';

import { businessNow, corroboratedWitness } from './clock';
import {
  evaluateLicence,
  EVALUATION_DAYS,
  type LicencePayload,
  type VerifiedLicence,
} from './state';
import { permits, withheldBy } from './capabilities';

const DAY = 86_400_000;
const at = (iso: string): Date => new Date(iso);

function licence(over: Partial<LicencePayload> = {}): VerifiedLicence {
  return {
    token: 'MEHVAR1.stub.stub',
    payload: {
      v: 2,
      kid: 'dev-1',
      licenceId: '0198a000-0000-7000-8000-000000000001',
      tenantSlug: 'al-shifa',
      customerName: 'Al-Shifa Medical Store',
      issuedAt: '2026-01-01T00:00:00Z',
      ...over,
    },
  };
}

describe('evaluateLicence — perpetual authorization (PCN-006)', () => {
  it('a valid, bound licence is authorized with full capability', () => {
    const state = evaluateLicence({
      now: at('2026-06-01T09:00:00Z'),
      effective: licence(),
      boundHere: true,
    });
    expect(state.status).toBe('authorized');
    expect(state.tier).toBe('full');
    expect(state.customerName).toBe('Al-Shifa Medical Store');
  });

  it('stays authorized forever — a far-future clock changes nothing', () => {
    const state = evaluateLicence({
      now: at('2099-06-01T09:00:00Z'),
      effective: licence(),
      boundHere: true,
    });
    expect(state.status).toBe('authorized');
    expect(state.tier).toBe('full');
    // No expiry/renewal/countdown fields on the authorized path.
    expect(state.evaluationEndsOn).toBeUndefined();
    expect(state.daysRemaining).toBeUndefined();
  });

  it('the authorized path never reads the evaluation clock', () => {
    // Even with a witness/anchor that would put an unlicensed install years past
    // its evaluation, a bound licence resolves to authorized before the clock.
    const state = evaluateLicence({
      now: businessNow({ systemNow: at('2099-01-01T00:00:00Z') }),
      effective: licence(),
      boundHere: true,
      evaluationStartedAt: at('2020-01-01T00:00:00Z'),
    });
    expect(state.status).toBe('authorized');
  });

  it('a valid token bound to another machine is unbound/restricted', () => {
    const state = evaluateLicence({
      now: at('2026-06-01T09:00:00Z'),
      effective: licence(),
      boundHere: false,
    });
    expect(state.status).toBe('unbound');
    expect(state.tier).toBe('restricted');
    expect(state.customerName).toBe('Al-Shifa Medical Store');
  });

  it('is invalid, not unauthorized, when a token was present but did not verify', () => {
    const state = evaluateLicence({
      now: at('2026-06-01T09:00:00Z'),
      invalidReason: 'bad_signature',
    });
    expect(state.status).toBe('invalid');
    expect(state.tier).toBe('restricted');
    expect(state.invalidReason).toBe('bad_signature');
  });

  it('a valid signed revocation is honoured immediately, independent of time', () => {
    const state = evaluateLicence({
      now: at('2026-06-01T09:00:00Z'),
      effective: licence(),
      boundHere: true,
      revoked: true,
    });
    expect(state.status).toBe('revoked');
    expect(state.tier).toBe('restricted');
    expect(state.licenceId).toBe('0198a000-0000-7000-8000-000000000001');
  });
});

describe('the 30-day unlicensed evaluation', () => {
  it('a fresh unlicensed install is in evaluation with full capability', () => {
    const state = evaluateLicence({
      now: at('2026-09-01T09:00:00Z'),
      evaluationStartedAt: at('2026-09-01T00:00:00Z'),
    });
    expect(state.status).toBe('evaluation');
    expect(state.tier).toBe('full');
    expect(state.evaluationEndsOn).toBe('2026-10-01');
    expect(state.daysRemaining).toBe(30);
  });

  it('is still evaluation on day 30 (the boundary is inclusive)', () => {
    const state = evaluateLicence({
      now: at('2026-10-01T09:00:00Z'),
      evaluationStartedAt: at('2026-09-01T00:00:00Z'),
    });
    expect(state.status).toBe('evaluation');
    expect(state.daysRemaining).toBe(0);
  });

  it('becomes unauthorized/restricted the day after the window', () => {
    const state = evaluateLicence({
      now: at('2026-10-02T09:00:00Z'),
      evaluationStartedAt: at('2026-09-01T00:00:00Z'),
    });
    expect(state.status).toBe('unauthorized');
    expect(state.tier).toBe('restricted');
  });

  it('cannot be extended by rolling the clock back once time has accrued', () => {
    const started = at('2026-09-01T00:00:00Z');
    const rolledBack = businessNow({
      systemNow: at('2026-09-02T00:00:00Z'),
      ledgerHighWater: at('2026-10-30T00:00:00Z'),
    });
    expect(evaluateLicence({ now: rolledBack, evaluationStartedAt: started }).status).toBe(
      'unauthorized',
    );
  });

  it('the witness holds the boundary against a rolled-back system clock', () => {
    const started = at('2026-09-01T00:00:00Z');
    const witness = corroboratedWitness(
      Array.from({ length: 40 }, (_, i) => new Date(at('2026-10-20T00:00:00Z').getTime() - i * 6 * 3600_000)),
    );
    const now = businessNow({ systemNow: at('2026-09-03T00:00:00Z'), witness });
    expect(evaluateLicence({ now, evaluationStartedAt: started }).status).toBe('unauthorized');
  });
});

describe('activation transition', () => {
  it('an unauthorized install becomes authorized the instant a bound licence is present', () => {
    const started = at('2026-09-01T00:00:00Z');
    const now = at('2026-11-01T09:00:00Z'); // well past evaluation

    const before = evaluateLicence({ now, evaluationStartedAt: started });
    expect(before.status).toBe('unauthorized');

    const after = evaluateLicence({ now, evaluationStartedAt: started, effective: licence(), boundHere: true });
    expect(after.status).toBe('authorized');
    expect(after.tier).toBe('full');
  });
});

describe('what restricted actually costs (PCN-006 Profile C)', () => {
  it('never touches settling, printing or export — in any tier', () => {
    for (const tier of ['full', 'restricted'] as const) {
      expect(permits(tier, 'settle')).toBe(true);
      expect(permits(tier, 'print')).toBe(true);
      expect(permits(tier, 'export')).toBe(true);
      // The licence is activated in Settings, so Settings can never be the wall.
      expect(permits(tier, 'manage_settings')).toBe(true);
    }
  });

  it('blocks exactly the new-business capabilities when restricted', () => {
    expect([...withheldBy('restricted')].sort()).toEqual([
      'adjust_stock',
      'author_product',
      'manage_customer',
      'receive_stock',
      'sell',
    ]);
    expect(withheldBy('full')).toHaveLength(0);
  });

  it('permits all new business at full tier (evaluation and authorized)', () => {
    for (const cap of ['sell', 'receive_stock', 'adjust_stock', 'author_product', 'manage_customer'] as const) {
      expect(permits('full', cap)).toBe(true);
      expect(permits('restricted', cap)).toBe(false);
    }
  });
});

describe('evaluation boundary falls at local midnight (D12)', () => {
  it('uses the tenant time zone for the day comparison', () => {
    // 2026-10-01T20:00Z is 01:00 on 2026-10-02 in Karachi — one day past a
    // window ending 2026-10-01. With the Karachi zone it reads unauthorized.
    const state = evaluateLicence({
      now: at('2026-10-01T20:00:00Z'),
      timeZone: 'Asia/Karachi',
      evaluationStartedAt: at('2026-09-01T00:00:00Z'),
    });
    expect(state.status).toBe('unauthorized');
  });
});

it('sanity: a day is a day, and the window is 30', () => {
  expect(DAY).toBe(86_400_000);
  expect(EVALUATION_DAYS).toBe(30);
});
