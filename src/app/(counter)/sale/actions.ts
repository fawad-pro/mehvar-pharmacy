'use server';

/**
 * The sale commit action.
 *
 * Thin by design: it establishes who is acting, hands the command to
 * `commitSale`, and translates the typed result. Every rule that matters lives
 * in the domain, where it is tested against a real database.
 *
 * Deliberately *not* owner-gated. Selling is the salesman's job, and Phase 7's
 * cross-cutting rule 2 is explicit: "any workflow the salesman can start, the
 * salesman can finish — no mid-path permission walls. Sensitive acts are visible
 * (T1) rather than blocked." A price override is recorded and surfaced, never
 * refused.
 */

import { currentSession, scopeFor } from '@/auth/session';
import { commitSale, type SaleCommand, type SaleRejection } from '@/domain/sales/commit-sale';
import { highestReceiptCounter } from '@/db/sales-queries';

export interface SaleLineInput {
  lineId: string;
  productId: string;
  qtyBase: number;
  enteredUnitLevel: string;
  unitPricePaisa: number;
  lineDiscountPaisa: number;
  priceOverridden: boolean;
}

export interface CommitSaleInput {
  saleId: string;
  receiptNumber: string;
  lines: SaleLineInput[];
  invoiceDiscountPaisa: number;
  cashPaisa: number;
  changePaisa: number;
  clientCommittedAt: string;
}

export type CommitSaleOutcome =
  | {
      ok: true;
      receiptNumber: string;
      totalPaisa: number;
      /** Base units sold that the system did not have (D2) — surfaced, not hidden. */
      pendingByProduct: Record<string, number>;
      alreadyCommitted: boolean;
    }
  | { ok: false; message: string; retryWithNewReceipt?: boolean };

/** The client schema version stamped on records (Phase 12 §2.6 / defect C4). */
const CLIENT_SCHEMA_VERSION = 1;

function messageFor(reason: SaleRejection): string {
  switch (reason) {
    case 'empty_cart':
      return 'The cart is empty.';
    case 'invalid_quantity':
      return 'One of the lines has no quantity.';
    case 'split_mismatch':
      return 'The cash and credit split does not add up to the total.';
    case 'credit_without_customer':
      return 'Attach a customer before putting anything on udhaar.';
    case 'negative_amount':
      return 'Check the discounts — something came out negative.';
    case 'stale_batch_state':
      return 'Stock changed while this sale was being saved. Try again.';
    default:
      return 'That did not save. Try again.';
  }
}

export async function commitCashSale(input: CommitSaleInput): Promise<CommitSaleOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.tenantSuspended) {
    // Phase 3 §5.3 / Phase 8 §4: suspension gates writes. Export stays open.
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.' };
  }

  const command: SaleCommand = {
    saleId: input.saleId,
    receiptNumber: input.receiptNumber,
    customerId: null,
    lines: input.lines,
    invoiceDiscountPaisa: input.invoiceDiscountPaisa,
    cashPaisa: input.cashPaisa,
    creditPaisa: 0,
    changePaisa: input.changePaisa,
    origin: 'online',
    clientSchemaVersion: CLIENT_SCHEMA_VERSION,
    clientCommittedAt: new Date(input.clientCommittedAt),
  };

  try {
    const result = await commitSale(scopeFor(session), command);
    if (!result.ok) {
      return { ok: false, message: messageFor(result.reason) };
    }
    return {
      ok: true,
      receiptNumber: result.value.receiptNumber,
      totalPaisa: result.value.totalPaisa,
      pendingByProduct: result.value.pendingByProduct,
      alreadyCommitted: result.value.alreadyCommitted,
    };
  } catch (error) {
    // A receipt number already taken means two devices share a prefix or a
    // backup was restored. The operator should see the next receipt, not this.
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        message: 'That receipt number was already used. Saving again with the next one.',
        retryWithNewReceipt: true,
      };
    }
    throw error;
  }
}

/** The server's highest receipt counter for this device, to seed the client. */
export async function receiptCounterHint(): Promise<{ prefix: string; highest: number } | null> {
  const session = await currentSession();
  if (!session?.receiptPrefix) {
    return null;
  }
  return {
    prefix: session.receiptPrefix,
    highest: await highestReceiptCounter(scopeFor(session), session.receiptPrefix),
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: string; cause?: unknown };
    if (candidate.code === '23505') {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
