import { createUuidV7, type Entry } from '@bitcoin-basis/engine';

/** Milliseconds inside a UUIDv7 (first 48 bits), or 0 when the id is not one. */
function idMillis(id: string): number {
  const hex = id.slice(0, 8) + id.slice(9, 13);
  return /^[0-9a-f]{12}$/.test(hex) ? parseInt(hex, 16) : 0;
}

/**
 * An id generator for new entries. It never goes behind the newest id already in the book, so a new entry
 * always sorts after the old ones (closed-year checks use id order), even if this device's clock is behind.
 */
export function newIdGenerator(entries: readonly Entry[]): () => string {
  const newest = entries.reduce((m, e) => Math.max(m, idMillis(e.id)), 0);
  return createUuidV7({ now: () => Math.max(Date.now(), newest + 1) });
}

/**
 * The instant a new entry gets. A real book uses the clock; the demo book lives on its own fixed "today",
 * so new demo entries land on that day.
 */
export function entryInstant(isDemo: boolean, today: string): string {
  return isDemo ? `${today}T19:00:00Z` : new Date().toISOString().slice(0, 19) + 'Z';
}
