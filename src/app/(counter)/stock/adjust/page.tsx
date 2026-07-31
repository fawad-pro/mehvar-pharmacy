import { redirect } from 'next/navigation';

import { currentSession } from '@/auth/session';

import { AdjustSurface } from './adjust-surface';

/**
 * Adjustment — W8 (F9), and W9's opening stock via `?opening=1`.
 *
 * One screen for both because the arithmetic that materializes a batch must not
 * exist twice; the guided opening flow differs only in which direction and
 * reason are pre-selected.
 */
export default async function AdjustPage({
  searchParams,
}: {
  searchParams: Promise<{ opening?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }
  const params = await searchParams;
  return <AdjustSurface openingStock={params.opening === '1'} />;
}
