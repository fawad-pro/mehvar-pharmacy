'use client';

/**
 * Binds the one registry (Phase 10 §3) to the document.
 *
 * The counter never needs the mouse (I1), so these are bound globally rather
 * than per-screen. Two deliberate exemptions:
 *
 *  - Typing in a field still wins for ordinary keys; function keys do not,
 *    because "search is the home position" means focus is almost always in the
 *    search box and F2 must still reach Purchases from there (Phase 7 rule 1).
 *  - The browser's own F1/F5/F10 behaviour is suppressed. On the counter this is
 *    belt and braces — the machine runs a dedicated kiosk profile (Phase 12 §6)
 *    — but a developer's browser should behave the same as the shop's.
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { BACK_KEY, GLOBAL_KEYS, HOME_ROUTE } from './registry';

export interface GlobalKeyHandlers {
  /** The udhaar key — contextual: attach customer, or open Settle Udhaar (defect C5). */
  onUdhaar?: () => void;
  /** The switch-user key — PIN switch (ADR-7). */
  onSwitchUser?: () => void;
  /** Esc — close the topmost overlay; returns true when one was open. */
  onEscape?: () => boolean;
}

export function useGlobalKeys(handlers: GlobalKeyHandlers = {}): void {
  const router = useRouter();

  useEffect(() => {
    function handle(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === BACK_KEY) {
        const closed = handlers.onEscape?.() ?? false;
        if (!closed && window.location.pathname !== HOME_ROUTE) {
          router.push(HOME_ROUTE);
        }
        return;
      }

      const binding = GLOBAL_KEYS.find((candidate) => candidate.key === event.key);
      if (!binding) {
        return;
      }

      event.preventDefault();

      // Dispatched by MEANING, not by key name — so the bar can be reordered
      // without silently rewiring what the keys do.
      if (binding.dispatch === 'udhaar') {
        handlers.onUdhaar?.();
        return;
      }
      if (binding.dispatch === 'switch-user') {
        handlers.onSwitchUser?.();
        return;
      }
      if (binding.href) {
        router.push(binding.href);
      }
    }

    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
    };
  }, [router, handlers]);
}
