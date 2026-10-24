'use server';

/**
 * The sync delivery endpoint — ADR-3.
 *
 * Thin, like every other action: it establishes who is acting, converts the
 * wire shape into domain commands, and hands the batch to `ingestBatch`. The
 * two conversions that live here are boundary concerns and belong nowhere
 * else — ISO strings become `Date`s, and the client's captured records become
 * the same command types an online commit uses.
 *
 * Deliberately not owner-gated, for the same reason `commitCashSale` is not:
 * selling is the salesman's job, and a batch arriving after a disruption is
 * just the sales they already made.
 */

import { currentSession, scopeFor } from '@/auth/session';
import { ingestBatch, type IngestibleRecord, type IngestOutcome } from '@/domain/sync/ingest';
import type { CapturedRecord } from '@/client/sync/records';

/** Phase 12 §2.6 / defect C4: stamped at the boundary that knows the version. */
const CLIENT_SCHEMA_VERSION = 1;

/**
 * [PCN-012] Record version 2: sale lines carry the unit entered, its count and
 * its price. Read from the record rather than assumed, because a sale captured
 * before an update can sit in the outbox and arrive after it — and it must be
 * recorded as the version it is (ADR-3 accepts version 1 for a release).
 */
const UNIT_PRICED_SALE_VERSION = 2;

function saleRecordVersion(lines: readonly { unitCount?: number }[]): number {
  return lines.some((line) => line.unitCount !== undefined)
    ? UNIT_PRICED_SALE_VERSION
    : CLIENT_SCHEMA_VERSION;
}

export interface DeliverableRecord {
  readonly record: CapturedRecord;
  /**
   * Decided by the counter at delivery, not at capture — a sale captured with
   * the server in reach and delivered milliseconds later is not an offline
   * sale, and the daily view would be lying if it said so.
   */
  readonly origin: 'online' | 'offline_sync';
}

export type SyncOutcome =
  | { ok: true; outcomes: IngestOutcome[]; complete: boolean }
  | { ok: false; message: string; fatal: boolean };

function toCommand(item: DeliverableRecord): IngestibleRecord {
  const { record, origin } = item;

  switch (record.kind) {
    case 'sale':
      return {
        kind: 'sale',
        command: {
          ...record.payload,
          origin,
          clientSchemaVersion: saleRecordVersion(record.payload.lines),
          clientCommittedAt: new Date(record.payload.clientCommittedAt),
        },
      };
    case 'settlement':
      return {
        kind: 'settlement',
        command: {
          ...record.payload,
          origin,
          clientSchemaVersion: CLIENT_SCHEMA_VERSION,
          clientCommittedAt: new Date(record.payload.clientCommittedAt),
        },
      };
    case 'quick_item':
      return { kind: 'quick_item', command: record.payload };
    case 'customer':
      return { kind: 'customer', command: record.payload };
  }
}

export async function deliverRecords(batch: DeliverableRecord[]): Promise<SyncOutcome> {
  const session = await currentSession();
  if (!session) {
    // Fatal for this attempt, not for the records: they stay in the outbox
    // until someone signs the device back in. Losing a captured sale because
    // a cookie expired is not a trade this product makes.
    return { ok: false, message: 'This device needs to sign in again.', fatal: true };
  }
  if (session.tenantSuspended) {
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.', fatal: true };
  }

  const report = await ingestBatch(scopeFor(session), batch.map(toCommand));
  return { ok: true, outcomes: [...report.outcomes], complete: report.complete };
}
