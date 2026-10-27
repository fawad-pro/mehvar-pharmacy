'use client';

/**
 * The backstop behind the counter's scan guard (`field-guard.ts`): an amount
 * too large to be real commits only by a click, never by Enter.
 *
 * The guard recognises a scan by its speed and puts it back. A scan that
 * slipped past it (a very busy PC) would otherwise commit on the scanner's
 * own Enter — Cash tendered printed "Paid 8,964,000,101,018.00" before the
 * guard existed. No scanner clicks. Nothing is refused (W3 caps no payment);
 * an implausible amount is only confirmed by hand.
 */

/** Rs 1 crore. No counter takes this in cash; an 8-digit code or longer does. */
export const CLICK_TO_COMMIT_PAISA = 1_000_000_000;

export function needsClickToCommit(amountPaisa: number): boolean {
  return amountPaisa >= CLICK_TO_COMMIT_PAISA;
}
