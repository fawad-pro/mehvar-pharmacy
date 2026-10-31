'use client';

import { useEffect, useRef } from 'react';

import { isMobileBrowser } from '@/client/navigation/device';

/**
 * An input field for server-rendered search forms (Customers, Products).
 *
 * On desktop/laptop, it automatically focuses on mount to preserve the
 * keyboard-first counter workflow. On mobile browsers, automatic focus is
 * suppressed to prevent the on-screen software keyboard from popping up on screen load.
 */
export function SearchInput({
  autoFocus = true,
  autoComplete = 'off',
  ...props
}: React.ComponentProps<'input'>) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !isMobileBrowser()) {
      ref.current?.focus();
    }
  }, [autoFocus]);

  return <input ref={ref} autoComplete={autoComplete} {...props} />;
}
