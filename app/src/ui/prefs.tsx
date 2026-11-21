import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** How BTC amounts are shown: BTC, then sats, then USD (needs a price). Tap any amount to cycle. */
export type Unit = 'btc' | 'sats' | 'usd';
const UNITS: readonly Unit[] = ['btc', 'sats', 'usd'];

export interface Prefs {
  /** Amounts are hidden (off by default; only the user turns it on). */
  hidden: boolean;
  /** Hidden amounts are showing right now because someone is holding. */
  peeking: boolean;
  /** What the amounts look like right now: hidden and not peeking. */
  masked: boolean;
  setHidden(hidden: boolean): void;
  toggleHidden(): void;
  startPeek(): void;
  endPeek(): void;
  unit: Unit;
  cycleUnit(): void;
}

const HIDDEN_KEY = 'bb.hide';
const UNIT_KEY = 'bb.unit';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children, initialHidden }: { children: ReactNode; initialHidden?: boolean }) {
  const [hidden, setHiddenState] = useState<boolean>(() => initialHidden ?? read(HIDDEN_KEY) === '1');
  const [peeking, setPeeking] = useState(false);
  const [unit, setUnit] = useState<Unit>(() => {
    const saved = read(UNIT_KEY);
    return UNITS.find((u) => u === saved) ?? 'btc';
  });

  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next);
    setPeeking(false);
    write(HIDDEN_KEY, next ? '1' : '0');
  }, []);
  const toggleHidden = useCallback(() => setHidden(!hidden), [hidden, setHidden]);
  const startPeek = useCallback(() => setPeeking(true), []);
  const endPeek = useCallback(() => setPeeking(false), []);
  const cycleUnit = useCallback(() => {
    setUnit((u) => {
      const next = UNITS[(UNITS.indexOf(u) + 1) % UNITS.length] ?? 'btc';
      write(UNIT_KEY, next);
      return next;
    });
  }, []);

  // The element that was pressed is replaced by the revealed number, so the release is heard on the window.
  useEffect(() => {
    if (!peeking) return;
    const stop = () => setPeeking(false);
    const events = ['pointerup', 'pointercancel', 'keyup', 'blur'] as const;
    for (const e of events) window.addEventListener(e, stop);
    return () => {
      for (const e of events) window.removeEventListener(e, stop);
    };
  }, [peeking]);

  const value = useMemo<Prefs>(
    () => ({ hidden, peeking, masked: hidden && !peeking, setHidden, toggleHidden, startPeek, endPeek, unit, cycleUnit }),
    [hidden, peeking, setHidden, toggleHidden, startPeek, endPeek, unit, cycleUnit],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (ctx === null) throw new Error('usePrefs needs <PrefsProvider>');
  return ctx;
}

/** Pointer and keyboard handlers that reveal hidden amounts while held. */
export function usePeekHandlers() {
  const { masked, startPeek, endPeek } = usePrefs();
  return {
    onPointerDown: () => {
      if (masked) startPeek();
    },
    onPointerUp: endPeek,
    onPointerLeave: endPeek,
    onPointerCancel: endPeek,
    onKeyDown: (e: { key: string; repeat: boolean }) => {
      if (masked && !e.repeat && (e.key === ' ' || e.key === 'Enter')) startPeek();
    },
    onKeyUp: endPeek,
    onBlur: endPeek,
    onContextMenu: (e: { preventDefault(): void }) => {
      if (masked) e.preventDefault(); // long-press on touch screens
    },
  };
}
