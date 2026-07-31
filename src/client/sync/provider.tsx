'use client';

/**
 * The sync pump — ADR-3's "sync automatically on reconnect".
 *
 * Two jobs, and the order between them is the whole design:
 *
 *  1. **Capture.** `capture()` durably queues a record and resolves. The caller
 *     prints its receipt on that resolve. Nothing about a receipt waits on the
 *     network — Phase 7 rule 3: "nothing in a sale path awaits anything slower
 *     than the local machine except the final online commit, which the operator
 *     does not wait on for receipt printing."
 *  2. **Delivery.** A background loop drains the outbox in FIFO order whenever
 *     it plausibly can.
 *
 * **Every sale takes this path, online or not.** That is a deliberate choice
 * rather than a convenience. An offline path that only runs during outages is
 * a path that is never really tested, and Phase 13 §4 names lost or duplicated
 * sales "existential for trust". Routing all four capturable events through one
 * queue means the disruption path is exercised a few hundred times a day at
 * every counter, and a reconnect is not a special mode — it is the normal loop
 * finding the network already there.
 *
 * The cost of that choice is that a server rejection arrives after the receipt
 * printed. It is paid down by validating in the domain's own pure validators
 * before queueing (`validateSaleCommand` is exported for exactly this), so the
 * only outcomes left are transient ones the loop retries and collisions it
 * re-mints.
 *
 * Delivery is strictly serial and strictly in order: a quick item (W6) must
 * reach the server before the sale whose line references it, and a customer
 * created inline (W2) before the udhaar sale that owes against it.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { deliverRecords, type DeliverableRecord } from '@/app/(counter)/sync/actions';
import { useReceiptContext } from '@/client/receipt/receipt-context';

import { backoffMs, BATCH_SIZE, originFor, readyToFlush, withReceiptNumber } from './flush';
import {
  enqueue,
  markAttempted,
  pendingRecords,
  removeRecord,
  replaceRecord,
} from './queue';
import type { CapturedRecord, OutboxRecord } from './records';

/** Attempts after which a record stops being "in flight" and starts being a problem (T1). */
const STUCK_AFTER_ATTEMPTS = 5;

/** The safety-net tick; `online` is the real trigger. See `backoffMs`. */
const POLL_INTERVAL_MS = 15_000;

interface SyncContextValue {
  /** Durably queues a record. Resolves once it is on disk — print after this. */
  readonly capture: (record: CapturedRecord) => Promise<void>;
  /** Records waiting to reach the server — ADR-3's visible semantic state (I7). */
  readonly unsyncedCount: number;
  /** At least one record has failed repeatedly and needs a person to look (T1). */
  readonly stuck: boolean;
  /** Asks the pump to try now; safe to call at any time. */
  readonly flushNow: () => void;
}

const SyncContext = createContext<SyncContextValue>({
  capture: async () => {},
  unsyncedCount: 0,
  stuck: false,
  flushNow: () => {},
});

/** The envelope is the outbox's business; the server is sent only the record. */
function deliverable(record: OutboxRecord): DeliverableRecord {
  const captured = { kind: record.kind, payload: record.payload } as CapturedRecord;
  return { record: captured, origin: originFor(record) };
}

