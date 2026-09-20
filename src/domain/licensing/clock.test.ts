import { describe, expect, it } from 'vitest';

import {
  businessNow,
  clockDisagreement,
  corroboratedWitness,
  evaluationAnchor,
  shouldObserve,
  WITNESS_CORROBORATION,
} from './clock';

const DAY = 86_400_000;
const at = (iso: string): Date => new Date(iso);

/** A run of observations every 6 hours, ending at `end`. */
function run(end: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(end.getTime() - i * 6 * 60 * 60 * 1000));
}

describe('corroboratedWitness — Invariant L5', () => {
  it('never lets a lone outlier become the witness — the poisoning case', () => {
    const normal = run(at('2026-09-16T00:00:00Z'), 40);
    const poisoned = [...normal, at('2099-03-12T00:00:00Z')];

    const clean = corroboratedWitness(normal) as Date;
    const after = corroboratedWitness(poisoned) as Date;

    // It stays in the real era. Under `max()` this read 2099 and stayed there
    // forever, because the row is append-only and cannot be taken back.
    expect(after.getUTCFullYear()).toBe(2026);

    // One stray row displaces the top-K by exactly one slot, so the witness
    // moves FORWARD by one observation interval and no further. Forward by six
    // hours costs a sliver of rollback tolerance and nothing else; it cannot
    // move a tier, which is what makes "correct the date and carry on" true.
    expect(after.getTime() - clean.getTime()).toBe(6 * 60 * 60 * 1000);
  });

  it('bounds the damage of N outliers at N slots, not at their value', () => {
    const normal = run(at('2026-09-16T00:00:00Z'), 40);
    const strays = [at('2099-01-01T00:00:00Z'), at('2101-01-01T00:00:00Z')];
    const clean = corroboratedWitness(normal) as Date;
    const after = corroboratedWitness([...normal, ...strays]) as Date;

    expect(after.getUTCFullYear()).toBe(2026);
    expect(after.getTime() - clean.getTime()).toBe(2 * 6 * 60 * 60 * 1000);
  });

  it('accepts a reading once K observations agree', () => {
    const normal = run(at('2026-09-16T00:00:00Z'), 40);
    const persisted = [...normal, ...run(at('2099-03-12T00:00:00Z'), WITNESS_CORROBORATION)];

    // Corroboration must be a real threshold, not a value that quietly
    // discards everything above the ordinary run.
    expect(corroboratedWitness(persisted)?.getUTCFullYear()).toBe(2099);
  });

  it('is undefined below K observations — a new install has no past to protect', () => {
    expect(
      corroboratedWitness(run(at('2026-09-16T00:00:00Z'), WITNESS_CORROBORATION - 1)),
    ).toBeUndefined();
  });

  it('honours a signed ceiling, without the rows going anywhere (L6)', () => {
    const rows = [...run(at('2026-09-16T00:00:00Z'), 40), ...run(at('2099-03-12T00:00:00Z'), 20)];
    expect(corroboratedWitness(rows)?.getUTCFullYear()).toBe(2099);

    const repaired = corroboratedWitness(rows, { ceiling: at('2026-09-17T00:00:00Z') });
    expect(repaired?.getUTCFullYear()).toBe(2026);
    // The evidence is still there; repair is a compensating record, not a delete.
    expect(rows.filter((r) => r.getUTCFullYear() === 2099)).toHaveLength(20);
  });

  it('is monotone under insertion — the property the rollback defence rests on', () => {
    // Adding a row may only leave the witness alone or raise it. If that ever
    // stopped being true, an attacker could lower it by writing rows, and every
    // other guarantee here would go with it.
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };

    const rows: Date[] = [];
    let previous = -Infinity;
    for (let i = 0; i < 400; i += 1) {
      // Deliberately includes far-past and far-future values.
      const offset = (random() - 0.4) * 4000 * DAY;
      rows.push(new Date(at('2026-09-16T00:00:00Z').getTime() + offset));
      const witness = corroboratedWitness(rows)?.getTime() ?? -Infinity;
      expect(witness).toBeGreaterThanOrEqual(previous);
      previous = witness;
    }
  });
});

