import type { Entry } from '@bitcoin-basis/engine';

/**
 * Where entries live. Deliberately narrow and async: Step 3 swaps the implementation for
 * encrypted IndexedDB plus sync without touching any screen.
 *
 * Entries are append-only. Edits and deletes are new entries that `replaces` an older one.
 */
export interface LedgerStore {
  /** Every entry, in the order they were appended. */
  list(): Promise<readonly Entry[]>;
  /** Add entries. Entries already stored (same id) are ignored. */
  append(entries: readonly Entry[]): Promise<void>;
  /** Remove everything (used to leave demo mode). */
  clear(): Promise<void>;
  /** Optional: false while the local copy is still loading (or locked); `list()` is then not the book. */
  isLoaded?(): boolean;
  /** Called after any change, including changes from another tab. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