export function SyncProvider({
  tenantId,
  children,
}: {
  tenantId: string;
  children: React.ReactNode;
}) {
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [stuck, setStuck] = useState(false);
  const receipt = useReceiptContext();

  // Refs rather than state: the pump reads these on every iteration, and
  // putting them through the reconciler would restart the loop mid-drain.
  const running = useRef(false);
  const lastAttemptAt = useRef<number | null>(null);
  // Backoff state belongs to the pump, not to the records: it describes the
  // network right now. See `backoffMs`.
  const consecutiveFailures = useRef(0);

  // Kept in a ref so the pump can re-mint a collided receipt number without
  // the receipt context becoming a dependency that restarts the loop when it
  // resolves. Synchronised in an effect rather than during render.
  const mintReceiptNumber = useRef<(() => string) | null>(null);
  useEffect(() => {
    mintReceiptNumber.current = receipt ? receipt.nextReceiptNumber : null;
  }, [receipt]);

  /**
   * A request from the pump to be run again once its backoff has elapsed.
   *
   * Without this, `backoffMs` was decorative: the only things that ever
   * re-invoked a flush were `online`, a fresh capture, and the 15-second safety
   * tick, so *every* transient failure — a re-mintable receipt collision, a
   * single dropped request — waited up to fifteen seconds instead of the one
   * second it had earned. The badge stayed lit long after the cause had passed,
   * which is exactly the behaviour that teaches an owner not to trust it.
   *
   * Carried as state with a timestamp rather than a bare delay, so two
   * consecutive requests for the same delay are still distinct and the effect
   * below re-arms for each.
   */
  const [retryRequest, setRetryRequest] = useState<{ delayMs: number; at: number } | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    if (running.current) {
      return;
    }
    running.current = true;

    try {
      for (;;) {
        const pending = await pendingRecords(tenantId);
        setUnsyncedCount(pending.length);
        setStuck(pending.some((entry) => entry.record.attempts >= STUCK_AFTER_ATTEMPTS));

        const head = pending[0];
        if (
          !head ||
          !readyToFlush(true, consecutiveFailures.current, lastAttemptAt.current, Date.now())
        ) {
          return;
        }

        const batch = pending.slice(0, BATCH_SIZE);
        lastAttemptAt.current = Date.now();

        let report: Awaited<ReturnType<typeof deliverRecords>>;
        try {
          report = await deliverRecords(batch.map((entry) => deliverable(entry.record)));
        } catch {
          // Offline, or the server is unreachable. Precisely the case this
          // whole module exists for, so it is not an error — it is a wait.
          consecutiveFailures.current += 1;
          await markAttempted(head.sequence, 'unreachable');
          return;
        }

        if (!report.ok) {
          consecutiveFailures.current += 1;
          await markAttempted(head.sequence, report.message);
          return;
        }

        // The server answered, so whatever the per-record verdicts are, the
        // network is not the problem any more.
        consecutiveFailures.current = 0;

        let progressed = false;
        for (const outcome of report.outcomes) {
          const entry = batch.find((candidate) => candidate.record.id === outcome.id);
          if (!entry) {
            continue;
          }

          if (outcome.status === 'synced') {
            await removeRecord(entry.sequence);
            progressed = true;
            continue;
          }

          if (outcome.status === 'receipt_taken') {
            const mint = mintReceiptNumber.current;
            if (mint) {
              await replaceRecord(entry.sequence, withReceiptNumber(entry.record, mint()));
              progressed = true;
            } else {
              // The receipt context has not loaded yet, so there is no counter
              // to draw the next number from. Counted as a failure so the
              // retry is on the short backoff rather than falling through to
              // the safety tick.
              consecutiveFailures.current += 1;
            }
            await markAttempted(entry.sequence, 'receipt_taken');
            continue;
          }

          // `retry` waits; `rejected` is kept and surfaced rather than dropped,
          // because a record that already printed a receipt and cannot be
          // stored is something a person has to see, never something to lose.
          await markAttempted(entry.sequence, outcome.reason);
        }

        if (!progressed) {
          return;
        }
      }
    } finally {
      running.current = false;

      // Anything still queued gets a retry at the delay it actually earned,
      // rather than waiting for the next safety tick.
      const remaining = await pendingRecords(tenantId);
      setUnsyncedCount(remaining.length);
      setRetryRequest(
        remaining.length > 0
          ? { delayMs: backoffMs(consecutiveFailures.current), at: Date.now() }
          : null,
      );
    }
  }, [tenantId]);

  useEffect(() => {
    if (!retryRequest) {
      return;
    }
    const timer = window.setTimeout(() => {
      void flush();
    }, Math.max(250, retryRequest.delayMs));
    return () => {
      window.clearTimeout(timer);
    };
  }, [retryRequest, flush]);

  const flushNow = useCallback(() => {
    void flush();
  }, [flush]);

  const capture = useCallback(
    async (record: CapturedRecord): Promise<void> => {
      // Throws if the outbox will not take it — the caller must not print a
      // receipt for a sale that is not durable.
      await enqueue(tenantId, record);
      setUnsyncedCount((current) => current + 1);
      void flush();
    },
    [tenantId, flush],
  );

  useEffect(() => {
    void flush();

    const onOnline = () => {
      // A reconnect clears the backoff entirely — both the timer and the
      // failure count that set its length. The condition the wait existed for
      // is gone, so the queue drains at once rather than serving out a delay
      // earned while the network was down.
      lastAttemptAt.current = null;
      consecutiveFailures.current = 0;
      void flush();
    };
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => {
      void flush();
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [flush]);

  const value = useMemo<SyncContextValue>(
    () => ({ capture, unsyncedCount, stuck, flushNow }),
    [capture, unsyncedCount, stuck, flushNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
