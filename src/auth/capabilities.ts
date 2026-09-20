import 'server-only';

import {
  permits,
  withheldBy,
  CAPABILITY_LABELS,
  type Capability,
} from '@/domain/licensing/capabilities';

import type { ActiveSession } from './session';

/**
 * The licence gate — PCN-006's Profile C, asked one capability at a time.
 *
 * Shaped like `requireOwner` in `settings/actions.ts` on purpose: a server
 * action states what it needs, and the answer is a typed result rather than a
 * throw. There is exactly one of these, and `licence-gating.test.ts` sweeps
 * every `'use server'` module to keep it that way.
 *
 * ## What this must never gate
 *
 * `settle`, `print` and `export` are permitted in every tier and are not
 * negotiable — see `domain/licensing/capabilities.ts`. More subtly, **the four
 * ADR-3 record kinds are ungated wherever they are INGESTED** (Invariant L1):
 * a sale, settlement, quick item or customer that was already captured offline
 * drains through the sync writer unconditionally, so a licence that lapses after
 * capture never strands what the pharmacy already recorded. What `restricted`
 * blocks is starting NEW business — the *capture* of a new sale, quick item,
 * udhaar or customer — and it does so at the point of capture, never in the
 * writer the sync path shares. A gate written against "catalogue writes" would
 * break both W6's unknown-medicine escape hatch and the drain behind it, so the
 * distinction is capture-vs-ingest, not screen-vs-screen.
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
    `${sentenceCase(CAPABILITY_LABELS[capability])} is paused until this installation’s ` +
    'licence is activated. Settling udhaar, printing receipts and exporting your data ' +
    'are unaffected. Open Settings → Licence, or contact Mehvar support.'
  );
}

/** What a restricted tier has lost, for the banner to list. */
export function withheldLabels(session: ActiveSession): readonly string[] {
  return withheldBy(session.licence.tier).map((capability) => CAPABILITY_LABELS[capability]);
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
