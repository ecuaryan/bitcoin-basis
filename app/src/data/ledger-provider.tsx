import { holdings as computeHoldings, localDate, replay, type Entry, type Holdings, type LedgerState } from '@bitcoin-basis/engine';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildDemoBook, DEMO_TODAY } from '../demo/demo-data.ts';
import type { LedgerStore } from './ledger-store.ts';

export interface Ledger {
  /** False until the store has answered once. */
  ready: boolean;
  entries: readonly Entry[];
  /** Entries replayed by the engine. */
  state: LedgerState;
  holdings: Holdings;
  /** The book on screen is the synthetic demo book. */
  isDemo: boolean;
  /** Today's local date, `YYYY-MM-DD` (the demo book has its own fixed "today"). */
  today: string;
  append(entries: readonly Entry[]): Promise<void>;
  loadDemo(): Promise<void>;
  /** Remove every entry and leave demo mode. */
  clearAll(): Promise<void>;
}

const LedgerContext = createContext<Ledger | null>(null);

const DEMO_KEY = 'bb.demo';

function readDemoFlag(): boolean {
  try {
    return window.localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}
function writeDemoFlag(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DEMO_KEY, '1');
    else window.localStorage.removeItem(DEMO_KEY);
  } catch {
    // ignore
  }
}

const EMPTY: readonly Entry[] = [];

/** Replays entries with the engine and shares the result. Screens never touch the store directly. */
export function LedgerProvider({ store, children, clock = Date.now }: { store: LedgerStore; children: ReactNode; clock?: () => number }) {
  const [entries, setEntries] = useState<readonly Entry[]>(EMPTY);
  const [ready, setReady] = useState(false);
  const [isDemo, setIsDemo] = useState<boolean>(() => readDemoFlag());

  useEffect(() => {
    let live = true;
    const load = () => {
      void store.list().then((list) => {
        if (!live) return;
        setEntries(list);
        setReady(true);
      });
    };
    load();
    const off = store.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [store]);

  const state = useMemo(() => replay(entries), [entries]);
  const holdings = useMemo(() => computeHoldings(state), [state]);

  const append = useCallback((add: readonly Entry[]) => store.append(add), [store]);
  const loadDemo = useCallback(async () => {
    await store.clear();
    await store.append(buildDemoBook().entries);
    writeDemoFlag(true);
    setIsDemo(true);
  }, [store]);
  const clearAll = useCallback(async () => {
    await store.clear();
    writeDemoFlag(false);
    setIsDemo(false);
  }, [store]);

  const today = isDemo ? DEMO_TODAY : localDate(new Date(clock()).toISOString().slice(0, 19) + 'Z', state.settings.timeZone);

  const value = useMemo<Ledger>(
    () => ({ ready, entries, state, holdings, isDemo, today, append, loadDemo, clearAll }),
    [ready, entries, state, holdings, isDemo, today, append, loadDemo, clearAll],
  );
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): Ledger {
  const ctx = useContext(LedgerContext);
  if (ctx === null) throw new Error('useLedger needs <LedgerProvider>');
  return ctx;
}
