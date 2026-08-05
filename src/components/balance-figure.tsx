/**
 * A customer balance, said out loud.
 *
 * One component so the customer page, the customer list, the picker and the
 * settlement slip cannot invent three vocabularies for the same number. The
 * rule it enforces is simple and absolute: **a balance never renders with a
 * minus sign.** The direction is a word; the amount is always positive.
 *
 * See `domain/udhaar/position.ts` for why.
 */

import { positionLabel, positionOf } from '@/domain/udhaar/position';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

/**
 * Colour carries meaning, never decoration (I7): amber is the shop's money
 * still out on the street, green is nothing to chase. An advance is neither a
 * problem nor an achievement, so it stays neutral.
 */
function toneOf(kind: ReturnType<typeof positionOf>['kind']): string {
  switch (kind) {
    case 'owes':
      return 'text-amber';
    case 'in_credit':
      return 'text-ink/70';
    case 'settled':
      return 'text-green-900';
  }
}

export function BalanceFigure({
  balancePaisa,
  size = 'normal',
}: {
  balancePaisa: number;
  size?: 'normal' | 'large';
}) {
  const position = positionOf(balancePaisa);
  const amount = formatPaisa(paisa(position.amountPaisa), { withSymbol: true });

  if (position.kind === 'settled') {
    return <span className={`${toneOf('settled')} font-medium`}>Settled up</span>;
  }

  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-ink/50 text-xs tracking-[0.14em] uppercase">
        {positionLabel(position.kind)}
      </span>
      <span
        className={`numeral font-semibold ${toneOf(position.kind)} ${
          size === 'large' ? 'text-total leading-none' : ''
        }`}
      >
        {amount}
      </span>
    </span>
  );
}

/** The inline form, for table cells and picker rows where a stack does not fit. */
export function BalanceInline({ balancePaisa }: { balancePaisa: number }) {
  const position = positionOf(balancePaisa);

  if (position.kind === 'settled') {
    return <span className="text-ink/50">Settled up</span>;
  }

  return (
    <span className={`numeral ${toneOf(position.kind)}`}>
      {formatPaisa(paisa(position.amountPaisa), { withSymbol: true })}
      {position.kind === 'in_credit' ? (
        <span className="text-ink/50 ml-1 text-xs">advance</span>
      ) : null}
    </span>
  );
}
