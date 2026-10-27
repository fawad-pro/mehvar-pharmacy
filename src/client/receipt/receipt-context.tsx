'use client';

/**
 * Shared receipt context — device-scoped numbering (Phase 9 §3) and the
 * tenant's print header/footer (Phase 10 §7), fetched once per counter session
 * rather than once per surface.
 *
 * `AppShell` mounts this above every screen, so the udhaar key's Settle
 * Udhaar (W3) can mint a receipt number even when the operator never opened
 * Sale first — the
 * seeding this replaces used to live only in the Sale surface, which meant a
 * device that went straight to Customers had no seeded counter yet.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { saleContext, type SaleContext } from '@/app/(counter)/sale/actions';
import {
  nextReceiptNumber,
  seedReceiptCounter,
  skipReceiptNumber,
} from '@/client/print/receipt-number';

export interface ReceiptContextValue extends SaleContext {
  nextReceiptNumber: () => string;
  skipReceiptNumber: (taken: string) => void;
  /** Re-reads the receipt settings — Settings calls it after saving them. */
  reload: () => Promise<void>;
}

const ReceiptContext = createContext<ReceiptContextValue | null>(null);

export function ReceiptContextProvider({
  tenantId,
  salesmanName,
  children,
}: {
  tenantId: string;
  /**
   * Whoever is acting now, from the session. The context is fetched once, so
   * the name it carried was whoever was acting when the counter opened — the
   * owner, for a freshly opened counter — and every receipt after a PIN switch
   * still printed it. The shell re-renders with the new name on every switch.
   */
  salesmanName: string;
  children: React.ReactNode;
}) {
  const [context, setContext] = useState<SaleContext | null>(null);
  /** Bumped to ask for another attempt; see the retry below. */
  const [attempt, setAttempt] = useState(0);

  /**
   * Fetched once, then retried until it lands.
   *
   * The retry is not defensive tidiness — without it this is a way to lose a
   * day's trading. Nothing can be sold until this resolves, because a receipt
   * needs a number and a number needs the device's counter seeded from the
   * server (Phase 9 §3). A single failed request at startup — the counter
   * opening before the uplink is up, a blip while the shell mounts — would
   * otherwise leave the Pay button disabled with no way back except a reload
   * nobody would think to try. That is precisely the wall P2 forbids, and it
   * is worse than an outage, because the counter *looks* fine.
   *
   * So: try, and keep trying, quietly, until there is a counter to sell with.
   */
  useEffect(() => {
    if (context) {
      return;
    }
    let cancelled = false;

    void saleContext()
      .then((ctx) => {
        if (cancelled) {
          return;
        }
        if (!ctx) {
          // No receipt prefix means this session is an owner's phone rather
          // than a counter (Phase 12 §5) — nothing to seed, and nothing to
          // retry for either.
          return;
        }
        // Seeded once: a re-imaged machine must not restart at 1 and collide
        // with everything it has already printed.
        seedReceiptCounter(tenantId, ctx.receiptPrefix, ctx.highestReceiptCounter);
        setContext(ctx);
      })
      .catch(() => {
        if (!cancelled) {
          setAttempt((current) => current + 1);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, context, attempt]);

  // Backs off to a second between tries, and comes back immediately when the
  // network does — the same posture the sync pump takes.
  useEffect(() => {
    if (context || attempt === 0) {
      return;
    }
    const retry = () => {
      setAttempt((current) => current + 1);
    };
    const timer = window.setTimeout(retry, 1_000);
    window.addEventListener('online', retry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [context, attempt]);

  /**
   * The settings in this context (auto-print, header, footer) used to be read
   * once per app load, so unticking "Print a receipt for every sale" in
   * Settings saved correctly and changed nothing until the counter was
   * restarted. Settings now awaits this after a save. A failed re-read keeps
   * the values already held: a stale footer is better than a counter that
   * cannot number a receipt.
   */
  const reload = useCallback(async () => {
    try {
      const ctx = await saleContext();
      if (ctx) {
        seedReceiptCounter(tenantId, ctx.receiptPrefix, ctx.highestReceiptCounter);
        setContext(ctx);
      }
    } catch {
      // Kept as it was; the next app load reads the settings afresh.
    }
  }, [tenantId]);

  const value = useMemo<ReceiptContextValue | null>(() => {
    if (!context) {
      return null;
    }
    return {
      ...context,
      salesmanName,
      nextReceiptNumber: () => nextReceiptNumber(tenantId, context.receiptPrefix),
      skipReceiptNumber: (taken: string) => {
        skipReceiptNumber(tenantId, context.receiptPrefix, taken);
      },
      reload,
    };
  }, [context, tenantId, salesmanName, reload]);

  return <ReceiptContext.Provider value={value}>{children}</ReceiptContext.Provider>;
}

/** Null until the one-time fetch resolves — callers gate commit buttons on it. */
export function useReceiptContext(): ReceiptContextValue | null {
  return useContext(ReceiptContext);
}
