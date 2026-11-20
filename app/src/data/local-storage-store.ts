import { parseEntry, type Entry } from '@bitcoin-basis/engine';
import type { LedgerStore } from './ledger-store.ts';

const KEY = 'bb.ledger.v1';

/**
 * In-memory ledger persisted to localStorage as plain JSON.
 *
 * Step 2 only: nothing here is encrypted, so only the synthetic demo book may be stored.
 * Step 3 replaces this with encrypted IndexedDB.
 */
export function createLocalStorageStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage, key = KEY): LedgerStore {
  const listeners = new Set<() => void>();
  let entries: Entry[] = load();

  function load(): Entry[] {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: Entry[] = [];
      for (const item of parsed) {
        const r = parseEntry(item);
        if (r.ok) out.push(r.value);
      }
      return out;
    } catch {
      return [];
    }
  }

  function save(): void {
    try {
      storage.setItem(key, JSON.stringify(entries));
    } catch {
      // Storage full or blocked: keep working in memory.
    }
  }

  function notify(): void {
    for (const l of [...listeners]) l();
  }

  // Another tab changed the book.
  if (typeof window !== 'undefined' && storage === window.localStorage) {
    window.addEventListener('storage', (e) => {
      if (e.key !== key) return;
      entries = load();
      notify();
    });
  }

  return {
    list: () => Promise.resolve(entries),
    append(add) {
      const have = new Set(entries.map((e) => e.id));
      const fresh = add.filter((e) => !have.has(e.id));
      if (fresh.length === 0) return Promise.resolve();
      entries = [...entries, ...fresh];
      save();
      notify();
      return Promise.resolve();
    },
    clear() {
      entries = [];
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
      notify();
      return Promise.resolve();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** A store that keeps nothing between page loads. For tests. */
export function createMemoryStore(initial: readonly Entry[] = []): LedgerStore {
  const data = new Map<string, string>();
  data.set(KEY, JSON.stringify(initial));
  return createLocalStorageStore(
    { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) },
    KEY,
  );
}
