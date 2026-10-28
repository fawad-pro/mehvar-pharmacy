/**
 * KeyBar chip — the design system's `mv-key` (PCN-016): a soft `mist` chip,
 * the key in navy and its word in `ink-2`; the active key fills blue. A chip
 * a role cannot use stays where it is, dimmed: the bar is furniture and never
 * rearranges (T1).
 */

export function keyChipClass({
  active,
  permitted,
  startsBand,
}: {
  active: boolean;
  permitted: boolean;
  startsBand: boolean;
}): string {
  return [
    'relative flex min-h-touch min-w-touch shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-3 text-[13px] transition-colors',
    active ? 'bg-blue-600 text-surface' : 'bg-mist',
    active || !permitted ? '' : 'hover:bg-blue-50',
    permitted ? '' : 'cursor-not-allowed opacity-45',
    // A short hairline between the registry's bands (counter / goods / owner).
    startsBand
      ? 'ml-2.5 before:absolute before:inset-y-2.5 before:-left-[9px] before:w-px before:bg-line'
      : '',
  ].join(' ');
}

export function keyChipKeyClass(active: boolean): string {
  return `text-kbd font-sans ${active ? 'text-surface' : 'text-navy'}`;
}

export function keyChipLabelClass(active: boolean): string {
  return `font-medium ${active ? 'text-surface' : 'text-ink-2'}`;
}
