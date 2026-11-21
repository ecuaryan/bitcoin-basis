import { useEffect, useRef, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

// The count-up plays once per visit. Later screens, and a window resize that swaps the layout, show the number straight away.
let countUpPlayed = false;

/** Counts a whole number up to `target` from 0, once per visit. Jumps straight there under reduced motion, and never leaves the range between start and end. */
export function useCountUp(target: number, enabled = true, durationMs = 800): number {
  const reduce = prefersReducedMotion();
  const [replay] = useState(() => !countUpPlayed);
  const skip = !enabled || reduce || !replay;
  const [shown, setShown] = useState<number>(skip ? target : 0);
  const from = useRef(shown);

  useEffect(() => {
    if (skip) return;
    const start = from.current;
    if (start === target) return;
    countUpPlayed = true;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(start + (target - start) * eased);
      const clamped = Math.min(Math.max(value, Math.min(start, target)), Math.max(start, target));
      from.current = clamped;
      setShown(clamped);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, skip, durationMs]);

  return skip ? target : shown;
}

/** Tracks a CSS media query (for the phone / desktop layouts). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
