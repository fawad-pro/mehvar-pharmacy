'use client';

/**
 * The licence banner (PCN-006).
 *
 * **Amber, never red** (I7). It sits in the caution family alongside
 * near-expiry, negative stock and unsynced records, and it is deliberately not
 * an alarm: an authorization state is not an emergency, and colouring it like
 * one would teach the counter to ignore the colour that means something.
 *
 * Nothing renders while an installation is authorized. A banner that is always
 * there is furniture, and furniture does not get read.
 *
 * The shape is redeclared rather than imported from anything under `src/db` —
 * this is a client component, and the rule is "do not name the module", not
 * "a type-only import is fine" (CLAUDE.md, Day 7).
 */

import { Banner } from './ui/banner';

export interface LicenceNotice {
  readonly status: string;
  readonly tier: 'full' | 'restricted';
  readonly evaluationEndsOn: string | null;
  readonly daysRemaining: number | null;
  readonly withheld: readonly string[];
  readonly ownerOnly: boolean;
}

export function LicenceBanner({
  notice,
  isOwner,
}: {
  notice: LicenceNotice | null;
  isOwner: boolean;
}): React.ReactElement | null {
  if (notice === null) return null;
  // The evaluation countdown is the owner's business, not the counter's: a
  // salesman can do nothing about activating a licence, and telling them about
  // it every day is how a notice stops being read.
  if (notice.ownerOnly && !isOwner) return null;

  const words = sentence(notice);
  if (words === null) return null;

  return (
    // `note`, not `status`. `status` is an ARIA live region for things that
    // CHANGE — the unsynced badge earns it because its count moves. This banner
    // is persistent page furniture, so a live region would re-announce it on
    // every navigation, which is noise rather than help. It also kept every
    // `getByRole('status')` in the E2E suite ambiguous, which is the same fact
    // showing up as a test failure.
    <Banner
      tone="attention"
      strip
      role="note"
      aria-label="Licence"
      lead={words}
      className="shrink-0"
    >
      {notice.withheld.length > 0 ? (
        <>
          Paused until activated: {notice.withheld.join(', ')}. Settling udhaar, printing receipts
          and exporting your data keep working.
        </>
      ) : null}
    </Banner>
  );
}

function sentence(notice: LicenceNotice): string | null {
  switch (notice.status) {
    case 'evaluation':
      return `Evaluation — ${notice.daysRemaining ?? 0} day(s) left.`;
    case 'unauthorized':
      return 'This installation’s 30-day evaluation has ended. Activate a licence to keep selling.';
    case 'unbound':
      return 'This licence is registered to a different computer.';
    case 'invalid':
      return 'This pharmacy’s Mehvar licence could not be verified.';
    case 'revoked':
      return 'This pharmacy’s Mehvar licence has been revoked.';
    default:
      return null;
  }
}
