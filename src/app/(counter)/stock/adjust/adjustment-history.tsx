/**
 * What has already been adjusted — the review half of this screen.
 *
 * Moved here from Stock. The principle is the one that produced the receipts
 * surface: a clear place to DO something, a separate obvious place to REVIEW
 * what happened. Stock browsing answers "what do I have, and what needs
 * attention?"; a log of corrections answers "what did we change, and who
 * changed it?" — which is a question you ask standing at the screen where
 * corrections are made, usually as "did someone already fix this?"
 *
 * T1 is unchanged: every adjustment is visible, without exception. This is the
 * same list, in the place where it means something.
 *
 * Shapes are redeclared rather than imported from `src/db` (Day 7's rule),
 * even though this is a server component — the rule is "don't name the
 * module", and keeping it uniform is what stops the exception becoming the
 * habit.
 */

interface Row {
  id: string;
  productName: string;
  baseUnitName: string;
  qtyBaseDelta: number;
  /** The amount moved, worded: "3 strip", "2 box, 4 tab". */
  amount: string;
  reason: string;
  note: string | null;
  byName: string;
  createdAt: Date;
}

export function AdjustmentHistory({ rows }: { rows: Row[] }) {
  return (
    <section className="mx-auto w-full max-w-3xl p-4 pt-0">
      <h2 className="text-green-900 mb-2 font-medium">Recently adjusted</h2>
      {rows.length === 0 ? (
        <p className="text-ink/50 text-sm">Nothing adjusted yet.</p>
      ) : (
        <ul className="border-line divide-line divide-y rounded border text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
              <span className="font-medium">{row.productName}</span>
              {/* Amber for stock leaving, because that is the direction worth a
                  second look — a correction downward is the one that can hide a
                  loss (I7: a colour means one thing). */}
              <span className={`numeral ${row.qtyBaseDelta < 0 ? 'text-amber' : 'text-green-900'}`}>
                {row.qtyBaseDelta > 0 ? '+' : '−'}
                {row.amount}
              </span>
              <span className="text-ink/60">{row.reason.replaceAll('_', ' ')}</span>
              {row.note ? <span className="text-ink/50 text-xs">“{row.note}”</span> : null}
              <span className="text-ink/40 ml-auto text-xs">
                {row.byName} · {row.createdAt.toLocaleDateString('en-PK')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
