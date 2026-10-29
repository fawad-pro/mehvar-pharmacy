/**
 * A cloud tenant's entitlement — the pure half (PCN-019).
 *
 * `evaluateLicence` answers "is this INSTALLATION authorized?" from a signed
 * file bound to a machine. A cloud-hosted tenant has no machine, so the same
 * question is answered from the tenant's own `tenant_entitlements` rows. This
 * module turns those rows into the same `LicenceState`, so everything
 * downstream (the capability gate, the banner, the Settings panel) reads one
 * shape and never learns which source produced it.
 *
 * No clock of its own: `now` is an input, as it is for `evaluateLicence`.
 * No evaluation window either — a cloud tenant is provisioned with an
 * entitlement, and one without is simply not entitled.
 */

import type { LicenceState } from './state';

export interface EntitlementRow {
  readonly plan: string;
  readonly grantedAt: Date;
  /** Null: no end date. */
  readonly endsAt: Date | null;
}

/** The newest row by `grantedAt` — an extension or an end is a newer row. */
export function effectiveEntitlement(rows: readonly EntitlementRow[]): EntitlementRow | undefined {
  let newest: EntitlementRow | undefined;
  for (const row of rows) {
    if (newest === undefined || row.grantedAt.getTime() > newest.grantedAt.getTime()) newest = row;
  }
  return newest;
}

export function evaluateEntitlement(input: {
  readonly now: Date;
  readonly customerName: string;
  readonly rows: readonly EntitlementRow[];
}): LicenceState {
  const current = effectiveEntitlement(input.rows);

  if (current === undefined) {
    return { status: 'unauthorized', tier: 'restricted' };
  }

  const lapsed = current.endsAt !== null && current.endsAt.getTime() <= input.now.getTime();
  if (lapsed) {
    return { status: 'unauthorized', tier: 'restricted', customerName: input.customerName };
  }

  return { status: 'authorized', tier: 'full', customerName: input.customerName };
}
