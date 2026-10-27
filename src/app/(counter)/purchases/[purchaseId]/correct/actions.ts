'use server';

/**
 * [PCN-009] Correcting a received invoice and sending goods back — owner-only.
 *
 * Thin, like every action file. Licence-gated like the acts they resemble: a
 * correction changes what was received (`receive_stock`), a return to the
 * supplier takes stock out (`adjust_stock`). Online-only (ADR-3 keeps the
 * outbox to the selling events), and the screen says so.
 */

import { requireCapability } from '@/auth/capabilities';
import { currentSession, scopeFor } from '@/auth/session';
import { commitPurchaseCorrection } from '@/domain/purchases/commit-purchase-correction';
import type { CorrectionRejection } from '@/domain/purchases/purchase-correction';
import { commitSupplierReturn } from '@/domain/suppliers/commit-supplier-return';
import type { SupplierReturnRejection } from '@/domain/suppliers/supplier-return';
import type { Uuid } from '@/lib/uuid';

import { revalidateAfter } from '../../../revalidate';

export type CorrectionOutcome = { ok: true } | { ok: false; message: string };

/** I5 — say what to do next, in plain words. */
function correctionMessage(reason: CorrectionRejection | 'unknown_line'): string {
  switch (reason) {
    case 'no_change':
      return 'Nothing changed — the line already says that.';
    case 'note_required':
      return 'Say why, in a few words — a correction without a reason is an edit.';
    case 'invalid_quantity':
      return 'Quantities must be whole numbers, zero or more.';
    case 'negative_cost':
      return 'The cost cannot be negative.';
    case 'more_than_on_hand':
      return 'Some of these units have already been sold or moved, so they cannot be taken off this invoice. Record a count correction on the Adjust screen instead.';
    case 'unknown_line':
      return 'That line could not be found. Reload the invoice and try again.';
  }
}

function returnMessage(reason: SupplierReturnRejection | 'unknown_batch'): string {
  switch (reason) {
    case 'invalid_quantity':
      return 'Enter how many units are going back, as a whole number.';
    case 'negative_credit':
      return 'The credit cannot be negative.';
    case 'more_than_on_hand':
      return 'This batch does not hold that many units now.';
    case 'no_supplier':
      return 'This invoice has no supplier, so there is no one to credit. Record a distributor-return adjustment on the Adjust screen instead.';
    case 'unknown_batch':
      return 'That batch could not be found. Reload the invoice and try again.';
  }
}

export async function correctPurchaseLineAction(input: {
  /** Minted by the screen when the form opens, so a double submit commits once. */
  correctionId: Uuid;
  purchaseLineId: string;
  qtyBase: number;
  bonusQtyBase: number;
  unitCostPaisa: number;
  note: string;
}): Promise<CorrectionOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.userRole !== 'owner') {
    return { ok: false, message: 'Only the owner can correct an invoice.' };
  }
  const gate = requireCapability(session, 'receive_stock');
  if (!gate.ok) {
    return { ok: false, message: gate.message };
  }

  const result = await commitPurchaseCorrection(scopeFor(session), {
    correctionId: input.correctionId,
    purchaseLineId: input.purchaseLineId,
    qtyBase: input.qtyBase,
    bonusQtyBase: input.bonusQtyBase,
    unitCostPaisa: input.unitCostPaisa,
    note: input.note,
  });
  if (!result.ok) {
    return { ok: false, message: correctionMessage(result.reason) };
  }
  revalidateAfter('purchases', 'stock');
  return { ok: true };
}

export async function returnToSupplierAction(input: {
  /** Minted by the screen when the form opens, so a double submit commits once. */
  returnId: Uuid;
  batchId: string;
  qtyBase: number;
  creditPaisa: number;
  note: string;
  entered?: { unitKey: string; unitName: string; unitCount: number };
}): Promise<CorrectionOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.userRole !== 'owner') {
    return { ok: false, message: 'Only the owner can return goods to a supplier.' };
  }
  const gate = requireCapability(session, 'adjust_stock');
  if (!gate.ok) {
    return { ok: false, message: gate.message };
  }

  const result = await commitSupplierReturn(scopeFor(session), {
    returnId: input.returnId,
    batchId: input.batchId,
    qtyBase: input.qtyBase,
    creditPaisa: input.creditPaisa,
    note: input.note.trim() === '' ? null : input.note,
    ...(input.entered ? { entered: input.entered } : {}),
  });
  if (!result.ok) {
    return { ok: false, message: returnMessage(result.reason) };
  }
  revalidateAfter('purchases', 'stock');
  return { ok: true };
}
