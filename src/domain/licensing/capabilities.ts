/**
 * What each capability tier permits — PCN-005's ladder, as data.
 *
 * Pure and client-safe, like `state.ts`: the banner needs to name what is
 * withheld, and it must be able to do that without reaching the database.
 *
 * ## The three columns that are true in every row
 *
 * `sell`, `print` and `export` are permitted in **every** tier, including
 * `restricted`. That is not a default anyone may change:
 *
 *   - **sell** — P2. The counter never waits for a billing question, and this
 *     includes offline capture and draining the outbox.
 *   - **print** — T5. The receipt is the pharmacy's public face; nothing about
 *     our billing belongs on their customer's slip (decision D8).
 *   - **export** — T3 and Phase 3 §3: "the customer's data is never held
 *     hostage — export remains available regardless of payment state."
 *
 * What `restricted` withholds is everything off the sale path: a lapsed pharmacy
 * trades exactly as fast as a paid one and cannot restock. Stock drains, the
 * pending layer fills where the operator can see it (D2), and Day 6's
 * oldest-first resolution clears it the moment they pay. Nothing needs unwinding
 * — which is why these are the right capabilities to withhold.
 */

import type { CapabilityTier } from './state';

export type Capability =
  /** W1–W3, W6. Ungated, always. */
  | 'sell'
  /** ADR-6. Ungated, always. */
  | 'print'
  /** Phase 9 §8. Ungated, always. */
  | 'export'
  /** W7/W9 — receiving a delivery, opening stock. */
  | 'receive_stock'
  /** W10 — damage, expiry write-off, count correction. */
  | 'adjust_stock'
  /** Applying a catalogue data pack. */
  | 'catalog_pack'
  /** Taking an automatic software update. */
  | 'auto_update'
  /** Editing tenant settings, users and PINs. */
  | 'manage_settings';

const RESTRICTED_WITHHOLDS: readonly Capability[] = [
  'receive_stock',
  'adjust_stock',
  'catalog_pack',
  'auto_update',
];

/**
 * Capabilities that are NEVER gated, in any tier, by any code path.
 *
 * `licence-gating.test.ts` asserts this list against the ADR-3 record kinds, so
 * a future gate cannot quietly reach one of them.
 */
export const ALWAYS_PERMITTED: readonly Capability[] = ['sell', 'print', 'export'];

/**
 * Settings stays writable in every tier on purpose: the licence is pasted there
 * (Invariant L4), and a bad licence that locked the owner out of the screen
 * where licences are fixed would be a wall nobody can clear.
 */
export function permits(tier: CapabilityTier, capability: Capability): boolean {
  if (ALWAYS_PERMITTED.includes(capability)) return true;
  if (capability === 'manage_settings') return true;
  if (tier === 'restricted') return !RESTRICTED_WITHHOLDS.includes(capability);
  return true;
}

/** What a `restricted` installation has lost, for the banner to name. */
export function withheldBy(tier: CapabilityTier): readonly Capability[] {
  return tier === 'restricted' ? RESTRICTED_WITHHOLDS : [];
}

/** Plain words for the operator. I5: say what it is, not what it is called. */
export const CAPABILITY_LABELS: Readonly<Record<Capability, string>> = {
  sell: 'selling',
  print: 'printing receipts',
  export: 'exporting your data',
  receive_stock: 'receiving stock',
  adjust_stock: 'stock adjustments',
  catalog_pack: 'medicine catalogue updates',
  auto_update: 'automatic software updates',
  manage_settings: 'settings',
};
