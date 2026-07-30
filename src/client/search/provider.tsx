'use client';

/**
 * Serves the index to the counter — ADR-4's "in-memory served".
 *
 * Built once per session and held in memory for the life of the page, because
 * rebuilding a 3,000-product index per render would undo the whole point. The
 * index is deliberately not React state: it is a large immutable object, and
 * putting it through the reconciler buys nothing.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { CatalogIndex } from './catalog-index';
import { loadCatalog } from './store';

export type IndexStatus = 'loading' | 'ready' | 'stale' | 'unavailable';

interface CatalogContextValue {
  readonly index: CatalogIndex | null;
  readonly status: IndexStatus;
  readonly productCount: number;
  readonly refresh: () => void;
}

const CatalogContext = createContext<CatalogContextValue>({
  index: null,
  status: 'loading',
  productCount: 0,
  refresh: () => {},
});

export function CatalogProvider({
  tenantId,
  children,
}: {
  tenantId: string;
  children: React.ReactNode;
}) {
  const [index, setIndex] = useState<CatalogIndex | null>(null);
  const [status, setStatus] = useState<IndexStatus>('loading');
  const [nonce, setNonce] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    void (async () => {
      const { payload, fromCache, refreshed } = await loadCatalog(tenantId);
      if (cancelled.current) {
        return;
      }

      setIndex(CatalogIndex.build(payload));
      if (payload.products.length === 0 && !refreshed) {
        setStatus('unavailable');
      } else {
        // "stale" means the counter is running on cached data because the
        // refresh did not land — worth surfacing quietly, never worth blocking.
        setStatus(fromCache ? 'stale' : 'ready');
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [tenantId, nonce]);

  const value = useMemo<CatalogContextValue>(
    () => ({
      index,
      status,
      productCount: index?.size ?? 0,
      refresh: () => {
        setNonce((current) => current + 1);
      },
    }),
    [index, status],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  return useContext(CatalogContext);
}
