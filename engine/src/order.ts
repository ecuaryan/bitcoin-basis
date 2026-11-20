/** Deterministic orderings shared by replay, pick helpers and exports. */
import { instantMs } from './dates.ts';
import type { Entry, Lot } from './types.ts';

/** Code-unit string order (locale-independent). UUIDv7 ids compare in creation order. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Replay order: the entry's own time, then id. */
export function compareEntries(a: Entry, b: Entry): number {
  return instantMs(a.at) - instantMs(b.at) || compareStrings(a.id, b.id);
}

/** Oldest first: acquired local date, then acquired instant, then lot id. */
export function compareLotsOldestFirst(a: Lot, b: Lot): number {
  return compareStrings(a.acquiredDate, b.acquiredDate) || instantMs(a.acquiredAt) - instantMs(b.acquiredAt) || compareStrings(a.id, b.id);
}
