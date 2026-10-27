'use server';

/**
 * [PCN-013] Supplier corrections: fix a typed name or phone, remove a
 * supplier added by mistake, restore one. Not outbox records (ADR-3 scopes the
 * outbox to selling) — each needs the server's current balance.
 */

import { requireCapability } from '@/auth/capabilities';
import { currentSession, scopeFor } from '@/auth/session';
import { keyFor } from '@/client/keyboard/registry';
import { REVERSAL_REFUSAL_MESSAGES } from '@/domain/corrections/reversal';
import { commitSupplierPaymentReversal } from '@/domain/suppliers/commit-supplier-payment-reversal';
import { editSupplier, removeSupplier, restoreSupplier } from '@/domain/suppliers/writers';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { revalidateAfter } from '../../revalidate';

export type CorrectionOutcome = { ok: true } | { ok: false; message: string };

/** Whoever receives stock picks suppliers, so whoever receives stock may fix one's name. */
async function requireSupplierEditing() {
  const session = await currentSession();
  if (!session) {
    return { error: 'This device needs to sign in again.' } as const;
  }
  const licensed = requireCapability(session, 'receive_stock');
  if (!licensed.ok) return { error: licensed.message } as const;
  return { session } as const;
}

async function requireSupplierRemoval() {
  const gate = await requireSupplierEditing();
  if ('error' in gate) return gate;
  if (gate.session.userRole !== 'owner') {
    return {
      error: `Only the owner can remove a supplier. Press ${keyFor('switch-user')} to switch user.`,
    } as const;
  }
  return gate;
}

export async function editSupplierAction(
  supplierId: Uuid,
  draft: { name: string; phone: string },
): Promise<CorrectionOutcome> {
  const gate = await requireSupplierEditing();
  if ('error' in gate) return { ok: false, message: gate.error };

  const result = await editSupplier(scopeFor(gate.session), supplierId, {
    name: draft.name,
    phone: draft.phone,
  });
  if (!result.ok) {
    if ('refusal' in result) return { ok: false, message: 'That supplier no longer exists.' };
    return {
      ok: false,
      message: result.rejections.some((r) => r.reason === 'name_required')
        ? 'A name is needed.'
        : 'That phone number does not look right — digits, spaces, + and - only.',
    };
  }
  revalidateAfter('purchases');
  return { ok: true };
}

export async function removeSupplierAction(supplierId: Uuid): Promise<CorrectionOutcome> {
  const gate = await requireSupplierRemoval();
  if ('error' in gate) return { ok: false, message: gate.error };

  const result = await removeSupplier(scopeFor(gate.session), supplierId);
  if (!result.ok) {
    if (result.refusal === 'not_found') {
      return { ok: false, message: 'That supplier no longer exists.' };
    }
    const amount = formatPaisa(paisa(Math.abs(result.balancePaisa)), { withSymbol: true });
    return {
      ok: false,
      message:
        result.balancePaisa > 0
          ? `You still owe them ${amount}. Pay it first.`
          : `They hold ${amount} of your credit. Settle it first.`,
    };
  }
  revalidateAfter('purchases');
  return { ok: true };
}

export async function restoreSupplierAction(supplierId: Uuid): Promise<CorrectionOutcome> {
  const gate = await requireSupplierRemoval();
  if ('error' in gate) return { ok: false, message: gate.error };

  const result = await restoreSupplier(scopeFor(gate.session), supplierId);
  if (!result.ok) return { ok: false, message: 'That supplier no longer exists.' };
  revalidateAfter('purchases');
  return { ok: true };
}

/** [PCN-013] Cancels a supplier payment typed wrong. Owner only. */
export async function cancelSupplierPaymentAction(paymentId: Uuid): Promise<CorrectionOutcome> {
  const gate = await requireSupplierRemoval();
  if ('error' in gate) return { ok: false, message: gate.error };

  const result = await commitSupplierPaymentReversal(scopeFor(gate.session), {
    reversalId: uuidv7(),
    paymentId,
  });
  if (!result.ok) return { ok: false, message: REVERSAL_REFUSAL_MESSAGES[result.reason] };
  revalidateAfter('purchases');
  return { ok: true };
}
