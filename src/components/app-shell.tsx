'use client';

/**
 * The counter shell — Phase 10 §1.
 *
 * "Persistent chrome is minimal": the top bar above, the key bar below, and the
 * surface in between. Every other screen is a sortie from Sale, reached by one
 * global key and exited with Esc.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { useGlobalKeys } from '@/client/keyboard/use-global-keys';

import { KeyBar } from './key-bar';
import { PinSwitchOverlay, type SwitchableUser } from './pin-switch-overlay';
import { TopBar } from './top-bar';

export function AppShell({
  tenantName,
  deviceName,
  userId,
  userName,
  userRole,
  users,
  children,
}: {
  tenantName: string;
  deviceName: string | null;
  userId: string;
  userName: string;
  userRole: 'owner' | 'salesman';
  users: SwitchableUser[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const handlers = useMemo(
    () => ({
      onSwitchUser: () => {
        setSwitching(true);
      },
      onEscape: () => {
        if (switching) {
          setSwitching(false);
          return true;
        }
        return false;
      },
    }),
    [switching],
  );

  useGlobalKeys(handlers);

  const onSwitched = useCallback(() => {
    setSwitching(false);
    // The session row moved; re-render the server components so the active-user
    // chip and every subsequent attribution reflect the new person.
    router.refresh();
  }, [router]);

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        tenantName={tenantName}
        userName={userName}
        userRole={userRole}
        deviceName={deviceName}
        onSwitchUser={() => {
          setSwitching(true);
        }}
      />

      <main className="min-h-0 flex-1 overflow-auto">{children}</main>

      <KeyBar role={userRole} />

      {switching ? (
        <PinSwitchOverlay
          users={users}
          currentUserId={userId}
          onClose={() => {
            setSwitching(false);
          }}
          onSwitched={onSwitched}
        />
      ) : null}
    </div>
  );
}
