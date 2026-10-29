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

import { GLOBAL_KEYS, type GlobalKey } from '@/client/keyboard/registry';

import { keyChipClass, keyChipKeyClass, keyChipLabelClass } from './ui/key-chip';

/**
 * Keyboard-first is a claim about speed, not a reason to be inert to the
 * pointer. The bar prints the shortcut either way; making the entry navigable
 * costs the keyboard operator nothing and stops the bar from looking broken to
 * the owner being shown the product for the first time, who has no F-keys in
 * muscle memory yet.
 *
 * Keys with a `dispatch` instead of an `href` — currently Udhaar and Switch
 * user — have no route, so they are buttons that do what the key does,
 * through the same handler (`AppShell` owns it). They were inert text, which
 * on a tablet, with no F-keys, meant an udhaar sale and a user switch could
 * not be done at all. Which keys those are is whatever the registry says
 * below, not a fact worth repeating here as letters a reorder would make
 * wrong.
 */
export function KeyBar({
  role,
  keys = GLOBAL_KEYS,
  onDispatch,
}: {
  role: 'owner' | 'salesman';
  /** The keys this shop uses — see `keysFor`. */
  keys?: readonly GlobalKey[];
  /** Runs a routeless key's meaning, exactly as pressing it does. */
  onDispatch: (dispatch: NonNullable<GlobalKey['dispatch']>) => void;
}) {
  const pathname = usePathname();

  return (
    // The light bar of PCN-016: soft chips on a white strip, the active key
    // blue. A phone has no function keys; below 768px the tab bar takes over.
    <nav
      aria-label="Function keys"
      className="bg-surface text-navy shadow-bar flex shrink-0 items-center gap-1.5 overflow-x-auto px-2 py-1.5 max-md:hidden"
    >
      {keys.map((binding, index) => {
        const active = binding.href !== null && pathname.startsWith(binding.href);
        // A visible break between the registry's bands (counter / goods /
        // owner). Without it the grouping exists only in a source comment,
        // which helps nobody standing at the counter.
        const startsBand = index > 0 && keys[index - 1]!.group !== binding.group;
        // Salesmen have no report access beyond the current day (Phase 5 §2).
        // The key stays visible and dimmed: the map is furniture, and furniture
        // that rearranges itself stops being trustworthy.
        const permitted = !binding.ownerOnly || role === 'owner';

        const className = keyChipClass({ active, permitted, startsBand });

        const content = (
          <>
            <kbd className={keyChipKeyClass(active)}>{binding.key}</kbd>
            <span className={keyChipLabelClass(active)}>{binding.label}</span>
          </>
        );

        if (binding.dispatch && permitted) {
          const meaning = binding.dispatch;
          return (
            <button
              key={binding.key}
              type="button"
              onClick={() => {
                onDispatch(meaning);
              }}
              className={className}
            >
              {content}
            </button>
          );
        }

        if (binding.href === null || !permitted) {
          return (
            <span
              key={binding.key}
              data-active={active || undefined}
              aria-disabled={permitted ? undefined : true}
              className={className}
            >
              {content}
            </span>
          );
        }

        return (
          <Link
            key={binding.key}
            href={binding.href}
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
            className={className}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
