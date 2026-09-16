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
/**
 * A tenant by its slug, or undefined.
 *
 * `tenants` carries no `tenant_id` — it IS the tenant — so it cannot be reached
 * through `TenantScope`, and this module is its only door (CLAUDE.md, Day 1).
 * `db:seed` needs it to answer "has this database already been set up?" before
 * deciding whether to create a demo pharmacy or top up the one that is there.
 */
export async function findTenantBySlug(slug: string): Promise<{ id: Uuid } | undefined> {
  const rows = await globalCatalog()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return rows[0];
}

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

/**
 * A tenant's own settings — the receipt header/footer Phase 10 §7 prints.
 *
 * Reading a tenant's own reference row is the ordinary counterpart to
 * `createTenant`, not founder tooling; it lives here for the same structural
 * reason everything else in this file does — `tenants` has no `tenant_id` to
 * scope on.
 */
export async function tenantSettings(tenantId: Uuid): Promise<TenantSettings | undefined> {
  const rows = await globalCatalog()
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0]?.settings;
}

/** A tenant's login slug, by id. Used by the refresh client (Stage 2). */
export async function tenantSlugById(tenantId: Uuid): Promise<string | undefined> {
  const rows = await globalCatalog()
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0]?.slug;
}

/**
 * Settings edited from the Settings screen — receipt header/footer (Phase 10
 * §2 surface 9). `tenants` carries no `tenant_id` to scope on, the same
 * reason `tenantSettings` lives here rather than behind `TenantScope`.
 */
export async function updateTenantSettings(
  tenantId: Uuid,
  settings: TenantSettings,
): Promise<void> {
  await globalCatalog().update(tenants).set({ settings }).where(eq(tenants.id, tenantId));
}
