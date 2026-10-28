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

import { markNavigationIntent } from '@/client/navigation/intent';

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
    /**
     * Whether a dialog was open when Esc went down — read before any
     * dialog's own handler closes it. Esc then means "close the dialog" and
     * nothing else: a dialog the shell does not own (Record a payment, on a
     * customer's page) closed itself, and the same Esc then went home to
     * Sale, away from the ledger the payment had just changed.
     */
    let dialogOpenAtEscape = false;
    function beforeDialogs(event: KeyboardEvent): void {
      if (event.key === BACK_KEY) {
        dialogOpenAtEscape = document.querySelector('[aria-modal="true"]') !== null;
      }
    }

    function handle(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === BACK_KEY) {
        // A field that took Esc for itself (closing an inline form) says so
        // with preventDefault. Not stopPropagation: React listens on the
        // document too, beside this listener, so stopping propagation stops
        // nothing here.
        if (event.defaultPrevented) return;
        const closed = handlers.onEscape?.() ?? false;
        if (!closed && !dialogOpenAtEscape && window.location.pathname !== HOME_ROUTE) {
          markNavigationIntent();
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
        markNavigationIntent();
        router.push(binding.href);
      }
    }

    document.addEventListener('keydown', beforeDialogs, { capture: true });
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', beforeDialogs, { capture: true });
      document.removeEventListener('keydown', handle);
    };
  }, [router, handlers]);
}
