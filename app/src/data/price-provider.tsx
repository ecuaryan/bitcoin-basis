import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PriceQuote, PriceService } from './price.ts';

export interface PriceState {
  /** The price to use: the person's own price while they have set one, else the live (or fixed) quote. */
  quote: PriceQuote | null;
  /**
   * How the live price is doing (a typed-in price does not change it). `error`: the last try failed. A quote
   * may still be there (the one before, or the one this device kept): screens keep showing it, with its time
   * once it is old (see `PriceAge`), and only treat `error` as a problem when there is no quote at all.
   */
  status: 'loading' | 'ok' | 'error';
  /** Plain-language reason when the last refresh failed (a previous quote may still show). */
  error: string | null;
  service: PriceService;
  /** Ask for the live price again now. */
  refresh(): void;
  /**
   * A price the person typed because the live one could not be loaded, in cents per BTC. Kept in memory for this
   * session only: it is never stored, and becomes part of an entry only if they save one with it.
   */
  manualCents: number | null;
  setManualCents(cents: number | null): void;
}

const PriceContext = createContext<PriceState | null>(null);

/** Look for a new price this often while the page is visible. */
const REFRESH_MS = 60_000;
/** After 1, 2, 3 failures in a row, try again this soon; after more, every `refreshMs`. */
export const RETRY_MS = [15_000, 30_000, 60_000] as const;
const CACHE_KEY = 'bb.last-price';

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** The live quote this device kept. One saved by an older version has no `asOf`: its fetch time stands in. */
function readCached(): PriceQuote | null {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const usdCents = r['usdCents'];
    const prev = r['prevDayUsdCents'];
    const fetchedAt = r['fetchedAt'];
    if (typeof usdCents !== 'number' || !Number.isSafeInteger(usdCents) || usdCents <= 0 || !isTime(fetchedAt)) return null;
    const asOf = isTime(r['asOf']) ? Math.min(r['asOf'], fetchedAt) : fetchedAt;
    const from = r['provider'];
    const provider: Pick<PriceQuote, 'provider'> = from === 'Coinbase' || from === 'mempool.space' ? { provider: from } : {};
    return { usdCents, prevDayUsdCents: typeof prev === 'number' && Number.isSafeInteger(prev) ? prev : null, fetchedAt, asOf, stale: r['stale'] === true, ...provider, source: 'live' };
  } catch {
    return null;
  }
}

/**
 * Keeps one current price for the whole app. A fixed service (demo, tests) is asked once; the live service is
 * asked every minute while the page is visible. After a failure it tries again sooner (15 s, 30 s, 60 s, then
 * every minute), and the quote it had stays.
 */
export function PriceProvider({ service, children, refreshMs = REFRESH_MS, enabled = true }: { service: PriceService; children: ReactNode; refreshMs?: number; enabled?: boolean }) {
  const [quote, setQuote] = useState<PriceQuote | null>(() => readCached());
  const latest = useRef(quote);
  const [status, setStatus] = useState<PriceState['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const failures = useRef(0);
  const [tick, setTick] = useState(0);
  const [manual, setManual] = useState<{ cents: number; at: number } | null>(null);
  const manualCents = manual?.cents ?? null;
  const setManualCents = useCallback((cents: number | null) => setManual(cents === null ? null : { cents, at: Date.now() }), []);

  const refresh = useCallback(() => {
    setStatus('loading');
    setError(null);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (document.visibilityState === 'hidden') {
        schedule(refreshMs);
        return;
      }
      try {
        const q = await service.current(ctl.signal);
        if (ctl.signal.aborted) return;
        failures.current = 0;
        setStatus('ok');
        setError(null);
        // A kept price from the Worker (another data centre's, say) never replaces a newer one shown here.
        const had = latest.current;
        const older = q.stale && had !== null && had.source === 'live' && had.asOf > q.asOf;
        if (!older) {
          latest.current = q;
          setQuote(q);
          if (q.source === 'live') {
            try {
              window.localStorage.setItem(CACHE_KEY, JSON.stringify(q));
            } catch {
              // ignore
            }
          }
        }
        if (q.source === 'live') schedule(refreshMs);
      } catch (e) {
        if (ctl.signal.aborted) return;
        // The quote stays as it was; only the status says this try failed.
        failures.current += 1;
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Could not get the price.');
        schedule(RETRY_MS[failures.current - 1] ?? refreshMs);
      }
    };
    function schedule(ms: number) {
      timer = setTimeout(() => void run(), ms);
    }
    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ctl.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [service, refreshMs, tick, enabled]);

  const shown = useMemo<PriceQuote | null>(() => (manual === null ? quote : { usdCents: manual.cents, prevDayUsdCents: null, fetchedAt: manual.at, asOf: manual.at, stale: false, source: 'manual' }), [manual, quote]);
  const value = useMemo<PriceState>(() => ({ quote: shown, status, error, service, refresh, manualCents, setManualCents }), [shown, status, error, service, refresh, manualCents, setManualCents]);
  return <PriceContext.Provider value={value}>{children}</PriceContext.Provider>;
}

export function usePrice(): PriceState {
  const ctx = useContext(PriceContext);
  if (ctx === null) throw new Error('usePrice needs <PriceProvider>');
  return ctx;
}
