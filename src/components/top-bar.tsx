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
 *
 * Whose name is on screen (PCN-016): the pharmacy's, never Mehvar's. A 32px
 * slot before it is kept for the pharmacy's own logo, drawn only once one
 * exists. On a phone the name ends in an ellipsis rather than wrap, and the
 * user chip and Settings move to the tab bar's More, which has room for them.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { GLOBAL_KEYS, keyFor } from '@/client/keyboard/registry';
import { useSync } from '@/client/sync/provider';

import { Badge } from './ui/badge';
import { buttonClass, Kbd } from './ui/button';

/** The screen's name, after the pharmacy's: the key bar's word for the route. */
function screenName(pathname: string): string | null {
  if (pathname.startsWith('/settings')) return 'Settings';
  let best: (typeof GLOBAL_KEYS)[number] | null = null;
  for (const binding of GLOBAL_KEYS) {
    if (binding.href === null || !pathname.startsWith(binding.href)) continue;
    if (best === null || binding.href.length > (best.href ?? '').length) best = binding;
  }
  return best?.label ?? null;
}

export function TopBar({
  tenantName,
  logoSrc = null,
  userName,
  userRole,
  deviceName,
  onSwitchUser,
}: {
  tenantName: string;
  /** The pharmacy's own small logo, once it has uploaded one. */
  logoSrc?: string | null;
  userName: string;
  userRole: 'owner' | 'salesman';
  deviceName: string | null;
  onSwitchUser: () => void;
}) {
  const [online, setOnline] = useState(true);
  const { unsyncedCount, stuck } = useSync();
  const where = screenName(usePathname());

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
    <header className="bg-surface shadow-top relative z-10 flex h-[60px] shrink-0 items-center gap-3 px-8 max-lg:px-6 max-md:h-[52px] max-md:px-4">
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- the pharmacy's own upload, not a build asset
        <img src={logoSrc} alt="" className="size-8 shrink-0 rounded-control object-contain" />
      ) : null}
      <p className="text-heading m-0 min-w-0 truncate whitespace-nowrap max-md:text-base">
        {tenantName}
      </p>
      {where ? (
        <>
          <span aria-hidden="true" className="bg-line h-5 w-px shrink-0 max-md:hidden" />
          <span className="text-ink-2 shrink-0 max-md:hidden">{where}</span>
        </>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* I7 — semantic colour only with meaning. Amber is the caution family:
            near-expiry, negative stock, unsynced. Nothing else may borrow it. */}
        {unsyncedCount > 0 ? (
          <Badge
            tone="attention"
            role="status"
            aria-label={`${unsyncedCount} record${unsyncedCount === 1 ? '' : 's'} waiting to sync`}
          >
            <span className="numeral font-medium">{unsyncedCount}</span>
            <span className="max-md:hidden">waiting</span> to sync
            {/* ADR-3's calm sentence, and it is literally true — the queue is
                what keeps it true. */}
            <span className="max-md:hidden">
              {stuck ? ' — needs attention' : online ? '' : ' — selling keeps working'}
            </span>
          </Badge>
        ) : online ? null : (
          <Badge tone="attention">
            Offline<span className="max-md:hidden"> — selling keeps working</span>
          </Badge>
        )}

        {deviceName ? (
          <span className="text-caption text-ink-2 max-lg:hidden">{deviceName}</span>
        ) : null}

        {/* No key bar entry (F1–F10 are spoken for) — Phase 10 §2 lists
            Settings without a shortcut, reachable from the owner chip. */}
        {userRole === 'owner' ? (
          <Link href="/settings" className={`${buttonClass('quiet')} max-md:hidden`}>
            Settings
          </Link>
        ) : null}

        <button
          type="button"
          onClick={onSwitchUser}
          className={`${buttonClass('quiet')} max-md:hidden`}
        >
          <span className="text-navy font-medium">{userName}</span>
          <span className="text-ink-2 font-normal">· {userRole}</span>
          <Kbd>{keyFor('switch-user')}</Kbd>
        </button>
      </div>
    </header>
  );
}
