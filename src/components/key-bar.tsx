'use client';

/**
 * The key bar — Phase 10 §1.
 *
 * "A bottom key bar showing the global function keys — the visible-shortcuts
 * principle (I1) rendered as furniture, and a deliberate echo of the DOS-era POS
 * foot rail that Gen-1 (MARS-trained) salesmen already trust."
 *
 * It renders the registry directly. There is no second list.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { GLOBAL_KEYS } from '@/client/keyboard/registry';

/**
 * Keyboard-first is a claim about speed, not a reason to be inert to the
 * pointer. The bar prints the shortcut either way; making the entry navigable
 * costs the keyboard operator nothing and stops the bar from looking broken to
 * the owner being shown the product for the first time, who has no F-keys in
 * muscle memory yet.
 *
 * `F8` and `F10` have no route (they are contextual and dispatched, see the
 * registry), so those stay non-interactive rather than pretending to lead
 * somewhere — the handler that owns them lives in `AppShell`.
 */
export function KeyBar({ role }: { role: 'owner' | 'salesman' }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Function keys"
      className="bg-green-900 text-paper flex h-touch shrink-0 items-stretch gap-px overflow-x-auto text-xs"
    >
      {GLOBAL_KEYS.map((binding) => {
        const active = binding.href !== null && pathname.startsWith(binding.href);
        // Salesmen have no report access beyond the current day (Phase 5 §2).
        // The key stays visible and dimmed: the map is furniture, and furniture
        // that rearranges itself stops being trustworthy.
        const permitted = !binding.ownerOnly || role === 'owner';

        const className = [
          'flex items-center gap-1.5 whitespace-nowrap px-3 transition-colors',
          active ? 'bg-green-600' : '',
          permitted ? '' : 'opacity-40',
        ].join(' ');

        const content = (
          <>
            <kbd className="font-semibold tracking-tight">{binding.key}</kbd>
            <span className="opacity-80">{binding.label}</span>
          </>
        );

        if (binding.href === null || !permitted) {
          return (
            <span key={binding.key} data-active={active || undefined} className={className}>
              {content}
            </span>
          );
        }

        return (
          <Link
            key={binding.key}
            href={binding.href}
            data-active={active || undefined}
            className={`${className} ${active ? '' : 'hover:bg-green-600/60'}`}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
