import { redirect } from 'next/navigation';

import { currentSession } from '@/auth/session';

import { ReturnsSurface } from './returns-surface';

/**
 * Returns — W4, Phase 10 §2 surface 3, F7.
 *
 * Now only the workflow. Looking at a completed sale moved to `/receipts`,
 * which is where "Start a return" hands off from: arriving here with
 * `?receipt=` means the sale has already been chosen, so the screen opens on
 * it rather than asking the operator to search for what they were just
 * reading.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ receipt?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }
  const { receipt } = await searchParams;
  return <ReturnsSurface {...(receipt ? { prefillReceipt: receipt } : {})} />;
}
