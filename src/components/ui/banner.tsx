/**
 * Banner — a soft tinted panel for a state that persists: done, needs
 * attention, refused (PCN-016). The lead words are bold in the status colour;
 * the rest is navy. A mark is drawn beside them, so the colour is never the
 * only signal (I7). `strip` runs edge to edge under the top bar.
 */

export type BannerTone = 'done' | 'attention' | 'refused';

const TONES: Record<BannerTone, { ground: string; mark: string; lead: string }> = {
  done: { ground: 'bg-green-50', mark: 'text-green-700', lead: 'text-green-700' },
  attention: { ground: 'bg-amber-50', mark: 'text-amber', lead: 'text-amber-text' },
  refused: { ground: 'bg-red-50', mark: 'text-red', lead: 'text-red' },
};

export function BannerMark({ tone }: { tone: BannerTone }) {
  const className = `size-[18px] shrink-0 ${TONES[tone].mark}`;
  if (tone === 'done') {
    return (
      <svg className={className} viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="8" fill="currentColor" />
        <path
          d="M5.5 9.2l2.3 2.3 4.7-4.9"
          fill="none"
          stroke="var(--surface)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (tone === 'attention') {
    return (
      <svg className={className} viewBox="0 0 18 18" aria-hidden="true">
        <path d="M9 1.8l7.6 13.4H1.4z" fill="currentColor" />
        <path
          d="M9 6.8v3.6M9 12.6v.1"
          stroke="var(--surface)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill="currentColor" />
      <path
        d="M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6"
        stroke="var(--surface)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Banner({
  tone,
  lead,
  strip = false,
  className = '',
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  tone: BannerTone;
  /** The bold first words, in the status colour. */
  lead?: React.ReactNode;
  strip?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`text-body-sm flex min-h-touch items-center gap-3 px-4 py-2 text-navy ${TONES[tone].ground} ${strip ? '' : 'rounded-card'} ${className}`}
      {...props}
    >
      <BannerMark tone={tone} />
      <span className="min-w-0 flex-1">
        {lead ? <strong className={`font-semibold ${TONES[tone].lead}`}>{lead}</strong> : null}
        {lead && children ? ' ' : null}
        {children}
      </span>
    </div>
  );
}
