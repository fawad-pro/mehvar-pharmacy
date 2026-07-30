/**
 * Business-day arithmetic — Phase 9 §1.
 *
 * "Business day: derived from `created_at` in tenant-local time (single
 * timezone country); no stored day-close lock (D5)."
 *
 * Day close is a reporting frame, not a transactional boundary: nothing is
 * frozen, and late entries land visibly in the day they were recorded. That
 * makes "which day is this record in?" a pure function of its timestamp and the
 * tenant's timezone — which is exactly what lives here.
 */

export const DEFAULT_TIME_ZONE = 'Asia/Karachi';

/** A calendar day in tenant-local time, as `YYYY-MM-DD`. */
export type BusinessDay = string;

const BUSINESS_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new Error(`Time zone ${timeZone} produced no ${type} part`);
    }
    return Number(part.value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east positive). */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = localParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The tenant-local calendar day a timestamp belongs to. */
export function businessDayOf(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): BusinessDay {
  const { year, month, day } = localParts(instant, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseBusinessDay(day: BusinessDay): { year: number; month: number; date: number } {
  if (!BUSINESS_DAY_PATTERN.test(day)) {
    throw new RangeError(`Business day must be formatted YYYY-MM-DD, received: ${day}`);
  }
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return { year, month, date };
}

/**
 * The UTC instant at which a tenant-local day begins. Resolved by correcting an
 * initial guess with the offset actually in force at that guess — correct across
 * offset transitions even though Pakistan currently observes none.
 */
export function startOfBusinessDay(day: BusinessDay, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const { year, month, date } = parseBusinessDay(day);
  const guess = Date.UTC(year, month - 1, date);
  const corrected = guess - offsetMs(new Date(guess), timeZone);
  const refined = guess - offsetMs(new Date(corrected), timeZone);
  return new Date(refined);
}

/** The UTC instant at which a tenant-local day ends (exclusive). */
export function endOfBusinessDay(day: BusinessDay, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const { year, month, date } = parseBusinessDay(day);
  const nextDay = new Date(Date.UTC(year, month - 1, date + 1));
  return startOfBusinessDay(businessDayOf(nextDay, 'UTC'), timeZone);
}

/**
 * Half-open `[start, end)` bounds for a business day — the shape every daily
 * report query (Phase 9 §7) filters `created_at` against.
 */
export function businessDayBounds(
  day: BusinessDay,
  timeZone: string = DEFAULT_TIME_ZONE,
): { start: Date; end: Date } {
  return {
    start: startOfBusinessDay(day, timeZone),
    end: endOfBusinessDay(day, timeZone),
  };
}
