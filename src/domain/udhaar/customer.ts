/**
 * Customer validation — pure (Phase 11 §2).
 *
 * D-boundary (Phase 5 §2): "A name and a phone number attached to a debt.
 * Exists only to make udhaar recordable." Nothing else is ever asked, which is
 * what makes the W2 inline create fast — "new customer inline with just name +
 * phone, seconds" — and it is enforced here, not just in the UI, so no future
 * screen can quietly grow the form.
 */

export type CustomerRejection = { reason: 'name_required' } | { reason: 'phone_invalid' };

export type Validated<T> = { ok: true; value: T } | { ok: false; rejections: CustomerRejection[] };

export interface CustomerDraft {
  name: string;
  /** Optional — a customer can be udhaar-worthy on a name alone. */
  phone: string | null;
}

/**
 * Loosely validated on purpose: a phone number here is a lookup aid for the
 * type-ahead picker, not a billing contact, so it accepts whatever digits and
 * punctuation a salesman types under pressure rather than enforcing a format.
 */
export function validateCustomerDraft(draft: CustomerDraft): Validated<CustomerDraft> {
  const name = draft.name.trim();
  if (name === '') {
    return { ok: false, rejections: [{ reason: 'name_required' }] };
  }

  const phone = draft.phone?.trim() ?? '';
  if (phone !== '' && !/^[\d\s+\-()]{5,20}$/.test(phone)) {
    return { ok: false, rejections: [{ reason: 'phone_invalid' }] };
  }

  return { ok: true, value: { name, phone: phone === '' ? null : phone } };
}
