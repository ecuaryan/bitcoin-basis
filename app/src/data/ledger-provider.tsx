import { holdings as computeHoldings, localDate, replay, type Entry, type Holdings, type LedgerState } from '@bitcoin-basis/engine';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  /** Remove the made-up demo book and leave demo mode. */
  clearAll(): Promise<void>;
}

const LedgerContext = createContext<Ledger | null>(null);

const EMPTY: readonly Entry[] = [];

/** Replays entries with the engine and shares the result. Screens never touch the store directly. */
export function LedgerProvider({
  store: realStore,
  demoStore: demoStoreProp,
  demoAllowed = true,
  initialDemo = false,
  children,
  clock = Date.now,
}: {
  /** The real book (the vault's encrypted store). Append-only: this provider never calls `clear()` on it. */
  store: LedgerStore;
  /** Where the made-up demo book lives. Defaults to `store` (tests and the plain local app only). */
  demoStore?: LedgerStore;
  /** False while a real vault exists on this device: a leftover demo flag is then ignored. */
  demoAllowed?: boolean;
  /** Start in the demo (tests). The demo is never remembered between page loads. */
  initialDemo?: boolean;
  children: ReactNode;
  clock?: () => number;
}) {
  const demoStore = demoStoreProp ?? realStore;
  // Entries are remembered with the store they came from, so switching stores never shows the old book.
  const [loaded, setLoaded] = useState<{ from: LedgerStore; list: readonly Entry[] } | null>(null);
  const [demoFlag, setDemoFlag] = useState<boolean>(initialDemo);
  const isDemo = demoFlag && demoAllowed;
  const store = isDemo ? demoStore : realStore;

  useEffect(() => {
    let live = true;
    const load = () => {
      void store.list().then((list) => {
        if (!live) return;
        // A store still loading (or locked) has not answered: its empty list is not the book.
        setLoaded(store.isLoaded?.() === false ? null : { from: store, list });
      });
    };
    load();
    const off = store.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [store]);

  const ready = loaded !== null && loaded.from === store;
  const entries = ready ? loaded.list : EMPTY;
  const state = useMemo(() => replay(entries), [entries]);
  const holdings = useMemo(() => computeHoldings(state), [state]);

  // Safety net under every save button: the same entry cannot be on its way in twice.
  const inFlight = useRef(new Map<string, Promise<void>>());
  const append = useCallback(
    (add: readonly Entry[]) => {
      const ids = add.map((e) => e.id);
      const running = ids.map((id) => inFlight.current.get(id)).find((p) => p !== undefined);
      if (running !== undefined) return running;
      const p = store.append(add).finally(() => {
        for (const id of ids) inFlight.current.delete(id);
      });
      for (const id of ids) inFlight.current.set(id, p);
      return p;
    },
    [store],
  );
  // Demo only ever touches the demo store: the vault's store is append-only and is never cleared.
  const loadDemo = useCallback(async () => {
    await demoStore.clear();
    await demoStore.append(buildDemoBook().entries);
    setDemoFlag(true);
  }, [demoStore]);
  const clearAll = useCallback(async () => {
    await demoStore.clear();
    setDemoFlag(false);
  }, [demoStore]);

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
