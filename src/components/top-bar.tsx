'use client';

/**
 * The top bar — Phase 10 §1: "a slim top bar (pharmacy name, active user chip
 * with PIN-switch, connectivity/unsynced badge)".
 *
 * The unsynced badge is the visible semantic state ADR-3 requires: "unsynced-
 * record count is a visible semantic state (I7)". It counts the outbox, which
 * is the only honest number — "offline" describes the network, and what the
 * operator actually needs to know is whether any of their sales are still only
 * on this machine.
 *
 * Amber throughout, never red (I7): unsynced is the caution family, alongside
 * near-expiry and negative stock. A queue draining normally is not an alarm,
 * and colouring it like one would teach the counter to ignore the alarm colour.
 */

import { useEffect, useState } from 'react';

import { useSync } from '@/client/sync/provider';

export function TopBar({
  tenantName,
  userName,
  userRole,
  deviceName,
  onSwitchUser,
}: {
  tenantName: string;
  userName: string;
  userRole: 'owner' | 'salesman';
  deviceName: string | null;
  onSwitchUser: () => void;
}) {
  const [online, setOnline] = useState(true);
  const { unsyncedCount, stuck } = useSync();

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return (
    <header className="border-line bg-paper flex h-touch shrink-0 items-center gap-4 border-b px-3">
      <span className="text-green-900 font-semibold">{tenantName}</span>

      {deviceName ? <span className="text-ink/40 text-xs">{deviceName}</span> : null}

      <div className="ml-auto flex items-center gap-3">
        {/* I7 — semantic colour only with meaning. Amber is the caution family:
            near-expiry, negative stock, unsynced. Nothing else may borrow it. */}
        {unsyncedCount > 0 ? (
          <span
            className="text-amber border-amber/40 rounded border px-2 py-0.5 text-xs"
            role="status"
            aria-label={`${unsyncedCount} record${unsyncedCount === 1 ? '' : 's'} waiting to sync`}
          >
            <span className="numeral font-medium">{unsyncedCount}</span> waiting to sync
            {/* ADR-3's calm sentence, and it is literally true — the queue is
                what keeps it true. */}
            {stuck ? ' — needs attention' : online ? '' : ' — selling keeps working'}
          </span>
        ) : online ? null : (
          <span className="text-amber border-amber/40 rounded border px-2 py-0.5 text-xs">
            Offline — selling keeps working
          </span>
        )}

        <button
          type="button"
          onClick={onSwitchUser}
          className="border-line hover:bg-green-100 flex items-center gap-2 rounded border px-2 py-1 text-sm"
        >
          <span className="font-medium">{userName}</span>
          <span className="text-ink/50 text-xs capitalize">{userRole}</span>
          <kbd className="text-ink/40 text-xs">F10</kbd>
        </button>
      </div>
    </header>
  );
}
