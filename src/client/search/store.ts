'use client';

/**
 * Index persistence — ADR-4's "IndexedDB-backed, in-memory served".
 *
 * The cache is what makes a 3,000-product catalog affordable to open. Without
 * it, every session start pays a full download before the first keystroke works;
 * with it, a returning counter reads from disk and asks the server only for what
 * changed since its watermark.
 *
 * It is also the groundwork for Day 5: ADR-3's offline sale path needs local
 * product data, and this is where that data already lives.
 *
 * Written against raw IndexedDB rather than a wrapper library — one object store
 * holding one record does not justify a dependency in the money path (P6,
 * Phase 12 §5).
 */

import { applyDelta, type CatalogDelta, type CatalogPayload } from './catalog-index';

const DATABASE_NAME = 'mehvar-catalog';
const DATABASE_VERSION = 1;
const STORE = 'payload';

/** One cache per tenant: a shared counter machine must not blend catalogs. */
function keyFor(tenantId: string): string {
  return `catalog:${tenantId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Could not open the catalog cache'));
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = body(transaction.objectStore(STORE));
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Catalog cache request failed'));
      };
    });
  } finally {
    database.close();
  }
}

/**
 * Reads the cached payload.
 *
 * Any failure returns undefined rather than throwing. A corrupt or unavailable
 * cache must degrade to "fetch it all again", never to a counter that cannot
 * search — private browsing, a full disk and a locked profile are all real, and
 * none of them may stop a sale (P2).
 */
export async function readCachedCatalog(tenantId: string): Promise<CatalogPayload | undefined> {
  try {
    return await withStore<CatalogPayload | undefined>('readonly', (store) =>
      store.get(keyFor(tenantId)),
    );
  } catch {
    return undefined;
  }
}

export async function writeCachedCatalog(tenantId: string, payload: CatalogPayload): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(payload, keyFor(tenantId)));
  } catch {
    // Same posture: a cache that cannot be written is slower, not broken.
  }
}

export async function clearCachedCatalog(tenantId: string): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(keyFor(tenantId)));
  } catch {
    // Ignored deliberately.
  }
}

interface SnapshotResponse extends CatalogDelta {
  readonly removedProductIds: string[];
}

/**
 * Brings the cache up to date and returns the payload to index.
 *
 * Incremental when a watermark exists, whole otherwise. A failed refresh returns
 * the cached payload rather than nothing: the catalog the counter had a minute
 * ago is far better than an empty search box, and ADR-4 already accepts that
 * index staleness is bounded and harmless because prices are confirmed at commit.
 */
export async function loadCatalog(
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ payload: CatalogPayload; fromCache: boolean; refreshed: boolean }> {
  const cached = await readCachedCatalog(tenantId);

  try {
    const url = cached
      ? `/api/catalog?since=${encodeURIComponent(cached.syncedAt)}`
      : '/api/catalog';
    const response = await fetchImpl(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Catalog request failed: ${response.status}`);
    }

    const snapshot = (await response.json()) as SnapshotResponse;
    const payload: CatalogPayload = cached
      ? applyDelta(cached, snapshot)
      : {
          products: snapshot.products,
          barcodes: snapshot.barcodes,
          stock: snapshot.stock,
          syncedAt: snapshot.syncedAt,
        };

    await writeCachedCatalog(tenantId, payload);
    return { payload, fromCache: false, refreshed: true };
  } catch {
    if (cached) {
      return { payload: cached, fromCache: true, refreshed: false };
    }
    return {
      payload: { products: [], barcodes: [], stock: {}, syncedAt: new Date(0).toISOString() },
      fromCache: false,
      refreshed: false,
    };
  }
}
