import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

// Where each page was scrolled to, kept in memory for the session (never stored). The page itself scrolls (the
// window, on phone and desktop), so everything here reads and writes window.scrollY.
const byEntry = new Map<string, number>(); // one history entry: Back and Forward return here
const byTab = new Map<string, number>(); // one main tab: switching tabs returns here

const TABS = new Set(['/', '/what-if', '/tax', '/records', '/settings']);
const RESTORE_GIVE_UP_MS = 1500;

/** A tab's own page. Records views (`?v=entries`) are drill-ins, so they are not the tab. */
function isTabPage(pathname: string, search: string): boolean {
  return TABS.has(pathname) && (search === '' || pathname !== '/records');
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Scroll the way the platform does: tabs remember their own place, tapping the current tab goes back to the top
 * (smoothly), a new page starts at the top, and Back returns to where you were.
 */
export function useScrollBehavior(): void {
  const { key, pathname, search, hash } = useLocation();
  const type = useNavigationType();
  const here = useRef({ key, pathname, search });
  const prev = useRef<{ key: string; pathname: string; search: string } | null>(null);
  const settling = useRef(false);
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const onScroll = () => {
      if (settling.current) return;
      const y = window.scrollY;
      const h = here.current;
      byEntry.set(h.key, y);
      if (isTabPage(h.pathname, h.search)) byTab.set(h.pathname, y);
    };
    // Someone grabbing the page ends any waiting to restore.
    const onUser = () => stop.current();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onUser, { passive: true });
    window.addEventListener('touchstart', onUser, { passive: true });
    window.addEventListener('keydown', onUser);
    return () => {
      window.history.scrollRestoration = previous;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', onUser);
      window.removeEventListener('touchstart', onUser);
      window.removeEventListener('keydown', onUser);
    };
  }, []);

  useLayoutEffect(() => {
    const before = prev.current;
    here.current = { key, pathname, search };
    prev.current = { key, pathname, search };
    if (before === null || before.key === key) return;
    stop.current();

    /** Go to `y`; if the page is not tall enough yet (still loading), wait for it. */
    const restore = (y: number) => {
      if (y <= 0) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
      }
      settling.current = true;
      const started = performance.now();
      let raf = 0;
      const finish = () => {
        cancelAnimationFrame(raf);
        settling.current = false;
        stop.current = () => undefined;
        byEntry.set(key, window.scrollY);
        if (isTabPage(pathname, search)) byTab.set(pathname, window.scrollY);
      };
      stop.current = finish;
      const tick = () => {
        const room = document.documentElement.scrollHeight - window.innerHeight;
        if (room >= y - 1 || performance.now() - started > RESTORE_GIVE_UP_MS) {
          window.scrollTo({ top: y, behavior: 'instant' });
          finish();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    };

    const samePage = before.pathname === pathname && before.search === search;
    if (type === 'POP') {
      restore(byEntry.get(key) ?? 0);
    } else if (type === 'REPLACE' && samePage) {
      // Tapping the tab you are on (a link to the page you are on replaces it): back to the top.
      byEntry.set(key, 0);
      if (isTabPage(pathname, search)) byTab.set(pathname, 0);
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reducedMotion() ? 'instant' : 'smooth' });
    } else if (type === 'REPLACE' && before.pathname === pathname) {
      // The same page tidying its own address: keep the place.
      byEntry.set(key, byEntry.get(before.key) ?? window.scrollY);
    } else if (hash !== '') {
      // The page scrolls to its own anchor.
    } else if (isTabPage(pathname, search)) {
      restore(byTab.get(pathname) ?? 0);
    } else {
      restore(0);
    }
  }, [key, pathname, search, hash, type]);
}
