import { describe, expect, it } from 'vitest';
import { createMempoolPriceService, type FetchLike, parsePriceCents, PriceError, PRICE_API, quoteAsOf } from './price.ts';

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

  it('carries when the price is from: the server\'s asOf, or the fetch time from an older server', async () => {
    const NOW = 1_700_000_000_000;
    const history = { [`${PRICE_API}/history`]: { status: 200, body: { ts: 0, usdCents: 1 } } };
    const fresh = fakeFetch({ ...history, [PRICE_API]: { status: 200, body: { usdCents: 10_000_000, asOf: NOW - 30_000 } } });
    expect(await createMempoolPriceService(fresh.fn, () => NOW).current()).toMatchObject({ fetchedAt: NOW, asOf: NOW - 30_000, stale: false });
    const stale = fakeFetch({ ...history, [PRICE_API]: { status: 200, body: { usdCents: 10_000_000, asOf: NOW - 3_600_000, stale: true } } });
    expect(await createMempoolPriceService(stale.fn, () => NOW).current()).toMatchObject({ usdCents: 10_000_000, fetchedAt: NOW, asOf: NOW - 3_600_000, stale: true });
    const old = fakeFetch({ ...history, [PRICE_API]: { status: 200, body: { usdCents: 10_000_000 } } });
    expect(await createMempoolPriceService(old.fn, () => NOW).current()).toMatchObject({ fetchedAt: NOW, asOf: NOW, stale: false, provider: 'mempool.space' });
  });

  it('names where the live price came from: Coinbase when the Worker says so, else mempool.space', async () => {
    const history = { [`${PRICE_API}/history`]: { status: 200, body: { ts: 0, usdCents: 1 } } };
    const cb = fakeFetch({ ...history, [PRICE_API]: { status: 200, body: { usdCents: 6_019_512, asOf: 1, source: 'coinbase' } } });
    expect((await createMempoolPriceService(cb.fn).current()).provider).toBe('Coinbase');
    const mp = fakeFetch({ ...history, [PRICE_API]: { status: 200, body: { usdCents: 6_019_512, asOf: 1, source: 'mempool' } } });
    expect((await createMempoolPriceService(mp.fn).current()).provider).toBe('mempool.space');
  });

  it('asOf is never later than the fetch, and a fresh answer is never more than 2 minutes old (a clock that runs ahead)', () => {
    const NOW = 1_700_000_000_000;
    expect(quoteAsOf({ asOf: NOW + 60_000 }, NOW, false)).toBe(NOW);
    expect(quoteAsOf({ asOf: NOW - 3_600_000 }, NOW, false)).toBe(NOW - 120_000);
    expect(quoteAsOf({ asOf: NOW - 3_600_000 }, NOW, true)).toBe(NOW - 3_600_000);
    for (const bad of [{}, { asOf: '1' }, { asOf: 1.5 }, { asOf: -1 }, null]) expect(quoteAsOf(bad, NOW, true), JSON.stringify(bad)).toBe(NOW);
  });

  it('accepts only positive integer cents', () => {
    expect(parsePriceCents({ usdCents: 9_712_345 })).toBe(9_712_345);
    for (const bad of [null, [], {}, { usdCents: '1' }, { usdCents: 1.5 }, { usdCents: 0 }, { usdCents: -1 }, { usdCents: Number.MAX_SAFE_INTEGER }, { USD: 97_000 }]) {
      expect(parsePriceCents(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
