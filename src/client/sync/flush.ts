/**
 * The flush decisions — pure, so they are testable without a browser.
 *
 * Phase 11 §3 wants invariants tested and framework glue left alone. The glue
 * here is IndexedDB and `fetch`; the decisions are these four functions, and
 * they are the part that can be wrong in a way that costs money or tells the
 * owner something untrue. So they live apart from the pump that calls them.
 */

import type { OutboxRecord } from './records';

/**
 * How many records go in one delivery.
 *
 * A pharmacy that traded through a two-hour outage has a few hundred sales to
 * deliver. One request carrying all of them is a request that times out and
 * delivers none, so they go in chunks; FIFO order across chunks is preserved
 * because the pump stops on the first failure.
 */
export const BATCH_SIZE = 25;

/**
 * Was this record captured during a disruption?
 *
 * `origin` exists so the owner's daily view can say "these sales were captured
 * while the counter was cut off" (ADR-3's late-sync surfacing). That sentence
 * is only worth printing if it is true, so the decision is made at delivery
 * with two pieces of evidence rather than assumed from the fact that everything
 * routes through the queue:
 *
 *  - the counter believed itself offline when the operator committed, or
 *  - the record has already failed to deliver at least once.
 *
 * Either means a real disruption. Neither means a sale that queued and
 * delivered in the same breath gets mislabelled — which matters, because after
 * Day 5 *every* sale is captured locally first (Phase 7 rule 3), and an
 * `origin` that said `offline_sync` for all of them would be a column that
 * told the owner nothing.
 */
export function originFor(
  record: Pick<OutboxRecord, 'capturedOffline' | 'attempts'>,
): 'online' | 'offline_sync' {
  return record.capturedOffline || record.attempts > 0 ? 'offline_sync' : 'online';
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * How long to wait before the next attempt.
 *
 * Exponential with a ceiling. The ceiling matters more than the growth: the
 * `online` event is the real trigger for a reconnect, and this timer exists for
 * the cases that event does not cover — a captive portal, a server that is
 * reachable but erroring, a laptop whose network came back without firing
 * anything. Thirty seconds is short enough that nobody notices a stuck badge
 * and long enough that a broken server is not being hammered by every counter
 * in the country.
 *
 * The argument is the pump's *consecutive* failure count, deliberately not the
 * record's stored `attempts`. Those are different questions: `attempts` is the
 * record's history and feeds `origin` and the stuck warning, while backoff is
 * about the network right now. Driving the delay from the stored count meant a
 * counter that traded through a long outage came back with its backoff already
 * at the ceiling and sat with a lit badge for half a minute after the network
 * was visibly back — which is precisely the kind of thing that teaches an owner
 * not to believe the badge.
 */
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) {
    return 0;
  }
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (consecutiveFailures - 1));
}

/**
 * The pump's failure count after the server has answered a delivery.
 *
 * An answer proves the network is fine, but not that the queue moved. When the
 * head record comes back `retry` or `rejected` — a schema the code has run
 * ahead of, a bug in a writer — nothing was delivered, and resetting the count
 * to zero meant re-sending the same records every 250ms for as long as the tab
 * stayed open. Only progress clears the count; an answer that moved nothing
 * backs off exactly as an unreachable server does.
 */
export function failuresAfterAnswer(previous: number, progressed: boolean): number {
  return progressed ? 0 : previous + 1;
}

/**
 * Is there work, and has its wait elapsed?
 *
 * Only one wait exists rather than one per record, because delivery is strictly
 * FIFO — if the oldest record is still serving a backoff, nothing behind it may
 * jump ahead.
 */
export function readyToFlush(
  hasWork: boolean,
  consecutiveFailures: number,
  lastAttemptAt: number | null,
  now: number,
): boolean {
  if (!hasWork) {
    return false;
  }
  if (lastAttemptAt === null) {
    return true;
  }
  return now - lastAttemptAt >= backoffMs(consecutiveFailures);
}

/**
 * Re-mints a sale or settlement's receipt number after a collision.
 *
 * A taken number means two devices share a prefix, or a backup was restored
 * (Phase 9 §3). The record is fine; only its number is wrong, so it is swapped
 * and re-delivered rather than surfaced as an error the operator cannot act on.
 *
 * The printed slip keeps the old number, which is the honest cost of printing
 * from local state (ADR-3) and is why receipt numbers are device-scoped in the
 * first place — the collision is rare by construction, not by luck.
 */
export function withReceiptNumber(record: OutboxRecord, receiptNumber: string): OutboxRecord {
  switch (record.kind) {
    case 'sale':
      return { ...record, payload: { ...record.payload, receiptNumber } };
    case 'settlement':
      return { ...record, payload: { ...record.payload, receiptNumber } };
    default:
      // Quick items and customers carry no receipt number; a collision on one
      // of those is a duplicate id, which idempotency has already absorbed.
      return record;
  }
}
