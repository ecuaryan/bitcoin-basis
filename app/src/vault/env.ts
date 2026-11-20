/** Injectable time and messaging, so tests control the clock. */

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The slice of `BroadcastChannel` used to tell other tabs that local storage changed. */
export interface BroadcastLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

/** A `BroadcastChannel` in browsers, else `null`. */
export function defaultChannel(): BroadcastLike | null {
  return typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bitcoin-basis') : null;
}

/** Random float in [0, 1) from `crypto.getRandomValues` (for retry jitter). */
export function randomUnit(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;
}
