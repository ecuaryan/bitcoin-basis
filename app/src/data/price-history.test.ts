import { describe, expect, it } from 'vitest';
import type { DailyPrice, PriceService } from './price.ts';
import { createLocalPriceCache, createLocalSeriesCache, floorToHour, loadChartHistory, memoryPriceCache, memorySeriesCache, PRICE_CACHE_MAX, seriesPoints } from './price-history.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
const KEY = 'bb.price-history.v1';
const H = 3600;

describe('price history cache (privacy)', () => {
  it('rounds times down to the hour', () => {
    expect(floorToHour(Date.UTC(2026, 10, 21, 14, 59, 59, 999))).toBe(Date.UTC(2026, 10, 21, 14));
    expect(floorToHour(Date.UTC(2026, 10, 21, 14))).toBe(Date.UTC(2026, 10, 21, 14));
  });

  it(`keeps at most ${PRICE_CACHE_MAX} prices, the newest times`, () => {
    const s = memoryStorage();
    const c = createLocalPriceCache(s);
    const base = 1_700_000_000 - (1_700_000_000 % H);
    for (let i = 0; i < PRICE_CACHE_MAX + 50; i++) c.set(base + i * H, 100 + i);
    const stored = JSON.parse(s.m.get(KEY) ?? '{}') as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(PRICE_CACHE_MAX);
    expect(c.get(base)).toBeNull();
    expect(c.get(base + 49 * H)).toBeNull();
    expect(c.get(base + 50 * H)).toBe(150);
    expect(c.get(base + (PRICE_CACHE_MAX + 49) * H)).toBe(100 + PRICE_CACHE_MAX + 49);
  });

  it('drops exact-second times an older version stored', () => {
    const hour = 1_700_000_000 - (1_700_000_000 % H);
    const s = memoryStorage({ [KEY]: JSON.stringify({ [hour]: 5, [hour + 17]: 6 }) });
    const c = createLocalPriceCache(s);
    expect(c.get(hour)).toBe(5);
    expect(c.get(hour + 17)).toBeNull();
    expect(JSON.parse(s.m.get(KEY) ?? '{}')).toEqual({ [hour]: 5 });
  });
});

describe('daily series for the chart', () => {
  const DAY_S = 86_400;
  const D0 = 1_759_708_800; // 2025-10-06, a UTC midnight
  const days: DailyPrice[] = [
    { dayMs: (D0 - DAY_S) * 1000, closeCents: 12_300_000, highCents: 12_350_000 },
    { dayMs: D0 * 1000, closeCents: 12_450_000, highCents: 12_607_300 },
    { dayMs: (D0 + DAY_S) * 1000, closeCents: 12_400_000, highCents: 12_500_000 },
  ];
  const NOW = (D0 + DAY_S) * 1000 + 5 * 3_600_000 + 1234;
  const fallbackTimes = [NOW - 2 * 86_400_000, NOW - 86_400_000];
  const svc = (series?: PriceService['series']) => {
    const asked: number[] = [];
    const s: PriceService = {
      current: () => Promise.reject(new Error('unused')),
      historical: (ts) => {
        asked.push(ts);
        return Promise.resolve(5_000_000);
      },
      ...(series ? { series } : {}),
    };
    return { s, asked };
  };

  it('draws each day at its last price, and the highest day at its high', () => {
    expect(seriesPoints(days)).toEqual([
      { ms: (D0 - DAY_S) * 1000, cents: 12_300_000 },
      { ms: D0 * 1000, cents: 12_607_300 },
      { ms: (D0 + DAY_S) * 1000, cents: 12_400_000 },
    ]);
  });

  it('one request, kept for the hour on this device (stored under the whole hour)', async () => {
    let calls = 0;
    const { s, asked } = svc((d) => {
      calls++;
      expect(d).toBe(1095);
      return Promise.resolve(days);
    });
    const storage = memoryStorage();
    const seriesCache = createLocalSeriesCache(storage);
    const opts = { days: 1095, nowMs: NOW, fallbackTimes, seriesCache, pointCache: memoryPriceCache() };
    expect(await loadChartHistory(s, opts)).toEqual({ points: seriesPoints(days), daily: true });
    expect(await loadChartHistory(s, { ...opts, nowMs: NOW + 60_000 })).toEqual({ points: seriesPoints(days), daily: true });
    expect(calls).toBe(1);
    expect(asked).toEqual([]);
    const stored = JSON.parse(storage.m.get('bb.price-series.v1') ?? '{}') as { hourMs: number; points: unknown };
    expect(stored.hourMs % 3_600_000).toBe(0);
    expect(stored.points).toEqual([[D0 - DAY_S, 12_300_000, 12_350_000], [D0, 12_450_000, 12_607_300], [D0 + DAY_S, 12_400_000, 12_500_000]]);
    // The next hour asks again.
    await loadChartHistory(s, { ...opts, nowMs: NOW + 3_600_000 });
    expect(calls).toBe(2);
  });

  it('when the series fails: an older copy if there is one, else a few separate lookups (an older server)', async () => {
    const failing = svc(() => Promise.reject(new Error('404')));
    const seriesCache = memorySeriesCache();
    seriesCache.set({ hourMs: floorToHour(NOW) - 30 * 3_600_000, days: 1095, points: days });
    const opts = { days: 1095, nowMs: NOW, fallbackTimes, pointCache: memoryPriceCache() };
    expect(await loadChartHistory(failing.s, { ...opts, seriesCache })).toEqual({ points: seriesPoints(days), daily: true });
    expect(failing.asked).toEqual([]);
    const fresh = await loadChartHistory(failing.s, { ...opts, seriesCache: memorySeriesCache() });
    expect(fresh).toEqual({ points: fallbackTimes.map((ms) => ({ ms, cents: 5_000_000 })), daily: false });
    expect(failing.asked).toHaveLength(2);
    const none = svc();
    expect((await loadChartHistory(none.s, { ...opts, seriesCache: memorySeriesCache() })).daily).toBe(false);
  });

  it('a stored copy that is not the right shape is ignored', () => {
    for (const raw of ['nope', '{"hourMs":1,"days":1095,"points":[]}', `{"hourMs":3600000,"days":1095,"points":[[1,2,3]]}`, `{"hourMs":3600000,"days":0,"points":[[${D0},2,3]]}`, 'null']) {
      expect(createLocalSeriesCache(memoryStorage({ 'bb.price-series.v1': raw })).get(), raw).toBeNull();
    }
    const blocked = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    expect(() => createLocalSeriesCache(blocked).set({ hourMs: 0, days: 1, points: days })).not.toThrow();
  });
});
