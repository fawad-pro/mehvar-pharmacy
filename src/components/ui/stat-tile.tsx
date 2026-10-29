/**
 * StatTile — one figure: a one-line label of at most 14 characters, the
 * figure, and a meta line that carries its time scope (PCN-016). Every part
 * has a fixed height, so a row of tiles is even and its figures share a
 * baseline. `attention` colours the figure amber and marks the label with a
 * dot: the word in the meta line says why (I7).
 */

import { FieldLabel } from './field';

export function StatTiles({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`grid items-stretch gap-4 ${className}`}>{children}</div>;
}

export function StatTile({
  label,
  value,
  meta,
  attention = false,
  ariaLabel,
}: {
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
  attention?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      className="grid min-w-0 grid-rows-[var(--label-height)_32px_20px] gap-y-1.5 rounded-card bg-surface px-5 py-[18px] shadow-card"
      aria-label={ariaLabel}
    >
      <FieldLabel>
        {attention ? (
          <span
            aria-hidden="true"
            className="mr-1.5 inline-block size-[7px] rounded-full bg-amber align-[1px]"
          />
        ) : null}
        {label}
      </FieldLabel>
      <span className={`numeral text-stat truncate ${attention ? 'text-amber-text' : 'text-navy'}`}>
        {value}
      </span>
      <span className="text-body-sm truncate text-right text-ink-2">{meta}</span>
    </div>
  );
}
