/**
 * Button — the design system's `mv-btn` (PCN-016).
 *
 * Three kinds and no more: `primary` is the screen's one main action (at most
 * one per screen, and a list or a page of independently saved groups may have
 * none); `secondary` is a real alternative; `quiet` is everything else.
 * `buttonClass` is exported for a `Link` that must look like a button.
 */

export type ButtonKind = 'primary' | 'secondary' | 'quiet';

const BASE =
  'inline-flex min-h-touch min-w-touch items-center justify-center gap-2 whitespace-nowrap rounded-control border border-transparent text-control leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40';

const KINDS: Record<ButtonKind, string> = {
  primary:
    'bg-blue-600 px-5 font-semibold text-surface shadow-sm enabled:hover:bg-blue-700 [&:is(a)]:hover:bg-blue-700',
  secondary:
    'border-border bg-surface px-[18px] font-medium text-navy enabled:hover:border-navy enabled:hover:bg-page [&:is(a)]:hover:border-navy [&:is(a)]:hover:bg-page',
  quiet:
    'px-3 text-body-sm font-medium text-ink-2 enabled:hover:bg-mist enabled:hover:text-navy [&:is(a)]:hover:bg-mist [&:is(a)]:hover:text-navy',
};

export function buttonClass(kind: ButtonKind, options: { block?: boolean } = {}): string {
  return [BASE, KINDS[kind], options.block ? 'w-full' : ''].join(' ');
}

export function Button({
  kind = 'secondary',
  block = false,
  className = '',
  type = 'button',
  ...props
}: React.ComponentProps<'button'> & { kind?: ButtonKind; block?: boolean }) {
  return (
    <button type={type} className={`${buttonClass(kind, { block })} ${className}`} {...props} />
  );
}

/**
 * A key hint on a control (`Pay F12`). Hidden on a phone, which has no
 * function keys. The key itself must come from `keyFor` or the registry,
 * never a literal (Day 16).
 */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="text-kbd font-sans opacity-75 max-md:hidden">{children}</kbd>;
}
