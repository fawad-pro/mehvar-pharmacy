import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { recentAdjustments } from '@/db/adjustment-queries';

import { baseQty } from '@/lib/branded';
import { describeQuantity } from '@/lib/quantity';

import { AdjustSurface } from './adjust-surface';
import { AdjustmentHistory } from './adjustment-history';

/**
 * Adjustment — W8 (F9), and W9's opening stock via `?opening=1`.
 *
 * One screen for both because the arithmetic that materializes a batch must not
 * exist twice; the guided opening flow differs only in which direction and
 * reason are pre-selected.
 *
 * The history of adjustments lives here too, beneath the form, having moved off
 * the Stock screen. Stock is for browsing what you HAVE — what is expiring,
 * what is low, what is pending. A record of corrections someone made is not
 * that; it is the log of this screen's own work, and it answers the question
 * you ask while standing here ("did I already fix this?"), not the one you ask
 * while browsing shelves. T1's promise that every adjustment stays visible is
 * unchanged — the list is the same list, moved to where it means something.
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
  const history = await recentAdjustments(scopeFor(session), 25);

  return (
    <>
      <AdjustSurface openingStock={params.opening === '1'} isOwner={session.userRole === 'owner'} />
      <AdjustmentHistory
        rows={history.map((row) => ({
          id: row.id,
          productName: row.productName,
          baseUnitName: row.baseUnitName,
          qtyBaseDelta: row.qtyBaseDelta,
          // [PCN-012] As entered when it was "3 strip"; otherwise the amount in
          // the product's own units. The sign is the history's, not an amount's.
          amount:
            row.unitName !== null && row.unitCount !== null
              ? `${row.unitCount} ${row.unitName}`
              : describeQuantity(
                  baseQty(Math.abs(row.qtyBaseDelta)),
                  row.baseUnitName,
                  row.packLevels,
                ),
          reason: row.reason,
          note: row.note,
          byName: row.byName,
          createdAt: row.createdAt,
        }))}
      />
    </>
  );
}
