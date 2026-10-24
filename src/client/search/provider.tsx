'use client';

/**
 * Serves the index to the counter — ADR-4's "in-memory served".
 *
 * Built once per session and held in memory for the life of the page, because
 * rebuilding a 3,000-product index per render would undo the whole point. The
 * index is deliberately not React state: it is a large immutable object, and
 * putting it through the reconciler buys nothing.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { applyDelta, CatalogIndex, type CatalogPayload, type IndexedProduct } from './catalog-index';
import { loadCatalog, writeCachedCatalog } from './store';

export type IndexStatus = 'loading' | 'ready' | 'stale' | 'unavailable';

interface CatalogContextValue {
  readonly index: CatalogIndex | null;
  readonly status: IndexStatus;
  readonly productCount: number;
  readonly refresh: () => void;
  /**
   * Adds a product the counter just invented — W6's quick item.
   *
   * The product exists locally before the server has heard of it, which is the
   * whole point: the cart line has to render and the next search has to find it
   * while the sale is still happening, disruption or not (ADR-3). The delta is
   * merged into the cached payload with the same `applyDelta` a server refresh
   * uses, so a later refresh reconciles it without special handling — the
   * server will return the same product once its creation is delivered.
   */
  readonly addLocalProduct: (product: IndexedProduct) => void;
}

const CatalogContext = createContext<CatalogContextValue>({
  index: null,
  status: 'loading',
  productCount: 0,
  refresh: () => {},
  addLocalProduct: () => {},
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
  // The payload behind the current index, so a locally-created product can be
  // merged without re-downloading anything.
  const payloadRef = useRef<CatalogPayload | null>(null);

  useEffect(() => {
    cancelled.current = false;

    void (async () => {
      const { payload, fromCache, refreshed } = await loadCatalog(tenantId);
      if (cancelled.current) {
        return;
      }

      payloadRef.current = payload;
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

  const addLocalProduct = useCallback(
    (product: IndexedProduct) => {
      const previous = payloadRef.current;
      if (!previous) {
        return;
      }

      const merged = applyDelta(previous, {
        products: [product],
        removedProductIds: [],
        barcodes: [],
        removedBarcodes: [],
        // Carried forward unchanged: a new product has no stock, and this is
        // not the moment to claim anything about anyone else's.
        stock: previous.stock,
        // The watermark does not move. The product has not been through the
        // server yet, so pretending the counter is caught up to now would make
        // the next incremental refresh skip whatever else changed meanwhile.
        syncedAt: previous.syncedAt,
      });

      payloadRef.current = merged;
      setIndex(CatalogIndex.build(merged));
      void writeCachedCatalog(tenantId, merged);
    },
    [tenantId],
  );

  // Stable, so a consumer can list it as an effect dependency without the
  // refresh it triggers (a new index) re-running the effect that called it.
  const refresh = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  const value = useMemo<CatalogContextValue>(
    () => ({
      index,
      status,
      productCount: index?.size ?? 0,
      refresh,
      addLocalProduct,
    }),
    [index, status, refresh, addLocalProduct],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  return useContext(CatalogContext);
}
