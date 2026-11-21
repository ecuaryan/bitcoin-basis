import { describe, expect, it } from 'vitest';
import { createLocalPriceCache, floorToHour, PRICE_CACHE_MAX } from './price-history.ts';

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
