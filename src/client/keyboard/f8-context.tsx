'use client';

/**
 * F8's contextual override — defect C5.
 *
 *   "F8 is contextual: with items in the cart it attaches a customer for
 *    udhaar (W2); with an empty cart it opens Settle Udhaar (W3)."
 *
 * `AppShell` owns the global F8 binding and the Settle Udhaar overlay it falls
 * back to, but has no reason to know about the Sale surface's cart. Rather
 * than reach into another screen's state, the Sale surface registers a
 * handler here whenever it wants F8 for itself (a non-empty cart); with
 * nothing registered, AppShell dispatches to its own fallback. One key, two
 * contexts, no screen imports another's internals.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

type F8Handler = () => void;

const F8Context = createContext<{ register: (handler: F8Handler | null) => void } | null>(null);

/** Owned by AppShell: tracks whatever handler is currently registered. */
export function useF8Registry(): {
  register: (handler: F8Handler | null) => void;
  dispatch: (fallback: F8Handler) => void;
} {
  const handlerRef = useRef<F8Handler | null>(null);

  const register = useCallback((handler: F8Handler | null) => {
    handlerRef.current = handler;
  }, []);

  const dispatch = useCallback((fallback: F8Handler) => {
    if (handlerRef.current) {
      handlerRef.current();
    } else {
      fallback();
    }
  }, []);

  return { register, dispatch };
}

export function F8Provider({
  register,
  children,
}: {
  register: (handler: F8Handler | null) => void;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ register }), [register]);
  return <F8Context.Provider value={value}>{children}</F8Context.Provider>;
}

/** Called by a surface (Sale) to take F8 for itself while it is mounted and wants it. */
export function useRegisterF8Handler(handler: F8Handler | null): void {
  const registry = useContext(F8Context);

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
