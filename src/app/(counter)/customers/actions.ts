'use server';

/**
 * Customer actions — thin wrappers (same posture as `sale/actions.ts`).
 *
 * Only one remains after Day 5. Creating a customer and settling a balance are
 * both offline-capturable (ADR-3), so they go through the outbox and land at
 * `sync/actions.ts` instead; the screens read their own data server-side. What
 * is left is the type-ahead, which genuinely needs the server because it
 * searches the whole customer book rather than a cached slice.
 *
 * Every export in a `'use server'` file is a callable endpoint, so the ones the
 * queue replaced were deleted rather than left behind.
 */

import { currentSession, scopeFor } from '@/auth/session';
import { searchCustomers } from '@/db/udhaar-queries';

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}

export async function searchCustomersAction(term: string): Promise<CustomerHit[]> {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  return searchCustomers(scopeFor(session), term);
}
