'use server';

/**
 * Purchase and supplier actions — thin, like every other action file.
 *
 * Not offline-capturable: ADR-3 scopes the outbox to the four selling events
 * and names purchases among the things that "require a connection and say so
 * calmly". The screen says exactly that when the network is gone; the draft
 * survives regardless, which is what W7's "interruptible and resumable"
 * actually needs.
 */

import { currentSession, scopeFor } from '@/auth/session';
import {
  commitPurchase,
  type PurchaseCommand,
  type PurchaseRejection,
} from '@/domain/purchases/commit-purchase';
import { insertSupplier, listPurchases, searchSuppliers } from '@/db/purchase-queries';
import { uuidv7 } from '@/lib/uuid';

export interface SupplierHit {
  id: string;
  name: string;
  phone: string | null;
}

export async function searchSuppliersAction(term: string): Promise<SupplierHit[]> {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  return searchSuppliers(scopeFor(session), term);
}

export async function createSupplierAction(
  name: string,
): Promise<{ ok: true; supplier: SupplierHit } | { ok: false; message: string }> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  const trimmed = name.trim();
  if (trimmed === '') {
    return { ok: false, message: 'A name is needed.' };
  }

  const id = uuidv7();
  await insertSupplier(scopeFor(session), { id, name: trimmed, phone: null });
  return { ok: true, supplier: { id, name: trimmed, phone: null } };
}

export type ReceivePurchaseOutcome =
  | { ok: true; resolvedPendingBase: number; batchCount: number }
  | { ok: false; message: string };

/** I5 — name the fix, not the rule. */
function messageFor(reason: PurchaseRejection): string {
  switch (reason) {
    case 'empty_purchase':
      return 'Add at least one line before receiving.';
    case 'invalid_quantity':
      return 'One of the lines has no quantity.';
    case 'invalid_bonus':
      return 'A bonus quantity cannot be negative.';
    case 'negative_cost':
      return 'A cost cannot be negative.';
    case 'invalid_price':
      return 'Every line needs a selling price.';
    case 'invalid_expiry':
      return 'Check the expiry date — it should look like 2027-06-30.';
    default:
      return 'That did not save. Check the lines and try again.';
  }
}

export async function receivePurchaseAction(
  command: PurchaseCommand,
): Promise<ReceivePurchaseOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.tenantSuspended) {
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.' };
  }

  const result = await commitPurchase(scopeFor(session), command);
  if (!result.ok) {
    return { ok: false, message: messageFor(result.reason) };
  }

  return {
    ok: true,
    resolvedPendingBase: result.value.resolvedPendingBase,
    batchCount: result.value.batchIds.length,
  };
}

export async function recentPurchasesAction() {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  return listPurchases(scopeFor(session));
}
