/**
 * Tenant provisioning — the one bootstrap door.
 *
 * The `tenants` table is the only tenant-owned-adjacent table with no
 * `tenant_id` column: it *is* the tenant. It therefore cannot pass through
 * `TenantScope`, whose type constraint requires that column — a distinction the
 * compiler enforces rather than a convention anyone has to remember.
 *
 * Creating a pharmacy is a founder-side act, not a counter workflow: Phase 3
 * makes assisted setup part of the trial, and Phase 12 §6 walks through it. So
 * this lives apart from the workflows, deliberately narrow, and everything the
 * new tenant owns is written through the chokepoint immediately afterwards.
 */

import 'server-only';

import { eq } from 'drizzle-orm';

import type { Uuid } from '@/lib/uuid';

import { globalCatalog } from './scoped';
import { tenants, users, type TenantSettings } from './schema';

export async function createTenant(input: {
  id: Uuid;
  slug: string;
  name: string;
  settings: TenantSettings;
}): Promise<void> {
  await globalCatalog().insert(tenants).values({
    id: input.id,
    slug: input.slug,
    name: input.name,
    status: 'active',
    settings: input.settings,
  });
}

/**
 * Phase 3 §5.3 / Phase 8 §4: suspension is a tenant flag that gates writes.
 * The export endpoint stays open regardless of payment state — that is T3, and
 * it is a promise the commercial strategy makes in sales conversations.
 */
export async function setTenantStatus(
  tenantId: Uuid,
  status: 'active' | 'suspended',
): Promise<void> {
  await globalCatalog().update(tenants).set({ status }).where(eq(tenants.id, tenantId));
}

/**
 * Every tenant id — founder-side tooling only (the ADR-8 verifier, exports).
 *
 * Necessarily unscoped: a cross-tenant sweep is the one legitimate reason to
 * enumerate tenants, and it lives here beside the other unscoped door rather
 * than widening `TenantScope`.
 */
export async function listTenantIds(): Promise<Uuid[]> {
  const rows = await globalCatalog().select({ id: tenants.id }).from(tenants);
  return rows.map((row) => row.id);
}

/** Any active user of a tenant, to satisfy the chokepoint's attribution contract. */
export async function anyUserId(tenantId: Uuid): Promise<Uuid | undefined> {
  const rows = await globalCatalog()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .limit(1);
  return rows[0]?.id;
}
