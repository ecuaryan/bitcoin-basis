/**
 * Local storage for the vault: IndexedDB database `bitcoin-basis` with stores `vault`, `blobs`
 * and `outbox` (docs/sync-protocol.md, "On the device"). Every value is ciphertext or public
 * metadata; plaintext is never written here.
 *
 * `VaultDb` is a small key-value interface so the vault logic runs on the in-memory adapter in
 * tests (no `fake-indexeddb` dependency).
 */

export type StoreName = 'vault' | 'blobs' | 'outbox';
export const STORE_NAMES: readonly StoreName[] = ['vault', 'blobs', 'outbox'];
export const DB_NAME = 'bitcoin-basis';
const DB_VERSION = 1;

export type DbOp =
  | { readonly type: 'put'; readonly store: StoreName; readonly key: string; readonly value: unknown }
  | { readonly type: 'delete'; readonly store: StoreName; readonly key: string }
  /** Read-modify-write inside the same transaction. `fn` must be synchronous. */
  | { readonly type: 'update'; readonly store: StoreName; readonly key: string; readonly fn: (old: unknown) => unknown };

export interface VaultDb {
  get(store: StoreName, key: string): Promise<unknown>;
  /** Every `[key, value]` in ascending key order. */
  entries(store: StoreName): Promise<[string, unknown][]>;
  keys(store: StoreName): Promise<string[]>;
  /** Apply all ops atomically (one transaction). */
  write(ops: readonly DbOp[]): Promise<void>;
  /** Delete everything (forget this device). */
  clear(): Promise<void>;
  close(): void;
}

/** Open (and create or upgrade) the IndexedDB database. */
export function openIndexedDb(name: string = DB_NAME, factory: IDBFactory = indexedDB): Promise<VaultDb> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORE_NAMES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onerror = () => reject(req.error ?? new Error('could not open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: let it proceed.
      db.onversionchange = () => db.close();
      resolve(wrap(db));
    };
  });
}

function wrap(db: IDBDatabase): VaultDb {
  function tx<T>(stores: readonly StoreName[], mode: IDBTransactionMode, run: (t: IDBTransaction) => () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(stores as StoreName[], mode);
      const result = run(t);
      t.oncomplete = () => resolve(result());
      t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
    });
  }
  return {
    get: (store, key) =>
      tx([store], 'readonly', (t) => {
        const r = t.objectStore(store).get(key);
        return () => r.result as unknown;
      }),
    entries: (store) =>
      tx([store], 'readonly', (t) => {
        const s = t.objectStore(store);
        const ks = s.getAllKeys();
        const vs = s.getAll();
        return () => (ks.result as string[]).map((k, i): [string, unknown] => [k, vs.result[i] as unknown]);
      }),
    keys: (store) =>
      tx([store], 'readonly', (t) => {
        const r = t.objectStore(store).getAllKeys();
        return () => r.result as string[];
      }),
    write: (ops) => {
      if (ops.length === 0) return Promise.resolve();
      const stores = [...new Set(ops.map((o) => o.store))];
      return tx(stores, 'readwrite', (t) => {
        for (const op of ops) {
          const s = t.objectStore(op.store);
          if (op.type === 'put') s.put(op.value, op.key);
          else if (op.type === 'delete') s.delete(op.key);
          else {
            const r = s.get(op.key);
            r.onsuccess = () => s.put(op.fn(r.result as unknown), op.key);
          }
        }
        return () => undefined;
      });
    },
    clear: () =>
      tx(STORE_NAMES, 'readwrite', (t) => {
        for (const s of STORE_NAMES) t.objectStore(s).clear();
        return () => undefined;
      }),
    close: () => db.close(),
  };
}

/** In-memory `VaultDb` with IndexedDB's copy semantics (values are structured-cloned in and out). */
export interface MemoryDb extends VaultDb {
  /** Every stored value, for tests that scan for plaintext. */
  dump(): { store: StoreName; key: string; value: unknown }[];
}

export function createMemoryDb(): MemoryDb {
  const data = new Map<StoreName, Map<string, unknown>>(STORE_NAMES.map((s) => [s, new Map()]));
  const storeOf = (s: StoreName) => data.get(s) as Map<string, unknown>;
  const sorted = (s: StoreName) => [...storeOf(s).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    get: (store, key) => Promise.resolve(structuredClone(storeOf(store).get(key))),
    entries: (store) => Promise.resolve(sorted(store).map(([k, v]): [string, unknown] => [k, structuredClone(v)])),
    keys: (store) => Promise.resolve(sorted(store).map(([k]) => k)),
    write(ops) {
      // Stage on copies so a throwing op leaves nothing half-applied.
      const staged = new Map(STORE_NAMES.map((s) => [s, new Map(storeOf(s))]));
      for (const op of ops) {
        const s = staged.get(op.store) as Map<string, unknown>;
        if (op.type === 'put') s.set(op.key, structuredClone(op.value));
        else if (op.type === 'delete') s.delete(op.key);
        else s.set(op.key, structuredClone(op.fn(structuredClone(s.get(op.key)))));
      }
      for (const [k, v] of staged) data.set(k, v);
      return Promise.resolve();
    },
    clear() {
      for (const s of STORE_NAMES) storeOf(s).clear();
      return Promise.resolve();
    },
    close() {},
    dump: () => STORE_NAMES.flatMap((store) => [...storeOf(store).entries()].map(([key, value]) => ({ store, key, value }))),
  };
}
