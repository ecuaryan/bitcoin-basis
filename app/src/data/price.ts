/**
 * Bitcoin price (USD only), in integer cents per BTC. The app asks its own Worker (`/api/price`,
 * `/api/price/history`), which fetches mempool.space server-side: the browser never contacts a third
 * party, so mempool never sees your IP address or when you open the app. The CSP allows only 'self'.
 */
export const PRICE_API = '/api/price';

export interface PriceQuote {
  /** Cents per BTC. */
  usdCents: number;
  /** Cents per BTC about 24 hours earlier, if known (for "today" change). */
  prevDayUsdCents: number | null;
  /** When the quote was fetched (ms since epoch). */
  fetchedAt: number;
  /** `manual`: a price the person typed because the live one could not be loaded (this session only). */
  source: 'live' | 'fixed' | 'manual';
}

export interface PriceService {
  current(signal?: AbortSignal): Promise<PriceQuote>;
  /** Cents per BTC at a Unix timestamp (seconds). The server rounds it down to the hour. */
  historical(unixSeconds: number, signal?: AbortSignal): Promise<number>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `{ usdCents }` from the Worker: a positive safe integer, or null. */
export function parsePriceCents(json: unknown): number | null {
  if (!isRecord(json)) return null;
  const v = json['usdCents'];
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 10_000_000_000 ? v : null;
}

export class PriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceError';
  }
}

/** The live service, through this app's own Worker. `fetchFn` and `now` are injectable for tests. */
export function createMempoolPriceService(fetchFn: FetchLike = (url, init) => fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' }), now: () => number = Date.now): PriceService {
  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    let res;
    try {
      res = await fetchFn(path, signal ? { signal } : {});
    } catch {
      throw new PriceError('Could not reach the price service.');
    }
    if (res.status === 404) throw new PriceError('No price for that date.');
    if (!res.ok) throw new PriceError(`The price service answered ${res.status}.`);
    try {
      return await res.json();
    } catch {
      throw new PriceError('The price service sent something unreadable.');
    }
  }

  async function historical(unixSeconds: number, signal?: AbortSignal): Promise<number> {
    const ts = Math.floor(unixSeconds);
    if (!Number.isSafeInteger(ts) || ts <= 0) throw new PriceError('No price for that date.');
    const cents = parsePriceCents(await get(`${PRICE_API}/history?ts=${ts}`, signal));
    if (cents === null) throw new PriceError('No price for that date.');
    return cents;
  }

  return {
    historical,
    async current(signal) {
      const cents = parsePriceCents(await get(PRICE_API, signal));
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
