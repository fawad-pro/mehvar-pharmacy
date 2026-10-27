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

import { requireCapability } from '@/auth/capabilities';
import { currentSession, scopeFor } from '@/auth/session';
import {
  commitPurchase,
  type PurchaseCommand,
  type PurchaseRejection,
} from '@/domain/purchases/commit-purchase';
import {
  commitSupplierPayment,
  type SupplierPaymentRejection,
} from '@/domain/suppliers/commit-supplier-payment';
import { insertSupplier, listPurchases, searchSuppliers } from '@/db/purchase-queries';
import { recordDeliveredMrp } from '@/domain/catalog/writers';
import { supplierPositions, type SupplierPositions } from '@/db/supplier-queries';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { revalidateAfter } from '../revalidate';

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
  revalidateAfter('purchases');
  return { ok: true, supplier: { id, name: trimmed, phone: null } };
}

export type ReceivePurchaseOutcome =
  { ok: true; resolvedPendingBase: number; batchCount: number } | { ok: false; message: string };

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
    case 'negative_cash_paid':
      return 'The amount paid now cannot be negative.';
    case 'credit_without_supplier':
      return 'Choose a supplier before putting an invoice on credit.';
    case 'invalid_unit':
      // The product's packs changed since the line was typed (another counter
      // edited it). Re-adding the line picks up the current pack sizes.
      return 'A line’s pack size no longer matches the product. Remove the line and add it again.';
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
  // [PCN-006] Receiving stock is new business a restricted installation may not
  // do (Profile C). Unlike a sale it is not offline-captured, so the gate lives
  // here on the server action. A restricted install can still settle udhaar,
  // print, export and take catalogue updates; what it loses is restocking.
  const licensed = requireCapability(session, 'receive_stock');
  if (!licensed.ok) {
    return { ok: false, message: licensed.message };
  }

  const result = await commitPurchase(scopeFor(session), command);
  if (!result.ok) {
    return { ok: false, message: messageFor(result.reason) };
  }

  // Stock moved and a batch was created, so the catalog's on-hand figures and
  // the day's exception list are both stale from this instant.
  revalidateAfter('purchases', 'stock');

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

/* -------------------------------------------------------------------------- */
/* [PCN-007] Supplier credit — what the pharmacy owes, and paying it down      */
/* -------------------------------------------------------------------------- */

/** Who is owed and, since PCN-011, who holds the pharmacy's credit. */
export async function supplierPositionsAction(): Promise<SupplierPositions> {
  const session = await currentSession();
  if (!session) {
    return { owed: [], inCredit: [] };
  }
  return supplierPositions(scopeFor(session));
}

function supplierMessageFor(reason: SupplierPaymentRejection): string {
  switch (reason) {
    case 'supplier_required':
      return 'Choose the supplier being paid.';
    case 'amount_not_positive':
      return 'Enter an amount greater than zero.';
    default:
      return 'That did not save. Try again.';
  }
}

export type SettleSupplierOutcome =
  | { ok: true; newBalancePaisa: number }
  | { ok: false; message: string };

export async function settleSupplierAction(input: {
  supplierId: Uuid;
  amountPaisa: number;
  note: string | null;
}): Promise<SettleSupplierOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.tenantSuspended) {
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.' };
  }

  const result = await commitSupplierPayment(scopeFor(session), {
    paymentId: uuidv7(),
    supplierId: input.supplierId,
    amountPaisa: input.amountPaisa,
    purchaseId: null,
    note: input.note,
  });

  if (!result.ok) {
    return { ok: false, message: supplierMessageFor(result.reason) };
  }

  // The payable figure the Day screen and this panel both read is now stale
  // (the 'purchases' area already covers /purchases and /day).
  revalidateAfter('purchases');

  return { ok: true, newBalancePaisa: result.value.newBalancePaisa };
}

/* -------------------------------------------------------------------------- */
/* [PCN-012] A delivery's MRP, offered to the product record                   */
/* -------------------------------------------------------------------------- */

/**
 * Records the MRP on a delivered pack and, when chosen, the unit's new price.
 * The owner's call, like any price change (the product form is owner-only).
 */
export async function recordDeliveredMrpAction(input: {
  productId: Uuid;
  unitKey: string;
  mrpPaisa: number;
  pricePaisa: number | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.userRole !== 'owner') {
    return { ok: false, message: 'Only the owner can change a product’s price or MRP.' };
  }
  const licensed = requireCapability(session, 'author_product');
  if (!licensed.ok) {
    return { ok: false, message: licensed.message };
  }
  const result = await recordDeliveredMrp(scopeFor(session), input.productId, input);
  if (!result.ok) {
    return { ok: false, message: 'That did not save. Check the MRP and price, and try again.' };
  }
  revalidateAfter('catalog');
  return { ok: true };
}
