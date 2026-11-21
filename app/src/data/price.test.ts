import { describe, expect, it } from 'vitest';
import { createMempoolPriceService, type FetchLike, parsePriceCents, PriceError, PRICE_API } from './price.ts';

function fakeFetch(answers: Record<string, { status: number; body: unknown }>) {
  const urls: string[] = [];
  const fn: FetchLike = (url) => {
    urls.push(url);
    const a = answers[url.split('?')[0] ?? ''] ?? { status: 404, body: { error: 'not_found' } };
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  };
  return { fn, urls };
}

describe('price service (through the Worker)', () => {
  it('asks only this app\'s own /api/price endpoints, never a third party', async () => {
    const { fn, urls } = fakeFetch({ [PRICE_API]: { status: 200, body: { usdCents: 10_000_000 } }, [`${PRICE_API}/history`]: { status: 200, body: { ts: 0, usdCents: 9_800_000 } } });
    const svc = createMempoolPriceService(fn, () => 1_700_000_000_000);
    const q = await svc.current();
    expect(q).toMatchObject({ usdCents: 10_000_000, prevDayUsdCents: 9_800_000, source: 'live' });
    expect(urls).toEqual(['/api/price', '/api/price/history?ts=1699913600']);
    for (const u of urls) expect(u.startsWith('/')).toBe(true);
  });

  it('historical passes whole seconds', async () => {
    const { fn, urls } = fakeFetch({ [`${PRICE_API}/history`]: { status: 200, body: { ts: 1, usdCents: 42 } } });
    expect(await createMempoolPriceService(fn).historical(1_600_000_000.9)).toBe(42);
    expect(urls).toEqual(['/api/price/history?ts=1600000000']);
  });

  it('errors are PriceErrors; a missing yesterday price just hides the change', async () => {
    const down = fakeFetch({ [PRICE_API]: { status: 502, body: { error: 'bad_gateway' } } });
    await expect(createMempoolPriceService(down.fn).current()).rejects.toBeInstanceOf(PriceError);
    const noHistory = fakeFetch({ [PRICE_API]: { status: 200, body: { usdCents: 5 } } });
    expect((await createMempoolPriceService(noHistory.fn).current()).prevDayUsdCents).toBeNull();
    await expect(createMempoolPriceService(noHistory.fn).historical(1_600_000_000)).rejects.toThrow('No price for that date.');
  });

  it('accepts only positive integer cents', () => {
    expect(parsePriceCents({ usdCents: 9_712_345 })).toBe(9_712_345);
    for (const bad of [null, [], {}, { usdCents: '1' }, { usdCents: 1.5 }, { usdCents: 0 }, { usdCents: -1 }, { usdCents: Number.MAX_SAFE_INTEGER }, { USD: 97_000 }]) {
      expect(parsePriceCents(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
