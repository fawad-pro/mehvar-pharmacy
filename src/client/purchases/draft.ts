'use client';

/**
 * The purchase draft — W7's "interruptible and resumable".
 *
 *   "Trigger: distributor delivery with invoice; entered between customers,
 *    interruptible and resumable (**a rush must not lose a half-entered
 *    invoice**)."
 *
 * Phase 10 §2 calls this "the only draft state in the product", and the
 * parenthesis above is the whole requirement: a twenty-line invoice is entered
 * in the gaps between customers, so the half-finished thing has to survive
 * pressing F1 to serve someone, and survive the browser being closed.
 *
 * **This is not the sync outbox, and the difference matters.** The outbox holds
 * *committed* events that are waiting to be delivered — a sale that happened.
 * A draft is the opposite: nothing has happened yet, and nothing should. ADR-3
 * deliberately excludes purchases from offline capture, so a draft never syncs,
 * never becomes an event on its own, and disappears the moment it is received.
 * Keeping the two in separate stores keeps that distinction physical rather
 * than a rule someone has to remember.
 *
 * `localStorage` rather than IndexedDB because a draft is small, synchronous
 * reads make resumption instant, and losing one to a cleared profile costs
 * re-typing an invoice rather than losing money — the opposite of the outbox's
 * durability requirement.
 */

import type { PurchaseLineCommand } from '@/domain/purchases/purchase-command';

/** A line as the entry screen holds it, before it is a command. */
export interface DraftLine extends PurchaseLineCommand {
  /** Shown in the table; not part of the command. */
  readonly productName: string;
  readonly baseUnitName: string;
}

export interface PurchaseDraft {
  readonly purchaseId: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly invoiceRef: string;
  readonly invoiceDate: string;
  /**
   * [PCN-006] What the operator typed into "Paid now", verbatim, so a resumed
   * invoice keeps it. Empty/absent means "paid in full" — the field defaults to
   * the invoice total, so an ordinary cash purchase never touches this.
   */
  readonly cashPaidText?: string;
  readonly lines: readonly DraftLine[];
  readonly updatedAt: string;
}

const STORAGE_PREFIX = 'mehvar.purchase-draft.';

function keyFor(tenantId: string): string {
  return `${STORAGE_PREFIX}${tenantId}`;
}

export function readDraft(tenantId: string): PurchaseDraft | null {
  try {
    const raw = window.localStorage.getItem(keyFor(tenantId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PurchaseDraft;
    // A draft with no lines is indistinguishable from no draft, and resuming
    // into an empty form would be a confusing way to say "nothing was saved".
    return parsed.lines.length > 0 ? parsed : null;
  } catch {
    // Corrupt or unavailable storage costs a re-typed invoice, never a sale.
    return null;
  }
}

export function writeDraft(tenantId: string, draft: PurchaseDraft): void {
  try {
    window.localStorage.setItem(keyFor(tenantId), JSON.stringify(draft));
  } catch {
    // Private browsing, a full disk. The entry screen keeps working from
    // memory; only resumption is lost, and P2 has nothing to say about
    // purchases anyway — but nothing here may throw into the UI.
  }
}

export function clearDraft(tenantId: string): void {
  try {
    window.localStorage.removeItem(keyFor(tenantId));
  } catch {
    // Ignored deliberately.
  }
}
