/**
 * [PCN-013] Supplier corrections — fixing a typed name or phone, and removing
 * a supplier added by mistake. The same rules as a customer's, for the same
 * reasons: identity only (Phase 9 §1), and never hide an open balance.
 */

import { findSupplier, supplierBalance, updateSupplier } from '@/db/supplier-queries';
import type { TenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

// A supplier is "a name and a phone number" exactly as a customer is, so it is
// checked by the same rules rather than a copy of them.
import {
  validateCustomerDraft as validateSupplierDraft,
  type CustomerDraft as SupplierDraft,
  type CustomerRejection as SupplierRejection,
} from '../udhaar/customer';

export type EditSupplierResult =
  | { ok: true }
  | { ok: false; rejections: SupplierRejection[] }
  | { ok: false; refusal: 'not_found' };

export async function editSupplier(
  scope: TenantScope,
  supplierId: Uuid,
  draft: SupplierDraft,
): Promise<EditSupplierResult> {
  if (!(await findSupplier(scope, supplierId))) {
    return { ok: false, refusal: 'not_found' };
  }
  const validated = validateSupplierDraft(draft);
  if (!validated.ok) {
    return validated;
  }
  await updateSupplier(scope, supplierId, validated.value);
  return { ok: true };
}

export type RemoveSupplierResult =
  | { ok: true }
  | { ok: false; refusal: 'not_found' }
  /** Owed to them, or credit they hold (PCN-011): either is money still due. */
  | { ok: false; refusal: 'has_balance'; balancePaisa: number };

/** Soft archive; refused while the balance is not zero. Idempotent. */
export async function removeSupplier(
  scope: TenantScope,
  supplierId: Uuid,
): Promise<RemoveSupplierResult> {
  return scope.transaction(async (tx) => {
    const existing = await findSupplier(tx, supplierId);
    if (!existing) {
      return { ok: false, refusal: 'not_found' };
    }
    if (!existing.isActive) {
      return { ok: true };
    }
    const balancePaisa = await supplierBalance(tx, supplierId);
    if (balancePaisa !== 0) {
      return { ok: false, refusal: 'has_balance', balancePaisa };
    }
    await updateSupplier(tx, supplierId, { isActive: false });
    return { ok: true };
  });
}

/** Puts a removed supplier back in the Receive Stock picker. */
export async function restoreSupplier(
  scope: TenantScope,
  supplierId: Uuid,
): Promise<{ ok: true } | { ok: false; refusal: 'not_found' }> {
  if (!(await findSupplier(scope, supplierId))) {
    return { ok: false, refusal: 'not_found' };
  }
  await updateSupplier(scope, supplierId, { isActive: true });
  return { ok: true };
}
