import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import {
  adjustmentsInRange,
  cashMovementsExceptionInRange,
  hasOpeningFloat,
  lateSyncedInRange,
  overridesAndDiscountsInRange,
  reportFigures,
  returnsInRange,
  quickItemsInRange,
  threeNumbers,
} from '@/db/reporting-queries';
import { businessDayBounds, businessDayOf, type BusinessDay } from '@/lib/business-day';

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
    quickItems,
    adjustments,
    cashMovements,
    lateSynced,
    figures,
    openingFloat,
  ] = await Promise.all([
    threeNumbers(scope, range.start, range.end),
    overridesAndDiscountsInRange(scope, range.start, range.end),
    returnsInRange(scope, range.start, range.end),
    quickItemsInRange(scope, range.start, range.end),
    adjustmentsInRange(scope, range.start, range.end),
    cashMovementsExceptionInRange(scope, range.start, range.end),
    lateSyncedInRange(scope, range.start, range.end),
    reportFigures(scope, range.start, range.end),
    // Always today's bounds, never the range: the prompt is about the drawer
    // in front of the owner right now.
    hasOpeningFloat(scope, start, end),
  ]);

  return (
    <DaySurface
      day={day}
      today={today}
      view={view}
      numbers={numbers}
      figures={figures}
      overrides={overrides}
      returns={returns}
      quickItems={quickItems}
      adjustments={adjustments}
      cashMovements={cashMovements}
      lateSynced={lateSynced}
      hasOpeningFloat={openingFloat}
    />
  );
}
