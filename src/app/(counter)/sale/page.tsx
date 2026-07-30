import { redirect } from 'next/navigation';

import { currentSession } from '@/auth/session';

import { SaleSurface } from './sale-surface';

/**
 * Sale — home (Phase 10 §1). W1, W2, W5, W6 in one surface, payment as overlay.
 *
 * This is the 80% surface and the one the product exists for. Search and its
 * ranked results came from Session 2 (ADR-4); Session 3 adds the cart, the
 * quantity grammar and a cash commit. The payment overlay, change, udhaar and
 * the printed receipt are Session 4.
 */
export default async function SalePage() {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }
  return <SaleSurface tenantId={session.tenantId} />;
}
