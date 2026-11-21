import type { Entry } from '@bitcoin-basis/engine';
import type { LedgerStore } from './ledger-store.ts';

/**
 * A ledger that lives only in this page. The demo book uses it: nothing is ever written to storage, so a reload
 * (or closing the tab) starts the demo fresh.
 */
export function createMemoryStore(initial: readonly Entry[] = []): LedgerStore {
  const listeners = new Set<() => void>();
  let entries: Entry[] = [...initial];
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    list: () => Promise.resolve(entries),
    append(add) {
      const have = new Set(entries.map((e) => e.id));
      const fresh = add.filter((e) => !have.has(e.id));
      if (fresh.length === 0) return Promise.resolve();
      entries = [...entries, ...fresh];
      notify();
      return Promise.resolve();
    },
    clear() {
      entries = [];
      notify();
      return Promise.resolve();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
