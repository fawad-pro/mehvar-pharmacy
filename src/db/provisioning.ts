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
import { tenants, type TenantSettings } from './schema';

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
