import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { useVaultOptional } from '../data/vault-provider.tsx';
import { prefersReducedMotion } from './motion.ts';

const MAIN_SCREENS = new Set(['/', '/what-if', '/records', '/tax']);
const THRESHOLD = 64;
const MAX_PULL = 96;
type Phase = 'idle' | 'pulling' | 'ready' | 'checking' | 'done';

/**
 * Phone only: Chrome's own pull-to-refresh is switched off (`overscroll-behavior-y: contain`, it reloads the page and
 * drops the keys), and pulling down from the top of a main screen checks for changes instead.
 * Sheets, sliders and the chart scrub keep their own drags.
 */
export function PullToSync() {
  const vault = useVaultOptional();
  const { isDemo } = useLedger();
  const { pathname } = useLocation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [pull, setPull] = useState(0);
  const enabled = MAIN_SCREENS.has(pathname);
  const state = useRef({ y0: 0, x0: 0, on: false, pull: 0, phase: 'idle' as Phase });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const s = state.current;
    const set = (p: Phase) => {
      s.phase = p;
      setPhase(p);
    };
    const own = (t: EventTarget | null) => t instanceof Element && t.closest('[role="dialog"], [role="slider"], input[type="range"], [data-no-pull]') !== null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      s.on = false;
      if (e.touches.length !== 1 || t === undefined || s.phase === 'checking' || window.scrollY > 0 || document.querySelector('[role="dialog"]') !== null || own(e.target)) return;
      s.y0 = t.clientY;
      s.x0 = t.clientX;
      s.pull = 0;
      s.on = true;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!s.on || t === undefined) return;
      const dy = t.clientY - s.y0;
      if (dy <= 0 || window.scrollY > 0 || Math.abs(t.clientX - s.x0) > dy) {
        if (s.pull > 0) {
          s.pull = 0;
          setPull(0);
          set('idle');
        }
        if (dy <= 0) s.on = dy === 0;
        return;
      }
      s.pull = Math.min(MAX_PULL, dy * 0.5);
      setPull(s.pull);
      const next = s.pull >= THRESHOLD ? 'ready' : 'pulling';
      if (next !== s.phase) set(next);
    };
    const onEnd = () => {
      if (!s.on) return;
      s.on = false;
      if (s.phase !== 'ready') {
        s.pull = 0;
        setPull(0);
        set('idle');
        return;
      }
      set('checking');
      setPull(THRESHOLD * 0.7);
      void (async () => {
        if (vault !== null && !isDemo) await vault.sync().catch(() => undefined);
        else await new Promise((r) => setTimeout(r, 600));
        set('done');
        timer.current = setTimeout(() => {
          setPull(0);
          set('idle');
        }, 1200);
      })();
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [enabled, vault, isDemo]);

  if (!enabled || phase === 'idle') return null;
  const calm = prefersReducedMotion();
  const text = phase === 'checking' ? 'Checking for changes…' : phase === 'done' ? 'Up to date' : phase === 'ready' ? 'Let go to check' : 'Pull to check for changes';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pull-to-sync"
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
      style={{ transform: `translateY(${Math.max(8, pull - 28)}px)`, transition: calm || phase === 'pulling' || phase === 'ready' ? 'none' : 'transform 200ms ease-out' }}
    >
      <span className="flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold text-soft shadow-fab">
        {phase === 'checking' && <span aria-hidden="true" className={`size-3.5 rounded-full border-2 border-accent border-t-transparent ${calm ? '' : 'animate-spin'}`} />}
        {text}
      </span>
    </div>
  );
}
