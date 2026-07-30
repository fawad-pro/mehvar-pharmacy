import { redirect } from 'next/navigation';

import { switchableUsers } from '@/auth/actions';
import { currentSession } from '@/auth/session';
import { CatalogProvider } from '@/client/search/provider';
import { AppShell } from '@/components/app-shell';

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
      >
        {children}
      </AppShell>
    </CatalogProvider>
  );
}
