import 'server-only';

import { permits, type Capability } from '@/domain/licensing/capabilities';

import { listTenantIds, anyUserId } from './provisioning';
import { resolveLicence } from './licence-state-queries';

/**
 * The licence gate for work that runs OUTSIDE a request — the catalogue-pack
 * importer, and the updater when roadmap Phase 2 builds it.
 *
 * A CLI has no session, so it cannot ask `requireCapability`. It asks here
 * instead, and the question is "does any tenant on this installation still hold
 * this capability". Any rather than all, deliberately: a multi-tenant Node is a
 * cloud host, and one lapsed pharmacy there must not stop the medicine
 * catalogue updating for everybody else.
 */
export async function installationPermits(capability: Capability): Promise<boolean> {
  const tenantIds = await listTenantIds();
  // No pharmacy yet — the installer applying its bundled pack before `init`
  // runs. Nothing to withhold from.
  if (tenantIds.length === 0) return true;

  for (const tenantId of tenantIds) {
    const userId = await anyUserId(tenantId);
    if (userId === undefined) continue;
    const { state } = await resolveLicence(tenantId, userId, '');
    if (permits(state.tier, capability)) return true;
  }
  return false;
}
