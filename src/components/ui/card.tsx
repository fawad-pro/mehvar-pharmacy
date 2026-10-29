/**
 * Card — a white surface on the page, lifted by shadow, never outlined
 * (PCN-016). One topic per card.
 */

export const cardClass = 'flex min-w-0 flex-col gap-3 rounded-card bg-surface p-5 shadow-card';

export function Card({ className = '', ...props }: React.ComponentProps<'section'>) {
  return <section className={`${cardClass} ${className}`} {...props} />;
}

export function CardTitle({ className = '', ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={`text-heading m-0 text-navy ${className}`} {...props} />;
}
