/**
 * Local storage for the vault: IndexedDB database `bitcoin-basis` with stores `vault`, `blobs`
 * and `outbox` (docs/sync-protocol.md, "On the device"). Every value is ciphertext or public
 * metadata; plaintext is never written here.
 *
 * `VaultDb` is a small key-value interface so the vault logic runs on the in-memory adapter in
 * tests (no `fake-indexeddb` dependency).
 */
import { VaultError } from './errors.ts';

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

/** How long an open may wait (e.g. blocked by another window of the app) before it is reported. */
export const OPEN_TIMEOUT_MS = 10_000;
/** Backstop for one transaction (another window holding a long one, a wedged connection). */
export const TX_TIMEOUT_MS = 30_000;

export interface OpenOptions {
  readonly openTimeoutMs?: number;
  readonly txTimeoutMs?: number;
}

const blocked = (why: string, cause?: unknown) => new VaultError('storage-blocked', why, cause === undefined ? undefined : { cause });

/** One `indexedDB.open`, never hanging: a blocked or silent open rejects with `storage-blocked` after `ms`. */
function openConnection(name: string, factory: IDBFactory, ms: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      reject(e);
    };
    const timer = globalThis.setTimeout(() => fail(blocked('IndexedDB did not open in time; another window of this app may be holding it')), ms);
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, DB_VERSION);
    } catch (e) {
      fail(blocked('IndexedDB is not available', e));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORE_NAMES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onerror = () => fail(req.error ?? new Error('could not open IndexedDB'));
    // Another window holds an older version open. Wait (it is asked to close) until the timeout.
    req.onblocked = () => undefined;
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close(); // too late: the caller already gave up
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(db);
    };
  });
}

/**
 * Open (and create or upgrade) the IndexedDB database. A connection another window asks to close
 * (`versionchange`) is closed at once, and reopened on the next use; an open that is blocked or
 * silent rejects with `storage-blocked` instead of hanging.
 */
export async function openIndexedDb(name: string = DB_NAME, factory: IDBFactory = indexedDB, options: OpenOptions = {}): Promise<VaultDb> {
  const openMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS;
  const txMs = options.txTimeoutMs ?? TX_TIMEOUT_MS;
  let current: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  const adopt = (db: IDBDatabase) => {
    const drop = () => {
      if (current === db) current = null;
    };
    db.onversionchange = () => {
      drop();
      db.close();
    };
    db.onclose = drop;
    current = db;
    return db;
  };
  const connection = (): Promise<IDBDatabase> => {
    if (current !== null) return Promise.resolve(current);
    opening ??= openConnection(name, factory, openMs)
      .then(adopt)
      .finally(() => {
        opening = null;
      });
    return opening;
  };
  await connection();
  return wrap(connection, txMs, () => {
    current?.close();
    current = null;
  });
}

function wrap(connection: () => Promise<IDBDatabase>, txMs: number, close: () => void): VaultDb {
  /** A transaction; a connection that was closed under us (another window, the browser) is reopened once. */
  async function begin(stores: readonly StoreName[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    for (let tries = 0; ; tries++) {
      const db = await connection();
      try {
        return db.transaction(stores as StoreName[], mode);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'InvalidStateError')) throw e;
        close();
        if (tries > 0) throw blocked('the IndexedDB connection was closed', e);
      }
    }
  }
  async function tx<T>(stores: readonly StoreName[], mode: IDBTransactionMode, run: (t: IDBTransaction) => () => T): Promise<T> {
    const t = await begin(stores, mode);
    return new Promise<T>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        try {
          t.abort();
        } catch {
          // already finished
        }
        reject(blocked('an IndexedDB transaction did not finish in time'));
      }, txMs);
      const result = run(t);
      t.oncomplete = () => {
        globalThis.clearTimeout(timer);
        resolve(result());
      };
      t.onerror = () => {
        globalThis.clearTimeout(timer);
        reject(t.error ?? new Error('IndexedDB transaction failed'));
      };
      t.onabort = () => {
        globalThis.clearTimeout(timer);
        reject(t.error ?? new Error('IndexedDB transaction aborted'));
      };
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
    close,
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
