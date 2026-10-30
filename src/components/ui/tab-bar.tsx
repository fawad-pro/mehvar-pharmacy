/**
 * TabBar — phone navigation in place of the key bar below 768 px (PCN-016):
 * five tabs, the current one blue on a `blue-50` pill. A tab a role cannot
 * use stays, dimmed, exactly as its key does on the key bar.
 */

import Link from 'next/link';

export type TabIcon = 'sale' | 'receive' | 'stock' | 'customers' | 'day' | 'more';

const PATHS: Record<TabIcon, React.ReactNode> = {
  sale: (
    <>
      <path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.2" />
      <circle cx="9.5" cy="19.5" r="1.2" />
      <circle cx="17" cy="19.5" r="1.2" />
    </>
  ),
  receive: (
    <>
      <path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" />
    </>
  ),
  stock: (
    <>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5" />
      <path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.7c1.9.6 3.1 2.2 3.5 4.8" />
    </>
  ),
  day: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.5" cy="12" r="1.3" />
    </>
  ),
};

const TAB =
  'flex min-h-[52px] min-w-touch flex-col items-center justify-center gap-0.5 rounded-control text-caption';

function tabClass(current: boolean, permitted: boolean): string {
  return [
    TAB,
    current ? 'font-semibold text-blue-600' : 'text-ink-2',
    permitted ? (current ? '' : 'hover:text-navy') : 'cursor-not-allowed opacity-45',
  ].join(' ');
}

function Icon({ icon, current }: { icon: TabIcon; current: boolean }) {
  return (
    <span
      className={`flex h-7 w-12 items-center justify-center rounded-pill ${current ? 'bg-blue-50' : ''}`}
    >
      <svg
        className="size-[22px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {PATHS[icon]}
      </svg>
    </span>
  );
}

export function TabBar({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav
      aria-label={label}
      className="grid shrink-0 grid-cols-5 gap-0.5 bg-surface px-1.5 pt-1.5 pb-2 shadow-bar md:hidden"
    >
      {children}
    </nav>
  );
}

export function TabLink({
  href,
  icon,
  label,
  current,
  permitted = true,
}: {
  href: string;
  icon: TabIcon;
  label: string;
  current: boolean;
  permitted?: boolean;
}) {
  if (!permitted) {
    return (
      <span aria-disabled="true" className={tabClass(false, false)}>
        <Icon icon={icon} current={false} />
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={tabClass(current, true)}
    >
      <Icon icon={icon} current={current} />
      {label}
    </Link>
  );
}

export function TabButton({
  icon,
  label,
  current = false,
  onClick,
  ...props
}: Omit<React.ComponentProps<'button'>, 'children' | 'className'> & {
  icon: TabIcon;
  label: string;
  current?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={tabClass(current, true)} {...props}>
      <Icon icon={icon} current={current} />
      {label}
    </button>
  );
}
