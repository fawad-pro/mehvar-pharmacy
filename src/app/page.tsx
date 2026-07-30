import { redirect } from 'next/navigation';

import { currentSession } from '@/auth/session';
import { HOME_ROUTE } from '@/client/keyboard/registry';

/**
 * Phase 10 §1: the sale screen is home. There is no dashboard-first posture for
 * the counter — the counter's dashboard is the cart.
 */
export default async function RootPage() {
  redirect((await currentSession()) ? HOME_ROUTE : '/login');
}
