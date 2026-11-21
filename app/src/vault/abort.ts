/**
 * Small helpers so nothing the vault waits for can hang forever: every wait is raced against an
 * `AbortSignal` and, where it talks to something outside the page, a timeout.
 */

/** A controller that aborts when any of `parents` does (or right away if one already has). */
export function linkedController(...parents: readonly (AbortSignal | null | undefined)[]): AbortController {
  const ctrl = new AbortController();
  for (const p of parents) {
    if (p === null || p === undefined) continue;
    if (p.aborted) {
      ctrl.abort(p.reason);
      break;
    }
    p.addEventListener('abort', () => ctrl.abort(p.reason), { once: true, signal: ctrl.signal });
  }
  return ctrl;
}

/**
 * `p`, unless `signal` aborts first: then rejects with `reason()`. The work behind `p` may go on,
 * but nobody waits for it any more (callers check the signal before acting on a late result).
 */
export function raceAbort<T>(p: Promise<T>, signal: AbortSignal | null | undefined, reason: () => unknown): Promise<T> {
  if (signal === null || signal === undefined) return p;
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.reject(reason());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(reason());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** `p`, or reject with `reason()` after `ms` (a backstop for calls that may never settle). */
export function withTimeout<T>(p: Promise<T>, ms: number, reason: () => unknown): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(reason()), ms);
    p.then(
      (v) => {
        globalThis.clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        globalThis.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Resolves `true` when `p` settles, `false` after `ms` or on abort, whichever is first. Never rejects. */
export function settleWithin(p: Promise<unknown>, ms: number, signal?: AbortSignal | null): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = globalThis.setTimeout(() => resolve(false), ms);
    const done = (settled: boolean) => () => {
      globalThis.clearTimeout(timer);
      resolve(settled);
    };
    signal?.addEventListener('abort', done(false), { once: true });
    p.then(done(true), done(true));
  });
}

/** Read `signal.aborted` afresh (TypeScript narrows a property read across an `await`). */
export function isAborted(signal: AbortSignal | null | undefined): boolean {
  return signal?.aborted === true;
}
