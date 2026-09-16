import 'server-only';

import {
  permits,
  withheldBy,
  CAPABILITY_LABELS,
  type Capability,
} from '@/domain/licensing/capabilities';

import type { ActiveSession } from './session';

/**
 * The licence gate — PCN-005's ladder, asked one capability at a time.
 *
 * Shaped like `requireOwner` in `settings/actions.ts` on purpose: a server
 * action states what it needs, and the answer is a typed result rather than a
 * throw. There is exactly one of these, and `licence-gating.test.ts` sweeps
 * every `'use server'` module to keep it that way.
 *
 * ## What this must never gate
 *
 * `sell`, `print` and `export` are permitted in every tier and are not
 * negotiable — see `domain/licensing/capabilities.ts`. More subtly, **the four
 * ADR-3 record kinds are ungated wherever they are written**, not merely in the
 * sync module (Invariant L1). `createQuickItem` lives in
 * `domain/catalog/writers.ts`, so a gate written against "catalogue writes"
 * would break W6's unknown-medicine escape hatch — and because `ingestBatch`
 * stops at the first non-synced outcome, it would strand every offline sale
 * queued behind that quick item, permanently. That is a P2 violation arriving
 * one indirection from where anyone would look for it.
 */

export type CapabilityRefusal = {
  readonly ok: false;
  readonly reason: 'licence_required';
  /** Plain words for the operator, already assembled (I5). */
  readonly message: string;
};

export type CapabilityCheck = { readonly ok: true } | CapabilityRefusal;

export function requireCapability(session: ActiveSession, capability: Capability): CapabilityCheck {
  if (permits(session.licence.tier, capability)) return { ok: true };
  return { ok: false, reason: 'licence_required', message: refusalMessage(capability) };
}

/**
 * Names the thing that is unavailable and what to do about it — never a bare
 * "not allowed". I5: say what to do next, in plain words, without blame.
 */
export function refusalMessage(capability: Capability): string {
  return (
    `${sentenceCase(CAPABILITY_LABELS[capability])} is paused until this pharmacy’s ` +
    'licence is renewed. Selling, printing receipts and exporting your data are ' +
    'unaffected. Open Settings → Licence, or contact Mehvar support.'
  );
}

/** What a restricted tier has lost, for the banner to list. */
export function withheldLabels(session: ActiveSession): readonly string[] {
  return withheldBy(session.licence.tier).map((capability) => CAPABILITY_LABELS[capability]);
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
