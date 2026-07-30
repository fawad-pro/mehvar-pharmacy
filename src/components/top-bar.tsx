'use client';

/**
 * The top bar — Phase 10 §1: "a slim top bar (pharmacy name, active user chip
 * with PIN-switch, connectivity/unsynced badge)".
 *
 * The unsynced badge is the visible semantic state ADR-3 requires. Its count is
 * wired in Session 5 (Day 5) when the offline queue exists; until then it
 * reports connectivity only, which is honest — there is nothing to be unsynced
 * yet, and a badge that lies about zero is worse than no badge.
 */

import { useEffect, useState } from 'react';

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
        {online ? null : (
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
