import 'server-only';

import { tenantEntitlements } from '@/db/schema';
import type { TenantScope } from '@/db/scoped';
import type { EntitlementRow } from '@/domain/licensing/entitlement';
import { uuidv7 } from '@/lib/uuid';

/**
 * A cloud tenant's entitlement rows (PCN-019). Append-only, like every event
 * table: granting, extending and ending are all `grantEntitlement`, never an
 * update.
 */

export async function listEntitlements(scope: TenantScope): Promise<EntitlementRow[]> {
  const rows = await scope.select(tenantEntitlements);
  return rows.map((row) => ({ plan: row.plan, grantedAt: row.grantedAt, endsAt: row.endsAt }));
}

export async function grantEntitlement(
  scope: TenantScope,
  input: { plan: string; endsAt?: Date | null; note?: string | null; grantedAt?: Date },
): Promise<void> {
  await scope.insert(tenantEntitlements, {
    id: uuidv7(),
    plan: input.plan,
    grantedAt: input.grantedAt ?? new Date(),
    endsAt: input.endsAt ?? null,
    note: input.note ?? null,
  });
}
