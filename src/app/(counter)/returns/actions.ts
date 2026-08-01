'use server';

/**
 * Return actions — W4.
 *
 * Not offline-capturable, same posture as purchases and adjustments: ADR-3
 * scopes the outbox to cash sales, udhaar sales, settlements and quick items.
 * A return needs to look up the sale it responds to and how much of it
 * remains returnable — a lookup a disconnected counter cannot answer
 * honestly — so it says the calm "needs internet" sentence instead.
 */

import { currentSession, scopeFor } from '@/auth/session';
import {
  commitReturn,
  type ReturnCommand,
  type ReturnRejection,
} from '@/domain/sales/commit-return';
import type { FoundSale, ReturnableLineRow } from '@/domain/sales/return-command';
import { findSaleForReturn, returnableLinesForSale } from '@/db/returns-queries';

// `FoundSale` and `ReturnableLineRow` are not re-exported here — a type-only
// re-export inside a `'use server'` file does not survive Next's
// server-actions transform (CLAUDE.md, Day 4 and Day 6). The screen imports
// them straight from `@/domain/sales/return-command`, the same pure module
// that already owns their sibling `ReturnableSaleLine`.

export async function findSaleForReturnAction(query: string): Promise<FoundSale[]> {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  return findSaleForReturn(scopeFor(session), query);
}

export async function returnableLinesAction(saleId: string): Promise<ReturnableLineRow[]> {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  return returnableLinesForSale(scopeFor(session), saleId);
}

export type ReturnOutcome =
  | {
      ok: true;
      totalRefundPaisa: number;
      cashOutPaisa: number;
      creditReducedPaisa: number;
      balanceBeforePaisa?: number;
    }
  | { ok: false; message: string };

/** I5 — name the fix, not the rule. */
function messageFor(reason: ReturnRejection | 'sale_not_found'): string {
  switch (reason) {
    case 'empty_return':
      return 'Select at least one line to return.';
    case 'invalid_quantity':
      return 'Enter how many units are being returned.';
    case 'exceeds_sold_quantity':
      return 'That is more than remains returnable on this line.';
    case 'credit_requires_customer':
      return 'This sale has no customer to credit — refund cash instead.';
    case 'sale_not_found':
      return 'Could not find that sale.';
    default:
      return 'That did not save. Try again.';
  }
}

export async function commitReturnAction(command: ReturnCommand): Promise<ReturnOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.tenantSuspended) {
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.' };
  }

  const result = await commitReturn(scopeFor(session), command);
  if (!result.ok) {
    return { ok: false, message: messageFor(result.reason) };
  }

  return {
    ok: true,
    totalRefundPaisa: result.value.totalRefundPaisa,
    cashOutPaisa: result.value.cashOutPaisa,
    creditReducedPaisa: result.value.creditReducedPaisa,
    ...(result.value.balanceBeforePaisa !== undefined
      ? { balanceBeforePaisa: result.value.balanceBeforePaisa }
      : {}),
  };
}
