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

import { keysFor } from '@/client/keyboard/registry';
import { useGlobalKeys } from '@/client/keyboard/use-global-keys';
import { UdhaarKeyProvider, useUdhaarKeyRegistry } from '@/client/keyboard/udhaar-key-context';
import { ReceiptContextProvider } from '@/client/receipt/receipt-context';
import { SyncProvider } from '@/client/sync/provider';
import { RefreshOnSync } from '@/client/sync/refresh-on-sync';
import { ServiceWorker } from '@/client/sync/service-worker';

import { KeyBar } from './key-bar';
import { LicenceBanner, type LicenceNotice } from './licence-banner';
import { PhoneTabs } from './phone-tabs';
import { PinSwitchOverlay, type SwitchableUser } from './pin-switch-overlay';
import { ScanGuard } from './scan-guard';
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
  licence,
  udhaarEnabled,
  children,
}: {
  tenantId: string;
  tenantName: string;
  deviceName: string | null;
  userId: string;
  userName: string;
  userRole: 'owner' | 'salesman';
  users: SwitchableUser[];
  licence: LicenceNotice | null;
  /** Whether this shop sells on udhaar (Settings); off removes its key. */
  udhaarEnabled: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [settling, setSettling] = useState(false);
  const { register, dispatch } = useUdhaarKeyRegistry();
  const keys = keysFor(udhaarEnabled);

  const handlers = useMemo(
    () => ({
      onSwitchUser: () => {
        setSwitching(true);
      },
      onUdhaar: () => {
        if (!udhaarEnabled) return;
        // Defect C5: the Sale surface takes the udhaar key for itself when
        // the cart has items (attach customer, W2); with nothing registered
        // — an empty cart, or any other screen — this is the fallback
        // (Settle Udhaar, W3).
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
    [switching, settling, dispatch, udhaarEnabled],
  );

  useGlobalKeys(handlers);

  // A routeless key's meaning, run exactly as pressing it does — from the key
  // bar's chip on a tablet or the tab bar's More on a phone.
  const onDispatch = (meaning: 'udhaar' | 'switch-user') => {
    if (meaning === 'udhaar') handlers.onUdhaar();
    else handlers.onSwitchUser();
  };

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
    <ReceiptContextProvider tenantId={tenantId} salesmanName={userName}>
      <SyncProvider tenantId={tenantId} restricted={licence?.tier === 'restricted'}>
        <ServiceWorker />
        {/* Every screen re-reads when the outbox lands a record — see the
            component's own note. Mounted here so no surface has to know. */}
        <RefreshOnSync />
        {/* A barcode scanned into a field not meant for one is put back,
            on every screen (see the component). */}
        <ScanGuard />

        <div className="bg-page flex h-dvh w-full max-w-full flex-col overflow-x-hidden">
          <TopBar
            tenantName={tenantName}
            userName={userName}
            userRole={userRole}
            deviceName={deviceName}
            onSwitchUser={() => {
              setSwitching(true);
            }}
          />

          {/* Between the bar and the surface: visible without being in the way,
              and never over the cart. */}
          <LicenceBanner notice={licence} isOwner={userRole === 'owner'} />

          <UdhaarKeyProvider register={register} press={handlers.onUdhaar}>
            <main className="min-h-0 flex-1 w-full max-w-full overflow-y-auto overflow-x-hidden">{children}</main>
          </UdhaarKeyProvider>

          <KeyBar role={userRole} keys={keys} onDispatch={onDispatch} />
          {/* Below 768px the key bar gives way to five tabs (PCN-016). */}
          <PhoneTabs role={userRole} keys={keys} onDispatch={onDispatch} />

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
