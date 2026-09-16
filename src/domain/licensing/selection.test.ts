import { describe, expect, it } from 'vitest';

import { effectiveLicenceRow, isBoundHere, rebindsUsed, type LicenceRow } from './verify';

const at = (iso: string): Date => new Date(iso);
const MACHINE_A = 'aaaaaaaa-0000-7000-8000-000000000001';
const MACHINE_B = 'bbbbbbbb-0000-7000-8000-000000000002';
const LICENCE_1 = '11111111-0000-7000-8000-000000000001';
const LICENCE_2 = '22222222-0000-7000-8000-000000000002';

function row(over: Partial<LicenceRow> = {}): LicenceRow {
  return {
    licenceId: LICENCE_1,
    token: 'MEHVAR1.a.b',
    issuedAt: at('2026-01-01T00:00:00Z'),
    entitlementEndsAt: at('2027-01-01T00:00:00Z'),
    installationId: MACHINE_A,
    installedAt: at('2026-01-02T00:00:00Z'),
    ...over,
  };
}

describe('Invariant L2 — the effective licence', () => {
  it('a renewal supersedes by issuedAt within its licence id', () => {
    const renewal = row({
      issuedAt: at('2027-01-01T00:00:00Z'),
      entitlementEndsAt: at('2028-01-01T00:00:00Z'),
      installedAt: at('2027-01-02T00:00:00Z'),
    });
    expect(effectiveLicenceRow([row(), renewal])).toBe(renewal);
  });

  it('a deliberate downgrade under the same licence id takes effect', () => {
    // Shorter entitlement, later issue — the customer moved to monthly. No
    // `supersedes` field is needed: the per-licence rule already handles it.
    const downgrade = row({
      issuedAt: at('2026-06-01T00:00:00Z'),
      entitlementEndsAt: at('2026-07-01T00:00:00Z'),
      installedAt: at('2026-06-01T00:00:00Z'),
    });
    expect(effectiveLicenceRow([row(), downgrade])).toBe(downgrade);
  });

  it('re-pasting an older token is a no-op', () => {
    const current = row({
      issuedAt: at('2027-01-01T00:00:00Z'),
      entitlementEndsAt: at('2028-01-01T00:00:00Z'),
    });
    expect(effectiveLicenceRow([current, row()])).toBe(current);
  });

  it('an unrelated second licence never shortens a customer who paid longer', () => {
    const longer = row({ licenceId: LICENCE_2, entitlementEndsAt: at('2029-01-01T00:00:00Z') });
    const shorterButNewer = row({
      issuedAt: at('2026-09-01T00:00:00Z'),
      entitlementEndsAt: at('2026-10-01T00:00:00Z'),
    });
    expect(effectiveLicenceRow([longer, shorterButNewer])).toBe(longer);
  });

  it('is undefined with no rows', () => {
    expect(effectiveLicenceRow([])).toBeUndefined();
  });
});

describe('Invariant L3 — binding is a separate question', () => {
  it('a rebind writes a second row with the SAME issuedAt — the tie that broke it', () => {
    // This pair is exactly what "newest row wins" could not order: one token,
    // one issuedAt, two installation ids. Whichever the tie happened to pick
    // decided whether the machine read as bound.
    const original = row({ installationId: MACHINE_A });
    const rebound = row({ installationId: MACHINE_B, installedAt: at('2026-08-01T00:00:00Z') });
    const rows = [original, rebound];

    expect(isBoundHere(rows, LICENCE_1, MACHINE_B)).toBe(true);
    expect(isBoundHere(rows, LICENCE_1, MACHINE_A)).toBe(true);
    expect(isBoundHere(rows, LICENCE_1, 'cccccccc-0000-7000-8000-000000000003')).toBe(false);
  });

  it('does not bind across licence ids', () => {
    expect(isBoundHere([row({ licenceId: LICENCE_2 })], LICENCE_1, MACHINE_A)).toBe(false);
  });
});

describe('rebind allowance', () => {
  it('counts distinct machines minus the original, inside the window', () => {
    const rows = [
      row({ installationId: MACHINE_A, installedAt: at('2026-01-02T00:00:00Z') }),
      row({ installationId: MACHINE_B, installedAt: at('2026-03-02T00:00:00Z') }),
      row({
        installationId: 'cccccccc-0000-7000-8000-000000000003',
        installedAt: at('2026-06-02T00:00:00Z'),
      }),
    ];
    expect(rebindsUsed(rows, LICENCE_1, at('2026-01-01T00:00:00Z'))).toBe(2);
  });

  it('forgets rebinds older than the window', () => {
    const rows = [
      row({ installationId: MACHINE_A, installedAt: at('2024-01-02T00:00:00Z') }),
      row({ installationId: MACHINE_B, installedAt: at('2026-06-02T00:00:00Z') }),
    ];
    expect(rebindsUsed(rows, LICENCE_1, at('2026-01-01T00:00:00Z'))).toBe(0);
  });

  it('a re-paste on the same machine is not a rebind', () => {
    const rows = [row(), row({ installedAt: at('2026-05-01T00:00:00Z') })];
    expect(rebindsUsed(rows, LICENCE_1, at('2026-01-01T00:00:00Z'))).toBe(0);
  });
});
