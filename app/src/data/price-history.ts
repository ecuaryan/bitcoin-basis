import { parsePriceSeries, type DailyPrice, type PriceService } from './price.ts';

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

// ---- The daily series ---------------------------------------------------------------------

export interface StoredSeries {
  /** The whole hour it was fetched in (ms), so the stored copy does not record when the app was opened. */
  hourMs: number;
  days: number;
  points: DailyPrice[];
}

export interface SeriesCache {
  get(): StoredSeries | null;
  set(value: StoredSeries): void;
}

const SERIES_KEY = 'bb.price-series.v1';

/** The chart's daily series, kept on this device (one copy, replaced each time) so it is asked for at most hourly. */
export function createLocalSeriesCache(storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): SeriesCache {
  return {
    get() {
      try {
        const raw: unknown = JSON.parse(storage.getItem(SERIES_KEY) ?? 'null');
        if (typeof raw !== 'object' || raw === null) return null;
        const { hourMs, days } = raw as Record<string, unknown>;
        const points = parsePriceSeries(raw);
        if (typeof hourMs !== 'number' || !Number.isSafeInteger(hourMs) || hourMs % HOUR_MS !== 0) return null;
        if (typeof days !== 'number' || !Number.isSafeInteger(days) || days <= 0 || points === null || points.length === 0) return null;
        return { hourMs, days, points };
      } catch {
        return null;
      }
    },
    set({ hourMs, days, points }) {
      try {
        storage.setItem(SERIES_KEY, JSON.stringify({ hourMs, days, points: points.map((p) => [p.dayMs / 1000, p.closeCents, p.highCents]) }));
      } catch {
        // Storage full or blocked: fine, it will be asked for again next time.
      }
    },
  };
}

export function memorySeriesCache(): SeriesCache {
  let v: StoredSeries | null = null;
  return { get: () => v, set: (next) => void (v = next) };
}

/**
 * Chart points from a daily series: each day at its start, at its last price, except the day with the highest
 * price, which is drawn at that high. So the line reaches the peak the chart marks, and nothing hides it.
 */
export function seriesPoints(days: readonly DailyPrice[]): PricePoint[] {
  let peak = -1;
  days.forEach((d, i) => {
    if (peak < 0 || d.highCents > (days[peak] as DailyPrice).highCents) peak = i;
  });
  return days.map((d, i) => ({ ms: d.dayMs, cents: i === peak ? d.highCents : d.closeCents }));
}

export interface ChartHistory {
  points: PricePoint[];
  /** One point per day (the series), as opposed to a few separate lookups. */
  daily: boolean;
}

/**
 * The chart's history: the daily series in one request (kept an hour on this device). If the server cannot give
 * it (an older server has no series), a copy kept earlier, however old; failing that, a few separate lookups at
 * `fallbackTimes`, as before.
 */
export async function loadChartHistory(
  service: PriceService,
  options: { days: number; nowMs: number; fallbackTimes: readonly number[]; seriesCache: SeriesCache; pointCache: PriceCache; signal?: AbortSignal; pauseMs?: number },
): Promise<ChartHistory> {
  const { days, signal } = options;
  const hourMs = floorToHour(options.nowMs);
  const kept = options.seriesCache.get();
  if (kept !== null && kept.days === days && kept.hourMs === hourMs) return { points: seriesPoints(kept.points), daily: true };
  if (service.series) {
    try {
      const points = await service.series(days, signal);
      options.seriesCache.set({ hourMs, days, points });
      return { points: seriesPoints(points), daily: true };
    } catch {
      // Fall through: an older copy, or the separate lookups.
    }
  }
  if (kept !== null && kept.days === days) return { points: seriesPoints(kept.points), daily: true };
  const points = await loadPriceSeries(service, options.fallbackTimes, options.pointCache, { ...(signal ? { signal } : {}), ...(options.pauseMs !== undefined ? { pauseMs: options.pauseMs } : {}) });
  return { points, daily: false };
}
