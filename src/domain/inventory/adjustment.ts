/**
 * Adjustment rules — W8, W9, pure (Phase 11 §2).
 *
 * An adjustment is how stock changes for any reason that is not a sale and not
 * a purchase: damage, expiry write-off, a return to the distributor, a count
 * correction, and the opening stock a shop starts with.
 *
 * The reason code is not metadata. Phase 9 §5.4 makes **signed-delta reason
 * consistency** a database CHECK, and this module is the same rule stated
 * where a person can act on it — because a constraint violation arriving at a
 * counter is an error message nobody can do anything with (the same posture
 * `validateSaleCommand` takes).
 *
 * Why each reason has the sign it does:
 *
 *  - `damage`, `expiry_writeoff`, `distributor_return` — stock leaving for a
 *    reason that is not a sale. Always negative; a positive "damage" is
 *    somebody reaching for the wrong word.
 *  - `opening_stock` — the shop's starting position (W9). Only ever adds.
 *  - `count_correction` — the shelf disagreed with the system. Either
 *    direction, because either direction happens, and a correction that could
 *    only go one way would quietly bias every count toward it.
 */

/**
 * What a reducing adjustment picks from.
 *
 * This lives here rather than beside the query that reads it because the
 * counter form needs the shape, and a client component must never name a
 * module that reaches the database (Day 5's rule). Routing it through the
 * `'use server'` action file is not an option either — a type-only re-export
 * does not survive Next's server-actions transform (Day 4's rule). A pure
 * module satisfies both, and keeps one source of truth.
 */
export interface BatchOnHand {
  batchId: string;
  productId: string;
  productName: string;
  batchNumber: string | null;
  expiryDate: string | null;
  qtyRemainingBase: number;
  unitCostPaisa: number;
  pricePerBaseUnitPaisa: number;
}

export type AdjustmentReason =
  | 'damage'
  | 'expiry_writeoff'
  | 'distributor_return'
  | 'count_correction'
  | 'opening_stock';

export const ADJUSTMENT_REASONS: readonly AdjustmentReason[] = [
  'count_correction',
  'damage',
  'expiry_writeoff',
  'distributor_return',
  'opening_stock',
] as const;

/** What the operator sees. Plain words, no system vocabulary (I5). */
export const REASON_LABELS: Readonly<Record<AdjustmentReason, string>> = {
  count_correction: 'Count correction',
  damage: 'Damaged',
  expiry_writeoff: 'Expired — written off',
  distributor_return: 'Returned to distributor',
  opening_stock: 'Opening stock',
};

export type AdjustmentRejection =
  | 'zero_delta'
  | 'reason_sign_mismatch'
  | 'batch_required'
  | 'batch_not_allowed';

export interface AdjustmentDraft {
  readonly productId: string;
  /** Signed. Negative removes stock, positive adds it. */
  readonly qtyBaseDelta: number;
  readonly reason: AdjustmentReason;
  /** Which batch is affected. Required when stock leaves; forbidden when it arrives. */
  readonly batchId: string | null;
  readonly note: string | null;
}

/** Reasons that may only ever reduce stock. */
const NEGATIVE_ONLY: readonly AdjustmentReason[] = [
  'damage',
  'expiry_writeoff',
  'distributor_return',
];

export function isNegativeOnly(reason: AdjustmentReason): boolean {
  return NEGATIVE_ONLY.includes(reason);
}

/**
 * Does this adjustment create stock, or remove it?
 *
 * Phase 9 §4: "positive opening/count deltas materialize batches". A positive
 * adjustment has no batch to add to — the whole point is that the system did
 * not know about this stock — so it brings one into existence. A negative one
 * must name the batch it takes from, or FEFO and expiry tracking would be
 * guessing.
 */
export function materializesBatch(draft: Pick<AdjustmentDraft, 'qtyBaseDelta'>): boolean {
  return draft.qtyBaseDelta > 0;
}

export function validateAdjustment(
  draft: AdjustmentDraft,
): { ok: true } | { ok: false; reason: AdjustmentRejection } {
  if (!Number.isSafeInteger(draft.qtyBaseDelta) || draft.qtyBaseDelta === 0) {
    return { ok: false, reason: 'zero_delta' };
  }

  if (isNegativeOnly(draft.reason) && draft.qtyBaseDelta > 0) {
    return { ok: false, reason: 'reason_sign_mismatch' };
  }
  if (draft.reason === 'opening_stock' && draft.qtyBaseDelta < 0) {
    return { ok: false, reason: 'reason_sign_mismatch' };
  }

  if (draft.qtyBaseDelta < 0 && draft.batchId === null) {
    return { ok: false, reason: 'batch_required' };
  }
  if (draft.qtyBaseDelta > 0 && draft.batchId !== null) {
    return { ok: false, reason: 'batch_not_allowed' };
  }

  return { ok: true };
}
