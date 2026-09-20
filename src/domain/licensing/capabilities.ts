/**
 * What each capability tier permits — PCN-006's Profile C, as data.
 *
 * Pure and client-safe, like `state.ts`: the banner names what is withheld, and
 * it must do that without reaching the database.
 *
 * ## Two tiers, keyed on authorization rather than payment
 *
 * `full` covers **evaluation** (an unlicensed install within its 30 days) and
 * **authorized** (a valid, bound perpetual licence). `restricted` covers
 * **unauthorized / unbound / invalid / revoked** — installations that are not
 * legitimately licensed. This is the PCN-006 reversal of the old L1: legitimate
 * operation is never blocked; an unauthorized copy may not create new business.
 *
 * ## Always permitted, in every tier
 *
 *   - **settle** — collecting an EXISTING udhaar balance. A carve-out: it closes
 *     out business already done and never creates new business (PCN-006).
 *   - **print** — T5. The receipt is the pharmacy's public face.
 *   - **export** — T3 / Phase 3 §3: the customer's data is never held hostage.
 *   - **manage_settings** — the licence is activated here (Invariant L4); a wall
 *     over Settings would trap the owner away from where activation happens.
 *
 * Catalogue browsing and catalogue updates/import are **not capabilities at all**
 * here: PCN-006 makes catalogue import ungated in every state, so it is never
 * asked of this gate.
 *
 * ## What `restricted` withholds — new business only
 *
 * New sales, quick items, new udhaar and new customers (the `sell` and
 * `manage_customer` capabilities), receiving stock, stock adjustments, and
 * product authoring. Already-captured offline records still drain through the
 * ungated sync path, so nothing is stranded or lost.
 */

import type { CapabilityTier } from './state';

export type Capability =
  /** Starting NEW business: a new sale, quick item or new udhaar (W1–W3, W6). */
  | 'sell'
  /** Settling an EXISTING udhaar balance. Ungated, always — the carve-out. */
  | 'settle'
  /** ADR-6. Ungated, always. */
  | 'print'
  /** Phase 9 §8. Ungated, always. */
  | 'export'
  /** W7/W9 — receiving a delivery, opening stock. */
  | 'receive_stock'
  /** W8/W10 — damage, expiry write-off, count correction. */
  | 'adjust_stock'
  /** Creating or editing a tenant product (catalogue authoring). */
  | 'author_product'
  /** Creating or editing a customer record. */
  | 'manage_customer'
  /** Editing tenant settings, users and PINs — and activating the licence. */
  | 'manage_settings';

const RESTRICTED_WITHHOLDS: readonly Capability[] = [
  'sell',
  'receive_stock',
  'adjust_stock',
  'author_product',
  'manage_customer',
];

/**
 * Capabilities that are NEVER gated, in any tier, by any code path.
 *
 * `licence-gating.test.ts` asserts this against the record kinds it must never
 * strand, so a future gate cannot quietly reach one of them.
 */
export const ALWAYS_PERMITTED: readonly Capability[] = ['settle', 'print', 'export'];

/**
 * Settings stays writable in every tier on purpose: the licence is pasted there
 * (Invariant L4), and a bad state that locked the owner out of the screen where
 * licences are fixed would be a wall nobody can clear.
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
  settle: 'settling udhaar',
  print: 'printing receipts',
  export: 'exporting your data',
  receive_stock: 'receiving stock',
  adjust_stock: 'stock adjustments',
  author_product: 'adding or editing products',
  manage_customer: 'adding or editing customers',
  manage_settings: 'settings',
};
