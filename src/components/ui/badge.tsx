/**
 * Badge — a pill holding a word: a unit, a count, or a state (PCN-016).
 * Status badges carry a dot as well as a colour, and always a word (I7).
 */

export type BadgeTone = 'neutral' | 'done' | 'attention' | 'refused';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-mist text-navy',
  done: 'bg-green-50 text-green-700',
  attention: 'bg-amber-50 text-amber-text',
  refused: 'bg-red-50 text-red',
};

const DOT: Record<BadgeTone, string> = {
  neutral: '',
  done: 'bg-green-700',
  attention: 'bg-amber',
  refused: 'bg-red',
};

export function badgeClass(tone: BadgeTone = 'neutral'): string {
  return `text-caption inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 ${TONES[tone]}`;
}

export function Badge({
  tone = 'neutral',
  className = '',
  children,
  ...props
}: React.ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span className={`${badgeClass(tone)} ${className}`} {...props}>
      {tone === 'neutral' ? null : (
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
      )}
      {children}
    </span>
  );
}
