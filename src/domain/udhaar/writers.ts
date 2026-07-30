/**
 * Customer creation — the W2 inline path.
 *
 *   "New-customer-inline is mandatory: udhaar is extended mid-rush, not
 *    pre-registered."
 */

import { findCustomer, insertCustomer } from '@/db/udhaar-queries';
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
