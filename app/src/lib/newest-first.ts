/** A copy of `list`, newest first by its `YYYY-MM-DD` (or ISO) date: lists show the latest at the top. Stable for equal dates. */
export function newestFirst<T>(list: readonly T[], dateOf: (item: T) => string): T[] {
  return list
    .map((item, i) => ({ item, i, d: dateOf(item) }))
    .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? 1 : -1))
    .map((x) => x.item);
}
