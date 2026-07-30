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

import { usePathname } from 'next/navigation';

import { GLOBAL_KEYS } from '@/client/keyboard/registry';

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

        return (
          <span
            key={binding.key}
            data-active={active || undefined}
            className={[
              'flex items-center gap-1.5 whitespace-nowrap px-3',
              active ? 'bg-green-600' : '',
              permitted ? '' : 'opacity-40',
            ].join(' ')}
          >
            <kbd className="font-semibold tracking-tight">{binding.key}</kbd>
            <span className="opacity-80">{binding.label}</span>
          </span>
        );
      })}
    </nav>
  );
}
