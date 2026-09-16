import { redirect } from 'next/navigation';

import { switchableUsers } from '@/auth/actions';
import { currentSession, type ActiveSession } from '@/auth/session';
import { CatalogProvider } from '@/client/search/provider';
import { AppShell } from '@/components/app-shell';
import type { LicenceNotice } from '@/components/licence-banner';
import { CAPABILITY_LABELS, withheldBy } from '@/domain/licensing/capabilities';

/**
 * Every counter surface sits inside the shell, and every counter surface
 * requires a session.
 *
 * Authorization is enforced server-side (Phase 12 §5, "never by hiding UI"); the
 * gate here is authentication only. Per-surface role checks land with the
 * surfaces that need them.
 */
export default async function CounterLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const users = await switchableUsers();

  return (
    // The catalog index is built once per session and lives above the surfaces
    // (ADR-4), so moving between Sale and Products never rebuilds it.
    <CatalogProvider tenantId={session.tenantId}>
      <AppShell
        tenantId={session.tenantId}
        tenantName={session.tenantName}
        deviceName={session.deviceName}
        userId={session.userId}
        userName={session.userName}
        userRole={session.userRole}
        users={users}
        licence={licenceNotice(session)}
      >
        {children}
      </AppShell>
    </CatalogProvider>
  );
}

/**
 * The banner's data, assembled server-side (PCN-005).
 *
 * `null` when the licence is healthy, so nothing renders at all. `expiring` is
 * marked owner-only: a salesman can do nothing about a renewal date, and a
 * warning they see every day is a warning nobody reads.
 */
function licenceNotice(session: ActiveSession): LicenceNotice | null {
  const { licence } = session;
  if (licence.status === 'licensed') return null;

  return {
    status: licence.status,
    tier: licence.tier,
    entitlementEndsOn: licence.entitlementEndsOn ?? null,
    graceEndsOn: licence.graceEndsOn ?? null,
    trialEndsOn: licence.trialEndsOn ?? null,
    daysRemaining: licence.daysRemaining ?? null,
    withheld: withheldBy(licence.tier).map((capability) => CAPABILITY_LABELS[capability]),
    ownerOnly: licence.status === 'expiring' || licence.status === 'trial',
  };
}
