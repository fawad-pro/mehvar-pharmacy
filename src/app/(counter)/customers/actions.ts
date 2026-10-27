'use server';

/**
 * Customer actions — thin wrappers (same posture as `sale/actions.ts`).
 *
 * Creating a customer and settling a balance are both offline-capturable
 * (ADR-3), so they go through the outbox and land at `sync/actions.ts`
 * instead; the screens read their own data server-side. What is left is the
 * type-ahead, which genuinely needs the server because it searches the whole
 * customer book rather than a cached slice, and (PCN-013) the corrections,
 * which are not outbox records: they need the server's current balance.
 *
 * Every export in a `'use server'` file is a callable endpoint, so the ones the
 * queue replaced were deleted rather than left behind.
 */

import { requireCapability } from '@/auth/capabilities';
import { currentSession, scopeFor } from '@/auth/session';
import { keyFor } from '@/client/keyboard/registry';
import { searchCustomers } from '@/db/udhaar-queries';
import { REVERSAL_REFUSAL_MESSAGES } from '@/domain/corrections/reversal';
import { commitPaymentReversal } from '@/domain/udhaar/commit-payment-reversal';
import { positionOf } from '@/domain/udhaar/position';
import type { MiniStatement } from '@/domain/udhaar/settlement';
import { editCustomer, removeCustomer, restoreCustomer } from '@/domain/udhaar/writers';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { revalidateAfter } from '../revalidate';

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}

export async function searchCustomersAction(term: string): Promise<CustomerHit[]> {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  return searchCustomers(scopeFor(session), term);
}

export type CorrectionOutcome = { ok: true } | { ok: false; message: string };

/**
 * Anyone at the counter may fix a typed name or phone: customers are created
 * mid-rush by salesmen, and the owner is often not there to correct them.
 */
async function requireCustomerEditing() {
  const session = await currentSession();
  if (!session) {
    return { error: 'This device needs to sign in again.' } as const;
  }
  const licensed = requireCapability(session, 'manage_customer');
  if (!licensed.ok) return { error: licensed.message } as const;
  return { session } as const;
}

/** Removing takes a customer out of the book, so it is the owner's call. */
async function requireCustomerRemoval() {
  const gate = await requireCustomerEditing();
  if ('error' in gate) return gate;
  if (gate.session.userRole !== 'owner') {
    return {
      error: `Only the owner can remove a customer. Press ${keyFor('switch-user')} to switch user.`,
    } as const;
  }
  return gate;
}

export async function editCustomerAction(
  customerId: Uuid,
  draft: { name: string; phone: string },
): Promise<CorrectionOutcome> {
  const gate = await requireCustomerEditing();
  if ('error' in gate) return { ok: false, message: gate.error };

  const result = await editCustomer(scopeFor(gate.session), customerId, {
    name: draft.name,
    phone: draft.phone,
  });
  if (!result.ok) {
    if ('refusal' in result) return { ok: false, message: 'That customer no longer exists.' };
    return {
      ok: false,
      message: result.rejections.some((r) => r.reason === 'name_required')
        ? 'A name is needed.'
        : 'That phone number does not look right — digits, spaces, + and - only.',
    };
  }
  revalidateAfter('customers', 'receipts');
  return { ok: true };
}

export async function removeCustomerAction(customerId: Uuid): Promise<CorrectionOutcome> {
  const gate = await requireCustomerRemoval();
  if ('error' in gate) return { ok: false, message: gate.error };

  const result = await removeCustomer(scopeFor(gate.session), customerId);
  if (!result.ok) {
    if (result.refusal === 'not_found') {
      return { ok: false, message: 'That customer no longer exists.' };
    }
    const position = positionOf(result.balancePaisa);
    const amount = formatPaisa(paisa(position.amountPaisa), { withSymbol: true });
    return {
      ok: false,
      message:
        position.kind === 'owes'
          ? `They still owe ${amount}. Settle it first.`
          : `They have ${amount} paid in advance. Return it, or use it on a sale, first.`,
    };
  }
  revalidateAfter('customers');
  return { ok: true };
}

export async function restoreCustomerAction(customerId: Uuid): Promise<CorrectionOutcome> {
  const gate = await requireCustomerRemoval();
  if ('error' in gate) return { ok: false, message: gate.error };

  const result = await restoreCustomer(scopeFor(gate.session), customerId);
  if (!result.ok) return { ok: false, message: 'That customer no longer exists.' };
  revalidateAfter('customers');
  return { ok: true };
}

export type CancelPaymentOutcome =
  | {
      ok: true;
      againstReceiptNumber: string;
      statement: MiniStatement;
    }
  | { ok: false; message: string };

/**
 * [PCN-013] Cancels an udhaar payment typed wrong. Owner only: it puts money
 * back onto a customer's debt. Settlement itself is never licence-gated
 * (PCN-006), and neither is undoing one — a wrong balance must always be
 * fixable.
 */
export async function cancelPaymentAction(
  paymentId: Uuid,
  receiptNumber: string,
): Promise<CancelPaymentOutcome> {
  const session = await currentSession();
  if (!session) return { ok: false, message: 'This device needs to sign in again.' };
  const licensed = requireCapability(session, 'settle');
  if (!licensed.ok) return { ok: false, message: licensed.message };
  if (session.userRole !== 'owner') {
    return {
      ok: false,
      message: `Only the owner can cancel a payment. Press ${keyFor('switch-user')} to switch user.`,
    };
  }

  const result = await commitPaymentReversal(scopeFor(session), {
    reversalId: uuidv7(),
    paymentId,
    receiptNumber,
    clientCommittedAt: new Date(),
  });
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === 'part_of_sale'
          ? 'This was paid as part of a sale. Return the sale instead.'
          : REVERSAL_REFUSAL_MESSAGES[result.reason],
    };
  }
  revalidateAfter('customers', 'money', 'receipts');
  return {
    ok: true,
    againstReceiptNumber: result.value.againstReceiptNumber,
    statement: result.value.statement,
  };
}
