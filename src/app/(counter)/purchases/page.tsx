import { redirect } from 'next/navigation';

import { currentSession } from '@/auth/session';

import { PurchaseEntry } from './purchase-entry';

/**
 * Purchases — W7, Phase 10 §2 surface 4.
 *
 * Entry is the surface, not a list: a distributor delivery is the reason
 * anyone opens this screen, and the list of past invoices is reference
 * material. Recent purchases move to the day view on Day 7, where the owner
 * actually reviews them.
 */
export default async function PurchasesPage() {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }
  return <PurchaseEntry tenantId={session.tenantId} isOwner={session.userRole === 'owner'} />;
}
