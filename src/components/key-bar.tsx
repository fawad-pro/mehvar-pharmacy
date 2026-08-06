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
 * Keys with a `dispatch` instead of an `href` — currently Udhaar and Switch
 * user — have no route, so those stay non-interactive rather than pretending
 * to lead somewhere; the handler that owns them lives in `AppShell`. Which
 * keys those are is whatever the registry says below, not a fact worth
 * repeating here as letters that a reorder would make wrong.
 */
export function KeyBar({ role }: { role: 'owner' | 'salesman' }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Function keys"
      className="bg-green-900 text-paper flex h-touch shrink-0 items-stretch gap-px overflow-x-auto text-xs"
    >
      {GLOBAL_KEYS.map((binding, index) => {
        const active = binding.href !== null && pathname.startsWith(binding.href);
        // A visible break between the registry's bands (counter / goods /
        // owner). Without it the grouping exists only in a source comment,
        // which helps nobody standing at the counter.
        const startsBand = index > 0 && GLOBAL_KEYS[index - 1]!.group !== binding.group;
        // Salesmen have no report access beyond the current day (Phase 5 §2).
        // The key stays visible and dimmed: the map is furniture, and furniture
        // that rearranges itself stops being trustworthy.
        const permitted = !binding.ownerOnly || role === 'owner';

        const className = [
          'flex items-center gap-1.5 whitespace-nowrap px-3 transition-colors',
          active ? 'bg-green-600' : '',
          permitted ? '' : 'opacity-40',
          startsBand ? 'ml-2 border-l border-paper/25' : '',
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
