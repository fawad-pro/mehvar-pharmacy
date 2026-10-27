/**
 * Customer writers — creation on the W2 inline path, and (PCN-013) the
 * corrections: fixing a typed name or phone, and removing a customer added by
 * mistake.
 *
 *   "New-customer-inline is mandatory: udhaar is extended mid-rush, not
 *    pre-registered."
 */

import { customerBalance, findCustomer, insertCustomer, updateCustomer } from '@/db/udhaar-queries';
import type { TenantScope } from '@/db/scoped';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { validateCustomerDraft, type CustomerDraft, type CustomerRejection } from './customer';

export type CreateCustomerResult =
  | { ok: true; value: { id: Uuid } }
  | { ok: false; rejections: CustomerRejection[] };

export async function createCustomer(
  scope: TenantScope,
  draft: CustomerDraft,
): Promise<CreateCustomerResult> {
  return createCustomerWithId(scope, uuidv7(), draft);
}

/**
 * The same create, with the identity supplied by the counter.
 *
 * ADR-3 makes udhaar sales (W2) offline-capturable, and W2's own path makes
 * inline customer creation *mandatory* — "udhaar is extended mid-rush, not
 * pre-registered." A new customer during a disruption is therefore not an
 * expansion of ADR-3's scope but a part of the workflow it names: refusing it
 * would put a wall in the middle of W2, which P2 forbids outright.
 *
 * So the customer gets the same treatment a quick item does: the counter mints
 * the id, and creation is idempotent on it, because sync may deliver the same
 * new customer twice and delivery is the only thing allowed to repeat.
 */
export async function createCustomerWithId(
  scope: TenantScope,
  id: Uuid,
  draft: CustomerDraft,
): Promise<CreateCustomerResult> {
  const existing = await findCustomer(scope, id);
  if (existing) {
    return { ok: true, value: { id } };
  }

  const validated = validateCustomerDraft(draft);
  if (!validated.ok) {
    return validated;
  }

  await insertCustomer(scope, { id, name: validated.value.name, phone: validated.value.phone });
  return { ok: true, value: { id } };
}

export type EditCustomerResult =
  | { ok: true }
  | { ok: false; rejections: CustomerRejection[] }
  | { ok: false; refusal: 'not_found' };

/**
 * [PCN-013] Fixes a typed name or phone. Identity only (Phase 9 §1): every
 * sale, payment and return keeps pointing at the same customer, so the
 * balance and its ledger do not move.
 */
export async function editCustomer(
  scope: TenantScope,
  customerId: Uuid,
  draft: CustomerDraft,
): Promise<EditCustomerResult> {
  if (!(await findCustomer(scope, customerId))) {
    return { ok: false, refusal: 'not_found' };
  }
  const validated = validateCustomerDraft(draft);
  if (!validated.ok) {
    return validated;
  }
  await updateCustomer(scope, customerId, validated.value);
  return { ok: true };
}

export type RemoveCustomerResult =
  | { ok: true }
  | { ok: false; refusal: 'not_found' }
  /** Owed or in advance: removing would hide money still due one way or the other. */
  | { ok: false; refusal: 'has_balance'; balancePaisa: number };

/**
 * [PCN-013] Removes a customer added by mistake: a soft archive, never a
 * delete, so their history keeps resolving. Refused while the balance is not
 * zero in either direction — a debt, or an advance the shop is holding.
 * Removing a customer already removed changes nothing.
 */
export async function removeCustomer(
  scope: TenantScope,
  customerId: Uuid,
): Promise<RemoveCustomerResult> {
  return scope.transaction(async (tx) => {
    const existing = await findCustomer(tx, customerId);
    if (!existing) {
      return { ok: false, refusal: 'not_found' };
    }
    if (!existing.isActive) {
      return { ok: true };
    }
    const balancePaisa = await customerBalance(tx, customerId);
    if (balancePaisa !== 0) {
      return { ok: false, refusal: 'has_balance', balancePaisa };
    }
    await updateCustomer(tx, customerId, { isActive: false });
    return { ok: true };
  });
}

/** [PCN-013] Puts a removed customer back in the picker. */
export async function restoreCustomer(
  scope: TenantScope,
  customerId: Uuid,
): Promise<{ ok: true } | { ok: false; refusal: 'not_found' }> {
  if (!(await findCustomer(scope, customerId))) {
    return { ok: false, refusal: 'not_found' };
  }
  await updateCustomer(scope, customerId, { isActive: true });
  return { ok: true };
}
