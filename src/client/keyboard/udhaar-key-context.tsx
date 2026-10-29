'use client';

/**
 * The udhaar key's contextual override — defect C5.
 *
 *   "The udhaar key is contextual: with items in the cart it attaches a
 *    customer for udhaar (W2); with an empty cart it opens Settle Udhaar
 *    (W3)."
 *
 * Deliberately named by meaning rather than by letter — this file used to be
 * `f8-context.tsx`, and every comment in it said "F8", right up until Udhaar
 * moved to F4 and the name became a lie nobody noticed because it still
 * compiled. Which physical key it is lives in exactly one place: the
 * registry's `dispatch:'udhaar'` entry.
 *
 * `AppShell` owns the global binding and the Settle Udhaar overlay it falls
 * back to, but has no reason to know about the Sale surface's cart. Rather
 * than reach into another screen's state, the Sale surface registers a
 * handler here whenever it wants the key for itself (a non-empty cart); with
 * nothing registered, AppShell dispatches to its own fallback. One key, two
 * contexts, no screen imports another's internals.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

type UdhaarKeyHandler = () => void;

const UdhaarKeyContext = createContext<{
  register: (handler: UdhaarKeyHandler | null) => void;
  /** The key's meaning, run exactly as pressing it does. */
  press: () => void;
} | null>(null);

/** Owned by AppShell: tracks whatever handler is currently registered. */
export function useUdhaarKeyRegistry(): {
  register: (handler: UdhaarKeyHandler | null) => void;
  dispatch: (fallback: UdhaarKeyHandler) => void;
} {
  const handlerRef = useRef<UdhaarKeyHandler | null>(null);

  const register = useCallback((handler: UdhaarKeyHandler | null) => {
    handlerRef.current = handler;
  }, []);

  const dispatch = useCallback((fallback: UdhaarKeyHandler) => {
    if (handlerRef.current) {
      handlerRef.current();
    } else {
      fallback();
    }
  }, []);

  return { register, dispatch };
}

export function UdhaarKeyProvider({
  register,
  press,
  children,
}: {
  register: (handler: UdhaarKeyHandler | null) => void;
  press: () => void;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ register, press }), [register, press]);
  return <UdhaarKeyContext.Provider value={value}>{children}</UdhaarKeyContext.Provider>;
}

/** Called by a surface (Sale) to take the udhaar key for itself while it is mounted and wants it. */
export function useRegisterUdhaarKeyHandler(handler: UdhaarKeyHandler | null): void {
  const registry = useContext(UdhaarKeyContext);

  useEffect(() => {
    if (!registry) {
      return;
    }
    registry.register(handler);
    return () => {
      registry.register(null);
    };
  }, [registry, handler]);
}

/**
 * The udhaar key as something to tap: a screen's button that means "what the
 * key means here" (Sale's Settle card) runs the same dispatch, so it can never
 * disagree with the key.
 */
export function useUdhaarKeyPress(): () => void {
  const registry = useContext(UdhaarKeyContext);
  return registry?.press ?? noop;
}

function noop(): void {}
