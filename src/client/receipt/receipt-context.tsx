'use client';

/**
 * Shared receipt context — device-scoped numbering (Phase 9 §3) and the
 * tenant's print header/footer (Phase 10 §7), fetched once per counter session
 * rather than once per surface.
 *
 * `AppShell` mounts this above every screen, so F8's Settle Udhaar (W3) can
 * mint a receipt number even when the operator never opened Sale first — the
 * seeding this replaces used to live only in the Sale surface, which meant a
 * device that went straight to Customers had no seeded counter yet.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { saleContext, type SaleContext } from '@/app/(counter)/sale/actions';
import {
  nextReceiptNumber,
  seedReceiptCounter,
  skipReceiptNumber,
} from '@/client/print/receipt-number';

export interface ReceiptContextValue extends SaleContext {
  nextReceiptNumber: () => string;
  skipReceiptNumber: (taken: string) => void;
}

const ReceiptContext = createContext<ReceiptContextValue | null>(null);

export function ReceiptContextProvider({
  tenantId,
  children,
}: {
  tenantId: string;
  children: React.ReactNode;
}) {
  const [context, setContext] = useState<SaleContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    void saleContext().then((ctx) => {
      if (cancelled || !ctx) {
        return;
      }
      // Seeded once: a re-imaged machine must not restart at 1 and collide
      // with everything it has already printed.
      seedReceiptCounter(tenantId, ctx.receiptPrefix, ctx.highestReceiptCounter);
      setContext(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const value = useMemo<ReceiptContextValue | null>(() => {
    if (!context) {
      return null;
    }
    return {
      ...context,
      nextReceiptNumber: () => nextReceiptNumber(tenantId, context.receiptPrefix),
      skipReceiptNumber: (taken: string) => {
        skipReceiptNumber(tenantId, context.receiptPrefix, taken);
      },
    };
  }, [context, tenantId]);

  return <ReceiptContext.Provider value={value}>{children}</ReceiptContext.Provider>;
}

/** Null until the one-time fetch resolves — callers gate commit buttons on it. */
export function useReceiptContext(): ReceiptContextValue | null {
  return useContext(ReceiptContext);
}
