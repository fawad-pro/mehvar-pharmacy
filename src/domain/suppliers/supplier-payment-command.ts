/**
 * [PCN-006] The supplier-payment command and its rules — pure (Phase 11 §2).
 *
 * The payable mirror of `settlement.ts`: a payment the pharmacy makes to a
 * distributor to reduce what it owes. Kept apart from the writer for the same
 * reason every command is — a client component may validate it, and a module
 * that reaches the database must not enter the browser bundle.
 */

import type { Uuid } from '@/lib/uuid';

export interface SupplierPaymentCommand {
  /** Client-generated. The idempotency key — a flaky submit must not double-pay. */
  readonly paymentId: Uuid;
  readonly supplierId: Uuid;
  readonly amountPaisa: number;
  /** Optional invoice this clears, when the shop pays one rather than an account. */
  readonly purchaseId: Uuid | null;
  readonly note: string | null;
}

export type SupplierPaymentRejection = 'amount_not_positive' | 'supplier_required';

export function validateSupplierPayment(
  command: Pick<SupplierPaymentCommand, 'supplierId' | 'amountPaisa'>,
): { ok: true } | { ok: false; reason: SupplierPaymentRejection } {
  if (!command.supplierId) {
    return { ok: false, reason: 'supplier_required' };
  }
  if (!Number.isSafeInteger(command.amountPaisa) || command.amountPaisa <= 0) {
    return { ok: false, reason: 'amount_not_positive' };
  }
  return { ok: true };
}
