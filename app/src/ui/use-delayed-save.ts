import { useCallback, useEffect, useRef } from 'react';
import { registerFlush } from '../lib/pending-saves.ts';

/**
 * Save a moment after the last change. `later(value)` restarts the wait; the newest value is saved when it runs out,
 * when the screen is left, and when the app is locked. `run` always sees the latest props and state.
 */
export function useDelayedSave<T>(run: (value: T) => Promise<void>, delayMs: number): (value: T) => void {
  const runRef = useRef(run);
  const waiting = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    runRef.current = run;
  });
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const w = waiting.current;
    waiting.current = null;
    if (w !== null) await runRef.current(w.value);
  }, []);
  useEffect(() => {
    const off = registerFlush(flush);
    return () => {
      off();
      void flush();
    };
  }, [flush]);
  return useCallback(
    (value: T) => {
      waiting.current = { value };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [flush, delayMs],
  );
}
