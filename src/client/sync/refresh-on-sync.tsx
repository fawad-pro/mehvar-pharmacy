'use client';

/**
 * Re-render the server components when the outbox lands something.
 *
 * ADR-3's design separates *captured* from *written*, and that separation is
 * load-bearing: `capture()` resolves once the record is on disk, which is what
 * lets the counter print a receipt and carry on through an outage (Phase 7
 * rule 3). Nothing about that changes here.
 *
 * What was missing is the other end. Once the pump does deliver a record, the
 * database has moved and every server-rendered list on screen is stale — the
 * customer's balance, the day's numbers, the recent-sales list, the completion
 * queue. Nothing told them. So the shop's habit became "press F5 and see", and
 * a product whose whole promise is that the operator should not have to think
 * was asking them to think about cache invalidation.
 *
 * One component, mounted once in the shell, watching one signal. It is
 * deliberately not per-screen: which screens a delivered sale affects is not
 * knowledge any individual screen has, and enumerating them somewhere would be
 * a list that goes stale the first time a surface is added.
 *
 * Never while a navigation is pending (`client/navigation/intent.ts`): a
 * refresh cancels it, and right after a sale is when the next key is pressed.
 *
 * `router.refresh()` re-fetches the server components and reconciles into the
 * existing tree — it does not remount, so focus, scroll and the cart in
 * progress all survive. That matters more than it sounds: this fires while
 * someone is mid-sale.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  clearNavigationIntent,
  navigationPending,
  watchLinkClicks,
} from '@/client/navigation/intent';

import { useSync } from './provider';

export function RefreshOnSync(): null {
  const router = useRouter();
  const { deliveredSeq } = useSync();
  const seen = useRef(deliveredSeq);
  const pathname = usePathname();

  useEffect(watchLinkClicks, []);

  // Arriving somewhere is the navigation finishing.
  useEffect(() => {
    clearNavigationIntent();
  }, [pathname]);

  useEffect(() => {
    if (deliveredSeq === seen.current) {
      return;
    }
    seen.current = deliveredSeq;
    // A refresh now would cancel the navigation the operator just asked for;
    // the page they are going to renders fresh, so there is nothing to miss.
    if (navigationPending()) {
      return;
    }
    router.refresh();
  }, [deliveredSeq, router]);

  return null;
}
