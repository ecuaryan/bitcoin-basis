/** Screens that save a moment after the last change register a flush here, so Lock can finish them first. */
const flushers = new Set<() => Promise<void>>();

export function registerFlush(fn: () => Promise<void>): () => void {
  flushers.add(fn);
  return () => void flushers.delete(fn);
}

export async function flushPendingSaves(): Promise<void> {
  await Promise.all([...flushers].map((f) => f().catch(() => undefined)));
}

// Leaving the app (switching apps, closing the tab) finishes pending saves right away: timers stop
// in the background, and the app may lock before it comes back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPendingSaves();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushPendingSaves());
}
