'use client';

/**
 * The licence banner (PCN-005).
 *
 * **Amber, never red** (I7). It sits in the caution family alongside
 * near-expiry, negative stock and unsynced records, and it is deliberately not
 * an alarm: a billing state is not an emergency, and colouring it like one
 * would teach the counter to ignore the colour that means something.
 *
 * Nothing renders while a licence is healthy. A banner that is always there is
 * furniture, and furniture does not get read.
 *
 * The shape is redeclared rather than imported from anything under `src/db` —
 * this is a client component, and the rule is "do not name the module", not
 * "a type-only import is fine" (CLAUDE.md, Day 7).
 */

export interface LicenceNotice {
  readonly status: string;
  readonly tier: 'full' | 'full_notice' | 'restricted';
  readonly entitlementEndsOn: string | null;
  readonly graceEndsOn: string | null;
  readonly trialEndsOn: string | null;
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
  // `expiring` is the owner's business, not the counter's: a salesman can do
  // nothing about a renewal date, and telling them about it every day is how a
  // warning stops being read.
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
    <div
      className="border-amber/40 bg-amber/5 text-amber shrink-0 border-b px-3 py-2 text-sm"
      role="note"
      aria-label="Licence"
    >
      <span className="font-medium">{words}</span>
      {notice.withheld.length > 0 ? (
        <span className="text-ink/70">
          {' '}
          Paused until renewed: {notice.withheld.join(', ')}. Selling, printing receipts and
          exporting your data keep working.
        </span>
      ) : null}
    </div>
  );
}

function sentence(notice: LicenceNotice): string | null {
  switch (notice.status) {
    case 'trial':
      return `Trial — ${notice.daysRemaining ?? 0} day(s) left.`;
    case 'expiring':
      return `Mehvar renewal due in ${notice.daysRemaining ?? 0} day(s).`;
    case 'grace':
      return `Mehvar renewal overdue since ${notice.entitlementEndsOn ?? ''}.`;
    case 'stale':
      return 'Mehvar has not been able to check this licence recently.';
    case 'lapsed':
      return 'This pharmacy’s Mehvar licence has lapsed.';
    case 'unbound':
      return 'This licence is registered to a different computer.';
    case 'invalid':
      return 'This pharmacy’s Mehvar licence could not be verified.';
    default:
      return null;
  }
}
