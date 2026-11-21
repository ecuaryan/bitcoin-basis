import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run a save once at a time. While it is in flight `busy` is true (disable the button and say "Saving…")
 * and any further call is ignored, so a double tap on a slow connection cannot save twice.
 */
export function useSubmit<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): { run: (...args: A) => Promise<void>; busy: boolean } {
  const fnRef = useRef(fn);
  const locked = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fnRef.current = fn;
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
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);
  return { run, busy };
}
