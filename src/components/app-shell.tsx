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
import { F8Provider, useF8Registry } from '@/client/keyboard/f8-context';
import { ReceiptContextProvider } from '@/client/receipt/receipt-context';
import { SyncProvider } from '@/client/sync/provider';
import { RefreshOnSync } from '@/client/sync/refresh-on-sync';
import { ServiceWorker } from '@/client/sync/service-worker';

import { KeyBar } from './key-bar';
import { PinSwitchOverlay, type SwitchableUser } from './pin-switch-overlay';
import { SettleUdhaarOverlay } from './settle-udhaar-overlay';
import { TopBar } from './top-bar';

export function AppShell({
  tenantId,
  tenantName,
  deviceName,
  userId,
  userName,
  userRole,
  users,
  children,
}: {
  tenantId: string;
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
  const [settling, setSettling] = useState(false);
  const { register, dispatch } = useF8Registry();

  const handlers = useMemo(
    () => ({
      onSwitchUser: () => {
        setSwitching(true);
      },
      onUdhaar: () => {
        // Defect C5: the Sale surface takes F8 for itself when the cart has
        // items (attach customer, W2); with nothing registered — an empty
        // cart, or any other screen — this is the fallback (Settle Udhaar, W3).
        dispatch(() => {
          setSettling(true);
        });
      },
      onEscape: () => {
        if (switching) {
          setSwitching(false);
          return true;
        }
        if (settling) {
          setSettling(false);
          return true;
        }
        return false;
      },
    }),
    [switching, settling, dispatch],
  );

  useGlobalKeys(handlers);

  const onSwitched = useCallback(() => {
    setSwitching(false);
    // The session row moved; re-render the server components so the active-user
    // chip and every subsequent attribution reflect the new person.
    router.refresh();
  }, [router]);

  return (
    // Both providers wrap the whole shell, not just the surface: the top bar's
    // unsynced badge (ADR-3) reads the sync context, and Settle Udhaar (W3)
    // captures through it from outside any page.
    <ReceiptContextProvider tenantId={tenantId}>
      <SyncProvider tenantId={tenantId}>
        <ServiceWorker />
        {/* Every screen re-reads when the outbox lands a record — see the
            component's own note. Mounted here so no surface has to know. */}
        <RefreshOnSync />

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

          <F8Provider register={register}>
            <main className="min-h-0 flex-1 overflow-auto">{children}</main>
          </F8Provider>

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

          {settling ? (
            <SettleUdhaarOverlay
              onClose={() => {
                setSettling(false);
              }}
            />
          ) : null}
        </div>
      </SyncProvider>
    </ReceiptContextProvider>
  );
}
