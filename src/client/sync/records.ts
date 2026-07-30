/**
 * The commit contract, shared by both sides — Phase 11 §1.
 *
 *   "`client/sync` and `domain/sales` share the commit contract type so online
 *    and offline are provably the same shape (ADR-5's one code path)."
 *
 * "Provably" is the word that decides the implementation. These payload types
 * are `Omit`s of the real domain command types rather than hand-written copies,
 * so a field added to `SaleCommand` tomorrow becomes a compile error here until
 * the counter supplies it. A parallel interface would drift silently, and the
 * first symptom would be an offline sale that ingests differently from an
 * online one — which is precisely the class of bug ADR-3 exists to make
 * impossible.
 *
 * Three fields are deliberately *not* the counter's to decide, and are stripped:
 *
 *  - `origin` is decided at delivery, not at capture — see `originFor` in
 *    `flush.ts`. A sale captured with the server in reach and delivered
 *    milliseconds later is not an offline sale, and the daily view would be
 *    lying if it said so.
 *  - `clientSchemaVersion` is stamped by the ingestion boundary, which is the
 *    thing that knows what version it speaks (Phase 12 §2.6 / defect C4).
 *  - `clientCommittedAt` survives as an ISO string rather than a `Date`,
 *    because it crosses IndexedDB and a server-action boundary; the one
 *    conversion happens server-side, exactly as `sale/actions.ts` already does.
 *
 * The type-only imports below are erased at compile time, so nothing
 * server-only reaches the browser bundle.
 */

import type { SaleCommand } from '@/domain/sales/sale-command';
import type { SettlementCommand } from '@/domain/udhaar/commit-settlement';

/** Everything the counter decides; delivery decides the rest. */
type Captured<T> = Omit<T, 'origin' | 'clientSchemaVersion' | 'clientCommittedAt'> & {
  readonly clientCommittedAt: string;
};

export type CapturedSale = Captured<SaleCommand>;
export type CapturedSettlement = Captured<SettlementCommand>;

/**
 * W6's quick item. Not an `Omit` of a command type because `createQuickItem`
 * takes a plain input rather than a command — but it is the same discipline:
 * a client-minted id, idempotent on that id.
 */
export interface CapturedQuickItem {
  readonly id: string;
  readonly name: string;
  readonly pricePaisa: number;
  readonly baseUnitName: string;
}

/**
 * W2's inline customer create. See `createCustomerWithId` for why a customer
 * is capturable at all: ADR-3 names W2, and W2 makes inline create mandatory.
 */
export interface CapturedCustomer {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
}

/**
 * The offline-capturable events of ADR-3, and nothing else.
 *
 *   "…keeps working through disruptions for exactly: cash sales, udhaar sales,
 *    settlements, and quick-item creation (W1–W3, W6). Everything else —
 *    purchases, adjustments, reports, catalog edits — requires a connection and
 *    says so calmly."
 *
 * Cash sales and udhaar sales are one kind here because they are one kind in
 * the domain: a sale with `creditPaisa` zero or not (W1 and W2 differ by the
 * split, never by the writer). `customer` is the one dependency W2 drags in
 * with it, for the reason `createCustomerWithId` documents.
 *
 * Nothing else may be added to this union without a plan change. A purchase or
 * an adjustment appearing here would mean the counter had started deciding
 * stock arithmetic locally, which ADR-5 forbids.
 */
export type CapturedRecord =
  | { readonly kind: 'sale'; readonly payload: CapturedSale }
  | { readonly kind: 'settlement'; readonly payload: CapturedSettlement }
  | { readonly kind: 'quick_item'; readonly payload: CapturedQuickItem }
  | { readonly kind: 'customer'; readonly payload: CapturedCustomer };

export type RecordKind = CapturedRecord['kind'];

/** A record as the outbox holds it. */
export type OutboxRecord = CapturedRecord & {
  /**
   * The client-generated domain id — sale id, payment id, customer id, or
   * product id. Simultaneously the outbox's unique index and the server's
   * idempotency key, which is what makes replay safe by construction rather
   * than by bookkeeping.
   */
  readonly id: string;
  readonly tenantId: string;
  readonly queuedAt: string;
  /** `navigator.onLine` at capture — one half of the `origin` decision. */
  readonly capturedOffline: boolean;
  readonly attempts: number;
  readonly lastError?: string;
};

/**
 * A queued record with the position IndexedDB gave it.
 *
 * The sequence is the store's auto-increment key rather than a timestamp,
 * because the flush order is load-bearing — a quick item must deliver before
 * the sale whose line references it — and two records captured in the same
 * millisecond would tie on a clock.
 */
export interface StoredRecord {
  readonly sequence: number;
  readonly record: OutboxRecord;
}

/** The id a record carries into the domain, whatever kind it is. */
export function recordId(record: CapturedRecord): string {
  switch (record.kind) {
    case 'sale':
      return record.payload.saleId;
    case 'settlement':
      return record.payload.paymentId;
    case 'quick_item':
    case 'customer':
      return record.payload.id;
  }
}
