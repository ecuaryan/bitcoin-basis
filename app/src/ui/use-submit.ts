import { useCallback, useEffect, useRef, useState } from 'react';
import { explainError } from '../data/explain-error.ts';
import { useToastIfAny } from './Toast.tsx';

/**
 * Run a save once at a time. While it is in flight `busy` is true (disable the button and say "Saving…")
 * and any further call is ignored, so a double tap on a slow connection cannot save twice.
 * A save that fails says why in a toast (the records locked, the browser's storage refused it), so the
 * button never just comes back with nothing said. A save that handles its own errors never reaches this.
 */
export function useSubmit<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): { run: (...args: A) => Promise<void>; busy: boolean } {
  const fnRef = useRef(fn);
  const locked = useRef(false);
  const alive = useRef(true);
  const toast = useToastIfAny();
  const toastRef = useRef(toast);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fnRef.current = fn;
    toastRef.current = toast;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (...args: A) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await fnRef.current(...args);
    } catch (e) {
      const t = toastRef.current;
      if (t === null) throw e;
      t.show(`Not saved. ${explainError(e)}`);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);
  return { run, busy };
}
