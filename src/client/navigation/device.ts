'use client';

import { useEffect, useState } from 'react';

/**
 * Detects if the current environment is a mobile browser / phone viewport.
 *
 * In Mehvar Pharmacy, the mobile breakpoint is below 768px (where PhoneTabs
 * replaces KeyBar). On touch screens / phones, unsolicited automatic focus
 * forces the on-screen software keyboard to open, obscuring 50% of the screen.
 *
 * Desktop and laptop browsers with physical keyboards retain the keyboard-first
 * autofocus workflow.
 */
export function isMobileBrowser(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const isSmallScreen =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767px)').matches
      : window.innerWidth < 768;

  const isCoarsePointer =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;

  const isMobileUA =
    typeof navigator !== 'undefined' &&
    /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);

  return isSmallScreen || (isCoarsePointer && isMobileUA);
}

/**
 * Hook to detect if the virtual software keyboard is open on a mobile browser.
 * Uses window.visualViewport height changes to detect Android/iOS keyboard state,
 * with focus fallback for environments without visualViewport.
 */
export function useVirtualKeyboardOpen(): boolean {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const vv = window.visualViewport;

    const checkKeyboard = () => {
      if (!isMobileBrowser()) {
        setIsOpen(false);
        return;
      }
      if (vv) {
        // When virtual keyboard opens on mobile, visualViewport height shrinks noticeably compared to window.innerHeight
        const heightDiff = window.innerHeight - vv.height;
        setIsOpen(heightDiff > 120);
      }
    };

    if (vv) {
      vv.addEventListener('resize', checkKeyboard);
      vv.addEventListener('scroll', checkKeyboard);
      checkKeyboard();
    }

    const handleFocusIn = (e: FocusEvent) => {
      if (!isMobileBrowser()) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        if (!vv) {
          setIsOpen(true);
        }
      }
    };

    const handleFocusOut = () => {
      if (!vv) {
        setIsOpen(false);
      }
    };

    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', checkKeyboard);
        vv.removeEventListener('scroll', checkKeyboard);
      }
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  return isOpen;
}

