/**
 * Small things that belong to the unlocked session and are never written to storage: saved What-if scenarios. They are gone when the app locks (or the page reloads).
 */
const mem = new Map<string, unknown>();

export const sessionMemory = {
  get<T>(key: string, fallback: T): T {
    return mem.has(key) ? (mem.get(key) as T) : fallback;
  },
  set(key: string, value: unknown): void {
    mem.set(key, value);
  },
  clear(): void {
    mem.clear();
  },
};

/** Keys older versions wrote to localStorage that must never stay there (they held financial data). */
const LEGACY_KEYS = ['bb.ledger.v1', 'bb.demo', 'bb.borrow.scenarios', 'bb.1099.checked'] as const;

/** Called once on load: remove anything sensitive an older version left in localStorage. */
export function purgeLegacyStorage(storage: Pick<Storage, 'removeItem'> = window.localStorage): void {
  for (const k of LEGACY_KEYS) {
    try {
      storage.removeItem(k);
    } catch {
      // Storage blocked: nothing to remove.
    }
  }
}
