import type { PriceService } from './price.ts';

export interface PricePoint {
  /** Milliseconds since the epoch. */
  ms: number;
  /** Cents per BTC. */
  cents: number;
}

export interface PriceCache {
  get(unixSeconds: number): number | null;
  set(unixSeconds: number, cents: number): void;
}

const CACHE_KEY = 'bb.price-history.v1';
/** At most this many prices are kept; the oldest times go first. */
export const PRICE_CACHE_MAX = 400;
const HOUR_MS = 3_600_000;

/** `ms` rounded down to the whole hour (the Worker's price history has hourly resolution anyway). */
export function floorToHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/**
 * Past prices never change, so they are kept on this device and asked for only once. Times are whole
 * hours and the cache is capped at `PRICE_CACHE_MAX` entries, so it can't grow into a long record of
 * when the app was opened.
 */
export function createLocalPriceCache(storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): PriceCache {
  let map: Record<string, number> = {};
  try {
    const raw: unknown = JSON.parse(storage.getItem(CACHE_KEY) ?? '{}');
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) map = raw as Record<string, number>;
  } catch {
    map = {};
  }
  const save = () => {
    try {
      storage.setItem(CACHE_KEY, JSON.stringify(map));
    } catch {
      // Storage full or blocked: fine, it will be asked for again next time.
    }
  };
  const prune = (): boolean => {
    const keys = Object.keys(map);
    // Older versions kept exact seconds: drop those, then keep the newest times.
    const hourly = keys.filter((k) => Number.isSafeInteger(Number(k)) && Number(k) % 3600 === 0);
    if (hourly.length === keys.length && keys.length <= PRICE_CACHE_MAX) return false;
    const keep = hourly.sort((a, b) => Number(b) - Number(a)).slice(0, PRICE_CACHE_MAX);
    const next: Record<string, number> = {};
    for (const k of keep) next[k] = map[k] as number;
    map = next;
    return true;
  };
  if (prune()) save();
  return {
    get: (ts) => {
      const v = map[String(ts)];
      return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
    },
    set: (ts, cents) => {
      map[String(ts)] = cents;
      prune();
      save();
    },
  };
}

export function memoryPriceCache(): PriceCache {
  const m = new Map<number, number>();
  return { get: (ts) => m.get(ts) ?? null, set: (ts, c) => void m.set(ts, c) };
}

/** `points` evenly spaced times ending at `toMs`, starting `monthsBack` months earlier. */
export function seriesTimes(toMs: number, monthsBack: number, points: number): number[] {
  const start = new Date(toMs);
  start.setUTCMonth(start.getUTCMonth() - monthsBack);
  const from = start.getTime();
  return Array.from({ length: points }, (_, i) => (i === points - 1 ? toMs : from + Math.floor(((toMs - from) * i) / (points - 1))));
}

/**
 * Prices at each time, one request at a time with a short pause between them (gentle on
 * mempool.space). Points that cannot be fetched are skipped; the rest still draw a line.
 */
export async function loadPriceSeries(service: PriceService, times: readonly number[], cache: PriceCache, options: { signal?: AbortSignal; pauseMs?: number } = {}): Promise<PricePoint[]> {
  const out: PricePoint[] = [];
  const pause = options.pauseMs ?? 0;
  for (const ms of times) {
    if (options.signal?.aborted) break;
    const ts = Math.floor(ms / 1000);
    let cents = cache.get(ts);
    if (cents === null) {
      try {
        cents = await service.historical(ts, options.signal);
        cache.set(ts, cents);
      } catch {
        continue;
      }
      if (pause > 0) await new Promise((r) => setTimeout(r, pause));
    }
    out.push({ ms, cents });
  }
  return out;
}
