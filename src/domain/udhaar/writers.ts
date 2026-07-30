/**
 * Customer creation — the W2 inline path.
 *
 *   "New-customer-inline is mandatory: udhaar is extended mid-rush, not
 *    pre-registered."
 */

import { insertCustomer } from '@/db/udhaar-queries';
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
  const validated = validateCustomerDraft(draft);
  if (!validated.ok) {
    return validated;
  }

  const id = uuidv7();
  await insertCustomer(scope, { id, name: validated.value.name, phone: validated.value.phone });
  return { ok: true, value: { id } };
}
