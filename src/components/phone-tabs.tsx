'use client';

/**
 * The phone's tab bar (PCN-016): below 768px of screen the key bar gives way
 * to five tabs — Sale, Receive, Customers, Day, More — and More opens every
 * other key, in the registry's order, as a bottom sheet.
 *
 * Every entry comes from the registry, so a tab and its key cannot disagree
 * about where they lead or who may use them. A phone has no function keys,
 * so nothing here prints one.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { GLOBAL_KEYS, type GlobalKey } from '@/client/keyboard/registry';

import { Dialog } from './ui/dialog';
import { TabBar, TabButton, TabLink, type TabIcon } from './ui/tab-bar';

/** The four keys that get a tab, by route, with the tab's shorter word. */
const TABS: ReadonlyArray<{ href: string; label: string; icon: TabIcon }> = [
  { href: '/sale', label: 'Sale', icon: 'sale' },
  { href: '/purchases', label: 'Receive', icon: 'receive' },
  { href: '/customers', label: 'Customers', icon: 'customers' },
  { href: '/day', label: 'Day', icon: 'day' },
];

const ROW =
  'flex min-h-touch w-full items-center gap-3 border-t border-line px-4 py-2 text-left text-control font-medium first:border-t-0 hover:bg-page';

export function PhoneTabs({
  role,
  onDispatch,
}: {
  role: 'owner' | 'salesman';
  onDispatch: (dispatch: NonNullable<GlobalKey['dispatch']>) => void;
}) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);

  const tabbed = new Set(TABS.map((tab) => tab.href));
  const rest = GLOBAL_KEYS.filter((binding) => binding.href === null || !tabbed.has(binding.href));
  const permitted = (binding: GlobalKey) => !binding.ownerOnly || role === 'owner';
  const restIsCurrent = rest.some(
    (binding) => binding.href !== null && pathname.startsWith(binding.href),
  );

  const close = () => {
    setMore(false);
  };

  return (
    <>
      <TabBar label="Sections">
        {TABS.map((tab) => {
          const binding = GLOBAL_KEYS.find((candidate) => candidate.href === tab.href);
          return (
            <TabLink
              key={tab.href}
              href={tab.href}
              icon={tab.icon}
              label={tab.label}
              // Adjust lives under /stock, which is not a tab; /sale is not
              // a prefix of anything else, so a plain prefix match is right.
              current={pathname.startsWith(tab.href)}
              permitted={binding ? permitted(binding) : true}
            />
          );
        })}
        <TabButton
          icon="more"
          label="More"
          current={more || restIsCurrent || pathname.startsWith('/settings')}
          aria-haspopup="dialog"
          onClick={() => {
            setMore(true);
          }}
        />
      </TabBar>

      {more ? (
        <Dialog title="More" onDismiss={close} onEscape={close}>
          <ul className="bg-page m-0 list-none overflow-hidden rounded-card p-0">
            {rest.map((binding) => {
              const allowed = permitted(binding);
              const meaning = binding.dispatch;
              if (!allowed) {
                return (
                  <li key={binding.key}>
                    <span aria-disabled="true" className={`${ROW} cursor-not-allowed opacity-45`}>
                      {binding.label}
                    </span>
                  </li>
                );
              }
              return (
                <li key={binding.key}>
                  {meaning ? (
                    <button
                      type="button"
                      className={ROW}
                      onClick={() => {
                        close();
                        onDispatch(meaning);
                      }}
                    >
                      {binding.label}
                    </button>
                  ) : binding.href ? (
                    <Link href={binding.href} className={ROW} onClick={close}>
                      {binding.label}
                    </Link>
                  ) : null}
                </li>
              );
            })}
            {role === 'owner' ? (
              <li>
                <Link href="/settings" className={ROW} onClick={close}>
                  Settings
                </Link>
              </li>
            ) : null}
          </ul>
        </Dialog>
      ) : null}
    </>
  );
}
