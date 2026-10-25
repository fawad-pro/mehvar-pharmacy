'use client';

/**
 * The outbox — ADR-3's local queue.
 *
 *   "These commit locally (IndexedDB, client-generated IDs) and sync
 *    automatically on reconnect, idempotently."
 *
 * This is the most consequential piece of client code in the product, because
 * it is the only thing standing between a sale and a lost sale. Everything
 * about it is arranged around one promise: **once `enqueue` resolves, the sale
 * survives the machine losing power.** The receipt prints after that resolve
 * and never before.
 *
 * That promise is why the write helper waits for the transaction to *complete*
 * rather than for the request to succeed. An IndexedDB request succeeding means
 * the value is staged; the transaction completing means it is durable. The
 * difference is invisible in every test and decisive in a power cut.
 *
 * Ordering is the store's own auto-increment key. FIFO delivery is load-bearing
 * (a quick item must land before the sale that references it), and a timestamp
 * would tie for two records captured in the same millisecond.
 *
 * Written against raw IndexedDB for the same reason `search/store.ts` is: one
 * object store does not justify a dependency in the money path (P6).
 */

import type { CapturedRecord, OutboxRecord, StoredRecord } from './records';
import { retryRead } from './flush';
import { recordId } from './records';

const DATABASE_NAME = 'mehvar-sync';
const DATABASE_VERSION = 1;
const STORE = 'outbox';
const ID_INDEX = 'by_id';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        // autoIncrement supplies the monotonic sequence; the domain id is a
        // unique index so a double-enqueue of the same sale is impossible even
        // before the server's idempotency gets a chance to be tested.
        const store = request.result.createObjectStore(STORE, { autoIncrement: true });
        store.createIndex(ID_INDEX, 'id', { unique: true });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Could not open the outbox'));
    };
  });
}

/**
 * Runs a unit of work and resolves only once the transaction has committed.
 *
 * `body` returns the value the caller wants; the promise waits on
 * `transaction.oncomplete`, so a resolved promise means the data is on disk.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      let value: T;
      let settled = false;

      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      transaction.onerror = () => {
        if (!settled) {
          settled = true;
          reject(transaction.error ?? new Error('Outbox transaction failed'));
        }
      };
      transaction.onabort = () => {
        if (!settled) {
          settled = true;
          reject(transaction.error ?? new Error('Outbox transaction aborted'));
        }
      };

      void (async () => {
        try {
          value = await body(transaction.objectStore(STORE));
        } catch (error) {
          if (!settled) {
            settled = true;
            reject(error);
          }
          try {
            transaction.abort();
          } catch {
            // Already finishing; nothing to do.
          }
        }
      })();
    });
  } finally {
    database.close();
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Outbox request failed'));
    };
  });
}

/**
 * Durably queues a captured record.
 *
 * Throws on failure, and is the one place in the sync layer that does. Every
 * other operation degrades quietly, because a slow or unavailable outbox costs
 * a retry; a *silent* enqueue failure would cost a sale, and the caller must
 * be able to refuse to print a receipt it cannot stand behind.
 */
export async function enqueue(
  tenantId: string,
  captured: CapturedRecord,
  now: Date = new Date(),
): Promise<OutboxRecord> {
  const record = {
    ...captured,
    id: recordId(captured),
    tenantId,
    queuedAt: now.toISOString(),
    capturedOffline: typeof navigator !== 'undefined' && !navigator.onLine,
    attempts: 0,
  } as OutboxRecord;

  await withStore('readwrite', (store) => promisify(store.add(record)));
  return record;
}

/**
 * Everything still waiting, oldest first.
 *
 * Scoped to the tenant: a shared counter machine that switched pharmacies must
 * not deliver one tenant's sales under another's session.
 */
export async function pendingRecords(tenantId: string): Promise<StoredRecord[] | null> {
  // Null, not empty, when the outbox cannot be read: "nothing queued" would
  // set the badge to zero over records still on disk. See `retryRead`.
  return retryRead(() => readPending(tenantId));
}

async function readPending(tenantId: string): Promise<StoredRecord[]> {
  return withStore('readonly', async (store) => {
    const [keys, values] = await Promise.all([
      promisify(store.getAllKeys()),
      promisify(store.getAll() as IDBRequest<OutboxRecord[]>),
    ]);
    const stored: StoredRecord[] = [];
    for (const [position, value] of values.entries()) {
      const key = keys[position];
      if (typeof key === 'number' && value.tenantId === tenantId) {
        stored.push({ sequence: key, record: value });
      }
    }
    return stored.sort((a, b) => a.sequence - b.sequence);
  });
}

/** Removes a delivered record. Called only after the server confirmed it landed. */
export async function removeRecord(sequence: number): Promise<void> {
  try {
    await withStore('readwrite', (store) => promisify(store.delete(sequence)));
  } catch {
    // Worst case the record delivers again, which is exactly what the
    // client-id idempotency exists to make harmless (ADR-3).
  }
}

/** Records an attempt that did not land, so backoff and visibility have something to read. */
export async function markAttempted(
  sequence: number,
  error: string | undefined,
): Promise<void> {
  try {
    await withStore('readwrite', async (store) => {
      const existing = await promisify(store.get(sequence) as IDBRequest<OutboxRecord | undefined>);
      if (!existing) {
        return;
      }
      const updated: OutboxRecord = {
        ...existing,
        attempts: existing.attempts + 1,
        ...(error === undefined ? {} : { lastError: error }),
      };
      await promisify(store.put(updated, sequence));
    });
  } catch {
    // Bookkeeping only; a failure here costs an accurate attempt count, not a record.
  }
}

/** Replaces a record's payload in place — used when a receipt number has to be re-minted. */
export async function replaceRecord(sequence: number, record: OutboxRecord): Promise<void> {
  await withStore('readwrite', (store) => promisify(store.put(record, sequence)));
}
