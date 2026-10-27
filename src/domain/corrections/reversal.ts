/**
 * [PCN-013] Whether a recorded payment or cash movement may be reversed.
 *
 * A reversal is a compensating row in the same table as its target (ADR-1,
 * T2): the original stays, marked as cancelled by the row that points at it.
 * The rules are the same for an udhaar payment, a supplier payment and a cash
 * movement, so they are stated once. Pure, so the counter can ask before the
 * server does.
 */

export type ReversalRefusal =
  | 'not_found'
  /** A reversal is not itself reversed: enter the right amount instead. */
  | 'is_reversal'
  | 'already_reversed';

export interface ReversalTarget {
  readonly reversesId: string | null;
}

export function reversalRefusal(
  target: ReversalTarget | undefined,
  existingReversal: unknown,
): ReversalRefusal | null {
  if (!target) return 'not_found';
  if (target.reversesId !== null) return 'is_reversal';
  if (existingReversal) return 'already_reversed';
  return null;
}

/** I5: what to do, not the rule that refused. */
export const REVERSAL_REFUSAL_MESSAGES: Readonly<Record<ReversalRefusal, string>> = {
  not_found: 'That entry no longer exists.',
  is_reversal:
    'This entry is itself a cancellation. Record the right amount as a new entry instead.',
  already_reversed: 'This was already cancelled.',
};
