/**
 * The phone's back gesture (Android) closes the top sheet instead of leaving the page. Uses the browser's
 * CloseWatcher, made for exactly this: no history entries, so Back never lands on a dead step and nothing
 * races with navigation. Browsers without it keep their usual Back; Esc and the Close button always work.
 */

interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}

/** Call when a sheet opens; call the returned function when it closes or unmounts. */
export function trackSheet(close: () => void): () => void {
  const Ctor = typeof window === 'undefined' ? undefined : (window as unknown as { CloseWatcher?: new () => CloseWatcherLike }).CloseWatcher;
  if (typeof Ctor !== 'function') return () => {};
  let watcher: CloseWatcherLike;
  try {
    watcher = new Ctor();
  } catch {
    return () => {};
  }
  watcher.onclose = () => close();
  return () => watcher.destroy();
}
