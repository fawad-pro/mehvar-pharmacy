/**
 * Sync ingestion — ADR-3's delivery boundary, ADR-5's one code path.
 *
 *   "…commit locally (IndexedDB, client-generated IDs) and sync automatically
 *    on reconnect, idempotently."
 *   "Server-side allocation makes offline sales and online sales identical at
 *    ingestion — one code path, one invariant set."
 *
 * This module deliberately contains no business rules. It routes each delivered
 * record to the writer that already owns it — `commitSale`, `commitSettlement`,
 * `createQuickItem` — and translates the outcome into an instruction for the
 * counter's outbox. If a rule ever appears here, an offline sale has started
 * meaning something different from an online one, and ADR-5 has been broken.
 *
 * Idempotency is not implemented here either. It is a property the writers
 * already have, because every one of them keys on a client-generated id
 * (Phase 9 §3): delivery may repeat, effects never do. Replaying a batch N
 * times is therefore exactly-once by construction rather than by bookkeeping,
 * which is what Phase 11 §3.3 asserts.
 *
 * ## Why the batch stops at the first failure
 *
 * Records deliver in the order they were captured, and that order is load-
 * bearing: a quick item (W6) must exist before the sale whose line references
 * it. Continuing past a failure would attempt a sale whose product is still
 * sitting in the outbox — a foreign-key error that looks like corruption and
 * is really just delivery out of order. So the batch reports what landed and
 * stops; the counter retries from there.
 *
 * Each record owns its own transaction (Phase 11 §2), because a batch is a
 * delivery convenience and never a unit of atomicity. Five sales delivered
 * together are five transactions, and the first three staying committed when
 * the fourth fails is the correct outcome for append-only records.
 */

import { isUniqueViolation } from '@/db/errors';
import type { TenantScope } from '@/db/scoped';
import { createQuickItem } from '@/domain/catalog/writers';
import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { commitSettlement, type SettlementCommand } from '@/domain/udhaar/commit-settlement';
import { createCustomerWithId } from '@/domain/udhaar/writers';
import type { Uuid } from '@/lib/uuid';

export interface QuickItemCommand {
  readonly id: Uuid;
  readonly name: string;
  readonly pricePaisa: number;
  readonly baseUnitName: string;
  /** The scanned code, when added from an unknown scan. Absent on older records. */
  readonly barcode?: string | null;
}

export interface CustomerCommand {
  readonly id: Uuid;
  readonly name: string;
  readonly phone: string | null;
}

export type IngestibleRecord =
  | { readonly kind: 'sale'; readonly command: SaleCommand }
  | { readonly kind: 'settlement'; readonly command: SettlementCommand }
  | { readonly kind: 'quick_item'; readonly command: QuickItemCommand }
  | { readonly kind: 'customer'; readonly command: CustomerCommand };

/**
 * What the counter should do with the record it just delivered.
 *
 *  - `synced`        — it landed (or was already there). Drop it from the outbox.
 *  - `receipt_taken` — the number collided, which means two devices share a
 *                      prefix or a backup was restored. Re-mint and retry; the
 *                      sale itself is fine.
 *  - `rejected`      — the domain refused it. Kept, never discarded: a record
 *                      that printed a receipt and cannot be stored is something
 *                      a person has to see (T1), not something to quietly lose.
 *  - `retry`         — transient. Wait and try again.
 */
export type IngestStatus = 'synced' | 'receipt_taken' | 'rejected' | 'retry';

export interface IngestOutcome {
  readonly id: string;
  readonly status: IngestStatus;
  readonly reason?: string;
}

export interface IngestReport {
  readonly outcomes: readonly IngestOutcome[];
  /** True when every delivered record landed; the outbox is then empty. */
  readonly complete: boolean;
}

function idOf(record: IngestibleRecord): string {
  switch (record.kind) {
    case 'sale':
      return record.command.saleId;
    case 'settlement':
      return record.command.paymentId;
    case 'quick_item':
    case 'customer':
      return record.command.id;
  }
}

async function ingestOne(
  scope: TenantScope,
  record: IngestibleRecord,
): Promise<IngestOutcome> {
  const id = idOf(record);

  try {
    switch (record.kind) {
      case 'sale': {
        const result = await commitSale(scope, record.command);
        return result.ok
          ? { id, status: 'synced' }
          : // `stale_batch_state` is the one rejection worth retrying: it means
            // a concurrent commit moved a batch under a locked read, which the
            // next attempt resolves. Everything else is a data problem.
            {
              id,
              status: result.reason === 'stale_batch_state' ? 'retry' : 'rejected',
              reason: result.reason,
            };
      }
      case 'settlement': {
        const result = await commitSettlement(scope, record.command);
        return result.ok ? { id, status: 'synced' } : { id, status: 'rejected', reason: result.reason };
      }
      case 'quick_item': {
        const result = await createQuickItem(scope, record.command);
        return result.ok
          ? { id, status: 'synced' }
          : {
              id,
              status: 'rejected',
              reason: 'rejections' in result ? 'invalid_product' : result.conflict,
            };
      }
      case 'customer': {
        const result = await createCustomerWithId(scope, record.command.id, {
          name: record.command.name,
          phone: record.command.phone,
        });
        return result.ok ? { id, status: 'synced' } : { id, status: 'rejected', reason: 'invalid_customer' };
      }
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { id, status: 'receipt_taken' };
    }
    // Unreachable database, a closed pool, a bug. None of these are the
    // record's fault, so none of them lose it.
    return { id, status: 'retry', reason: 'unavailable' };
  }
}

export async function ingestBatch(
  scope: TenantScope,
  records: readonly IngestibleRecord[],
): Promise<IngestReport> {
  const outcomes: IngestOutcome[] = [];

  for (const record of records) {
    const outcome = await ingestOne(scope, record);
    outcomes.push(outcome);
    if (outcome.status !== 'synced') {
      break;
    }
  }

  return {
    outcomes,
    complete: outcomes.length === records.length && outcomes.every((o) => o.status === 'synced'),
  };
}
