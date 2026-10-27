import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import {
  adjustmentsInRange,
  cashMovementsExceptionInRange,
  paymentReversalsInRange,
  hasOpeningFloat,
  lateSyncedInRange,
  overridesAndDiscountsInRange,
  reportFigures,
  expiredStockSoldInRange,
  purchaseCorrectionsInRange,
  supplierReturnsInRange,
  returnsInRange,
  quickItemsInRange,
  threeNumbers,
} from '@/db/reporting-queries';
import { supplierBook } from '@/db/supplier-queries';
import { businessDayBounds, businessDayOf, type BusinessDay } from '@/lib/business-day';
import { describeCounted } from '@/lib/quantity';
import { supplierReturnStockCosts } from '@/db/batch-cost-queries';

import { DaySurface } from './day-surface';

const BUSINESS_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Day & Reports — W10, F5, Phase 10 §2 surface 8.
 *
 *   "One screen, three numbers first … then the exception list … Owner counts
 *    the drawer against the expected figure; a recorded over/short entry
 *    closes the ritual. Nothing locks (D5)."
 *
 * Owner-only (the F5 key binding already marks it so, Session 1) — gated here
 * too, since a key-bar hint is not a guarantee.
 *
 * Weekly and monthly report tabs are Phase 13 §3's first cut-order item and
 * are not built here (see CHANGELOG); daily and overall (all-time) answer the
 * done-when without them.
 */
export default async function DayPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; view?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }
  if (session.userRole !== 'owner') {
    redirect('/sale');
  }

  const params = await searchParams;
  const today = businessDayOf(new Date());
  const day: BusinessDay = params.day && BUSINESS_DAY_PATTERN.test(params.day) ? params.day : today;
  const view = params.view === 'overall' ? 'overall' : 'daily';

  const scope = scopeFor(session);
  const { start, end } = businessDayBounds(day);
  const range =
    view === 'overall' ? { start: new Date(0), end: new Date('2999-01-01') } : { start, end };

  const [
    numbers,
    overrides,
    returns,
    expiredSold,
    quickItems,
    adjustments,
    corrections,
    supplierReturns,
    cashMovements,
    paymentReversals,
    lateSynced,
    figures,
    openingFloat,
    suppliers,
  ] = await Promise.all([
    threeNumbers(scope, range.start, range.end),
    overridesAndDiscountsInRange(scope, range.start, range.end),
    returnsInRange(scope, range.start, range.end),
    expiredStockSoldInRange(scope, range.start, range.end),
    quickItemsInRange(scope, range.start, range.end),
    adjustmentsInRange(scope, range.start, range.end),
    purchaseCorrectionsInRange(scope, range.start, range.end),
    supplierReturnsInRange(scope, range.start, range.end),
    cashMovementsExceptionInRange(scope, range.start, range.end),
    paymentReversalsInRange(scope, range.start, range.end),
    lateSyncedInRange(scope, range.start, range.end),
    reportFigures(scope, range.start, range.end),
    // Always today's bounds, never the range: the prompt is about the drawer
    // in front of the owner right now.
    hasOpeningFloat(scope, start, end),
    // A position, not an event in a window (like the udhaar total): what the
    // pharmacy owes suppliers, and what they hold in credit (PCN-011), right
    // now, whatever range is being viewed.
    supplierBook(scope),
  ]);
  const stockCosts = supplierReturns.length > 0 ? await supplierReturnStockCosts(scope) : new Map();

  return (
    <DaySurface
      day={day}
      today={today}
      view={view}
      numbers={numbers}
      figures={figures}
      overrides={overrides}
      returns={returns}
      expiredSold={expiredSold}
      quickItems={quickItems}
      // [PCN-012] In the words they were counted in, worked out here so the
      // client needs no pack arithmetic.
      adjustments={adjustments.map((row) => ({
        ...row,
        amount: describeCounted({ ...row, qtyBase: row.qtyBaseDelta }),
      }))}
      corrections={corrections}
      supplierReturns={supplierReturns.map((row) => ({
        ...row,
        amount: describeCounted(row),
        stockCostPaisa: stockCosts.get(row.id) ?? 0,
      }))}
      cashMovements={cashMovements}
      paymentReversals={paymentReversals}
      lateSynced={lateSynced}
      hasOpeningFloat={openingFloat}
      supplierOwedPaisa={suppliers.owedPaisa}
      supplierCreditPaisa={suppliers.creditPaisa}
      suppliersInCredit={suppliers.suppliersInCredit}
    />
  );
}