describe('businessNow — max(), no branches', () => {
  it('takes the system clock when it leads: this is the elapse guarantee', () => {
    const now = at('2027-01-01T00:00:00Z');
    expect(businessNow({ systemNow: now, witness: at('2026-09-16T00:00:00Z') }).toISOString()).toBe(
      now.toISOString(),
    );
  });

  it('takes the witness when the clock is rolled back', () => {
    const witness = at('2026-09-16T00:00:00Z');
    expect(businessNow({ systemNow: at('2026-03-01T00:00:00Z'), witness }).toISOString()).toBe(
      witness.toISOString(),
    );
  });

  it('takes the installation first-seen anchor when it leads', () => {
    const firstSeen = at('2026-09-01T00:00:00Z');
    expect(
      businessNow({
        systemNow: at('2026-01-01T00:00:00Z'),
        installationFirstSeenAt: firstSeen,
      }).toISOString(),
    ).toBe(firstSeen.toISOString());
  });

  it('never degrades a forward clock — a clock anomaly may not withhold the end of evaluation', () => {
    const wild = at('2099-03-12T00:00:00Z');
    expect(
      businessNow({ systemNow: wild, witness: at('2026-09-16T00:00:00Z') }).toISOString(),
    ).toBe(wild.toISOString());
  });
});

describe('clockDisagreement — two-sided, and a message only', () => {
  it('sees a live-wrong clock as system_ahead', () => {
    expect(
      clockDisagreement({
        systemNow: at('2099-03-12T00:00:00Z'),
        witness: at('2026-09-16T00:00:00Z'),
      }),
    ).toBe('system_ahead');
  });

  it('sees BOTH a rollback and a poisoned witness as system_behind', () => {
    // Deliberately indistinguishable at one instant. The support bundle's
    // observation histogram is what separates them, and a human reads it.
    const rollback = clockDisagreement({
      systemNow: at('2026-03-01T00:00:00Z'),
      witness: at('2026-09-16T00:00:00Z'),
    });
    const poisoned = clockDisagreement({
      systemNow: at('2026-09-16T00:00:00Z'),
      witness: at('2099-03-12T00:00:00Z'),
    });
    expect([rollback, poisoned]).toEqual(['system_behind', 'system_behind']);
  });

  it('is quiet with nothing to compare against', () => {
    expect(clockDisagreement({ systemNow: at('2026-09-16T00:00:00Z') })).toBe('none');
  });
});

describe('shouldObserve', () => {
  it('always writes at boot, so a long-idle machine re-anchors immediately', () => {
    expect(
      shouldObserve({
        systemNow: at('2026-09-16T00:00:00Z'),
        newestObservation: at('2026-09-15T23:00:00Z'),
        reason: 'boot',
      }),
    ).toBe(true);
  });

  it('waits for the interval otherwise', () => {
    expect(
      shouldObserve({
        systemNow: at('2026-09-16T00:00:00Z'),
        newestObservation: at('2026-09-15T23:00:00Z'),
        reason: 'interval',
      }),
    ).toBe(false);
  });

  it('never writes a row older than the newest observation', () => {
    expect(
      shouldObserve({
        systemNow: at('2026-03-01T00:00:00Z'),
        newestObservation: at('2026-09-16T00:00:00Z'),
        reason: 'boot',
      }),
    ).toBe(false);
  });
});

describe('evaluationAnchor', () => {
  it('takes the earliest source, so deleting installation.json buys nothing', () => {
    const earliest = at('2026-09-01T00:00:00Z');
    expect(
      evaluationAnchor({
        tenantCreatedAt: earliest,
        installationFirstSeenAt: at('2026-09-20T00:00:00Z'),
        earliestEvent: at('2026-09-02T00:00:00Z'),
        fallback: at('2026-09-30T00:00:00Z'),
      }).toISOString(),
    ).toBe(earliest.toISOString());
  });

  it('falls back only when nothing is known', () => {
    const fallback = at('2026-09-16T00:00:00Z');
    expect(evaluationAnchor({ fallback }).toISOString()).toBe(fallback.toISOString());
  });
});
