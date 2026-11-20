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

/** Past prices never change, so they are kept on this device and asked for only once. */
export function createLocalPriceCache(storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): PriceCache {
  let map: Record<string, number> = {};
  try {
    const raw: unknown = JSON.parse(storage.getItem(CACHE_KEY) ?? '{}');
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) map = raw as Record<string, number>;
  } catch {
    map = {};
  }
  return {
    get: (ts) => {
      const v = map[String(ts)];
      return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
    },
    set: (ts, cents) => {
      map[String(ts)] = cents;
      try {
        storage.setItem(CACHE_KEY, JSON.stringify(map));
      } catch {
        // Storage full or blocked: fine, it will be asked for again next time.
      }
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
