/**
 * The cash-movement command and its rules — pure (Phase 11 §2).
 *
 * W10's drawer-count ritual: "the owner counts the drawer against the
 * expected figure; a recorded over/short entry closes the ritual." A cash
 * movement is also how an opening float, an owner's withdrawal, or a small
 * expense out of the till gets recorded — four reason codes, each implying
 * its direction, the same shape `adjustment.ts` uses for stock reasons.
 */

import type { Uuid } from '@/lib/uuid';

export type CashDirection = 'in' | 'out';

export type CashReason = 'opening_float' | 'owner_withdrawal' | 'expense' | 'over_short';

export const CASH_REASONS: readonly CashReason[] = [
  'opening_float',
  'owner_withdrawal',
  'expense',
  'over_short',
] as const;

/** I5 — plain words, no system vocabulary. */
export const CASH_REASON_LABELS: Readonly<Record<CashReason, string>> = {
  opening_float: 'Opening float',
  owner_withdrawal: 'Owner withdrawal',
  expense: 'Expense',
  over_short: 'Over/short at count',
};

/**
 * Every reason has a natural direction; `over_short` is the one exception —
 * the drawer can come up either over or short of what was expected, so its
 * direction is whichever the count actually found, not implied by the reason.
 */
export function directionFor(reason: CashReason): CashDirection | null {
  switch (reason) {
    case 'opening_float':
      return 'in';
    case 'owner_withdrawal':
    case 'expense':
      return 'out';
    case 'over_short':
      return null;
  }
}

export interface CashMovementCommand {
  /** Client-generated. The idempotency key. */
  readonly movementId: Uuid;
  readonly direction: CashDirection;
  readonly amountPaisa: number;
  readonly reason: CashReason;
  readonly note: string | null;
}

export type CashMovementRejection = 'invalid_amount' | 'direction_mismatch';

export function validateCashMovementCommand(
  command: CashMovementCommand,
): { ok: true } | { ok: false; reason: CashMovementRejection } {
  if (!Number.isSafeInteger(command.amountPaisa) || command.amountPaisa <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }
  const implied = directionFor(command.reason);
  if (implied !== null && implied !== command.direction) {
    return { ok: false, reason: 'direction_mismatch' };
  }
  return { ok: true };
}
