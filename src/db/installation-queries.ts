import 'server-only';

import { eq } from 'drizzle-orm';

import { installations } from '@/db/schema';
import { globalCatalog } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

/**
 * Machine identity in the database — the half `src/lib/installation.ts` said
 * would "arrive with licensing in roadmap Phase 2".
 *
 * Tenant-free on purpose. `tenants.id` is business identity ("Al-Shifa Medical
 * Store"); this is machine identity ("the PC this runs on"), and one Node serves
 * many tenants when a pharmacy is cloud-hosted. Conflating them is what makes
 * "the customer replaced their PC" an unanswerable support ticket.
 *
 * Reached through `globalCatalog()` for the same reason `provisioning.ts` is:
 * there is no tenant column, so `TenantScope` cannot construct a query against
 * it — the type system says so.
 */

export interface InstallationRow {
  readonly id: Uuid;
  readonly firstSeenAt: Date;
  readonly lastVersion: string;
  readonly lastHostname: string | null;
}

export async function findInstallation(id: Uuid): Promise<InstallationRow | undefined> {
  const [row] = await globalCatalog()
    .select()
    .from(installations)
    .where(eq(installations.id, id))
    .limit(1);
  return row;
}

/**
 * The only installation row, when there is exactly one.
 *
 * This is what lets boot **restore** `installation.json` instead of minting a
 * fresh id when `%ProgramData%` has been cleaned — which is an honest
 * customer's Tuesday, not an attack, and minting would silently unbind them.
 *
 * Deliberately refuses to guess when a machine somehow has more than one: a
 * wrong guess here rewrites machine identity, and "I do not know" is recoverable
 * where a confident wrong answer is not.
 */
export async function soleInstallation(): Promise<InstallationRow | undefined> {
  const rows = await globalCatalog().select().from(installations).limit(2);
  return rows.length === 1 ? rows[0] : undefined;
}

/**
 * Record this machine, or refresh what moves.
 *
 * `id` and `first_seen_at` are never updated — `first_seen_at` is one of the
 * four sources the trial anchor takes a `min()` over, and a writer that could
 * move it forward would be a trial reset with extra steps.
 */
export async function upsertInstallation(input: {
  readonly id: Uuid;
  readonly firstSeenAt: Date;
  readonly version: string;
  readonly hostname: string | null;
}): Promise<void> {
  await globalCatalog()
    .insert(installations)
    .values({
      id: input.id,
      firstSeenAt: input.firstSeenAt,
      lastVersion: input.version,
      lastHostname: input.hostname,
    })
    .onConflictDoUpdate({
      target: installations.id,
      set: { lastVersion: input.version, lastHostname: input.hostname, updatedAt: new Date() },
    });
}
