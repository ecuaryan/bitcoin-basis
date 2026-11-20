/**
 * Bitcoin price from mempool.space (USD only). Prices are integer cents per BTC.
 * The only network calls this app makes are the two below.
 */
export const MEMPOOL = 'https://mempool.space';

export interface PriceQuote {
  /** Cents per BTC. */
  usdCents: number;
  /** Cents per BTC about 24 hours earlier, if known (for "today" change). */
  prevDayUsdCents: number | null;
  /** When the quote was fetched (ms since epoch). */
  fetchedAt: number;
  source: 'live' | 'fixed';
}

export interface PriceService {
  current(signal?: AbortSignal): Promise<PriceQuote>;
  /** Cents per BTC at a Unix timestamp (seconds). */
  historical(unixSeconds: number, signal?: AbortSignal): Promise<number>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Whole dollars (or dollars with decimals) to cents, or null if not a sane positive number. */
function dollarsToCents(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100_000_000) return null;
  return Math.round(v * 100);
}

/** `GET /api/v1/prices` returns `{ time, USD, EUR, ... }`. */
export function parseCurrentPrice(json: unknown): number | null {
  return isRecord(json) ? dollarsToCents(json['USD']) : null;
}

/** `GET /api/v1/historical-price` returns `{ prices: [{ time, USD }], exchangeRates }`. */
export function parseHistoricalPrice(json: unknown): number | null {
  if (!isRecord(json)) return null;
  const prices = json['prices'];
  if (!Array.isArray(prices) || prices.length === 0) return null;
  const first: unknown = prices[0];
  return isRecord(first) ? dollarsToCents(first['USD']) : null;
}

export class PriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceError';
  }
}

/** The live service. `fetchFn` and `now` are injectable for tests. */
export function createMempoolPriceService(fetchFn: FetchLike = (url, init) => fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' }), now: () => number = Date.now): PriceService {
  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    let res;
    try {
      res = await fetchFn(`${MEMPOOL}${path}`, signal ? { signal } : {});
    } catch {
      throw new PriceError('Could not reach the price service.');
    }
    if (!res.ok) throw new PriceError(`The price service answered ${res.status}.`);
    try {
      return await res.json();
    } catch {
      throw new PriceError('The price service sent something unreadable.');
    }
  }

  async function historical(unixSeconds: number, signal?: AbortSignal): Promise<number> {
    const ts = Math.floor(unixSeconds);
    const cents = parseHistoricalPrice(await get(`/api/v1/historical-price?currency=USD&timestamp=${ts}`, signal));
    if (cents === null) throw new PriceError('No price for that date.');
    return cents;
  }

  return {
    historical,
    async current(signal) {
      const cents = parseCurrentPrice(await get('/api/v1/prices', signal));
      if (cents === null) throw new PriceError('The price service sent an unexpected answer.');
      // The "today" change is a nicety: no yesterday price, no change shown.
      const prev = await historical(Math.floor(now() / 1000) - 86_400, signal).catch(() => null);
      return { usdCents: cents, prevDayUsdCents: prev, fetchedAt: now(), source: 'live' };
    },
  };
}

/** A price that never changes: for demo data and tests. */
export function createFixedPriceService(usdCents: number, prevDayUsdCents: number | null = null, history?: (unixSeconds: number) => number): PriceService {
  return {
    current: () => Promise.resolve({ usdCents, prevDayUsdCents, fetchedAt: Date.now(), source: 'fixed' }),
    historical: (ts) => Promise.resolve(history ? history(ts) : usdCents),
  };
}

/** Change since yesterday in tenths of a percent (18 = 1.8%), or null. Integer math on cents. */
export function dayChangeTenthsPercent(q: Pick<PriceQuote, 'usdCents' | 'prevDayUsdCents'>): number | null {
  if (q.prevDayUsdCents === null || q.prevDayUsdCents <= 0) return null;
  return Math.round(((q.usdCents - q.prevDayUsdCents) * 1000) / q.prevDayUsdCents);
}
