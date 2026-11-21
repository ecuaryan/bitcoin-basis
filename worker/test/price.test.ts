// The public price endpoints: the Worker fetches mempool server-side (a local fake here), so the browser
// never contacts a third party. Input is validated, timestamps are rounded down to the hour, answers are
// cached, and upstream trouble is a 502 JSON error, except for the live price: mempool is retried once, then
// Coinbase's spot price is asked, then the last good price is answered, marked stale.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { coinbaseBase, mempoolBase } from '../src/config.ts';
import { dailySeries, decimalDollarsToCents, livePrice, MAX_SERIES_DAYS, priceSeries, seriesDays } from '../src/price.ts';
import { Client, ORIGIN, startServer } from './harness.ts';

type Reply = { status: number; body: string };
const seen: { url: string; headers: IncomingMessage['headers'] }[] = [];
let reply: (url: URL) => Reply = () => ({ status: 500, body: '' });

const fake = createServer((req, res) => {
  seen.push({ url: req.url ?? '', headers: req.headers });
  const r = reply(new URL(req.url ?? '/', 'http://fake'));
  res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(r.body);
});
await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
const FAKE = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

const server = startServer({ MEMPOOL_URL: FAKE, COINBASE_URL: FAKE, DEV_ALLOW_HTTP: '1' });
beforeAll(() => server.listen(), 60_000);
afterAll(async () => {
  await server.close();
  fake.close();
});
beforeEach(() => {
  seen.length = 0;
});

const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);
/** A distinct, settled hour per test (the Worker's cache outlives a test). */
let hoursBack = 100;
const pastHour = () => {
  hoursBack += 7;
  const t = now() - hoursBack * HOUR;
  return t - (t % HOUR);
};
const historyOk = (usd: number) => (url: URL) =>
  url.pathname === '/api/v1/historical-price' ? { status: 200, body: JSON.stringify({ prices: [{ time: Number(url.searchParams.get('timestamp')), USD: usd }], exchangeRates: {} }) } : { status: 404, body: '' };

describe('GET /api/price/history', () => {
  it('rounds the timestamp down to the hour, asks mempool once, and answers integer cents', async () => {
    reply = historyOk(97_123.45);
    const hour = pastHour();
    const c = new Client(server);
    const res = await c.get(`/api/price/history?ts=${hour + 1799}`);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ts: hour, usdCents: 9_712_345 });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(seen.map((s) => s.url)).toEqual([`/api/v1/historical-price?currency=USD&timestamp=${hour}`]);
    // Any time in the same hour is the same answer, served from the cache.
    const again = await c.get(`/api/price/history?ts=${hour + 3599}`);
    expect(again.data).toEqual({ ts: hour, usdCents: 9_712_345 });
    expect(seen).toHaveLength(1);
  });

  it('sends mempool no cookie, Origin, Referer or client address', async () => {
    reply = historyOk(50_000);
    const c = new Client(server);
    c.cookie = '__Secure-bb_session=secret';
    expect((await c.get(`/api/price/history?ts=${pastHour()}`)).status).toBe(200);
    const h = seen[0]?.headers ?? {};
    expect(h.cookie).toBeUndefined();
    expect(h.origin).toBeUndefined();
    expect(h.referer).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain(c.ip);
  });

  it.each([
    ['missing', ''],
    ['empty', '?ts='],
    ['not a number', '?ts=abc'],
    ['negative', '?ts=-5'],
    ['decimal', '?ts=1700000000.5'],
    ['too long', '?ts=123456789012'],
    ['before Bitcoin', '?ts=1000000000'],
    ['in the future', `?ts=${now() + 2 * HOUR}`],
  ])('rejects a bad timestamp (%s) with 400, without calling mempool', async (_label, query) => {
    const res = await new Client(server).get(`/api/price/history${query}`);
    expect(res.status).toBe(400);
    expect(res.data).toEqual({ error: 'bad_request' });
    expect(seen).toHaveLength(0);
  });

  it('an hour mempool has no price for is a 404, and is not cached', async () => {
    reply = () => ({ status: 200, body: JSON.stringify({ prices: [], exchangeRates: {} }) });
    const hour = pastHour();
    expect((await new Client(server).get(`/api/price/history?ts=${hour}`)).status).toBe(404);
    reply = historyOk(1234);
    expect((await new Client(server).get(`/api/price/history?ts=${hour}`)).data).toEqual({ ts: hour, usdCents: 123_400 });
  });

  it.each([
    ['an error status', { status: 503, body: 'down' }],
    ['not JSON', { status: 200, body: '<html>' }],
    ['the wrong shape', { status: 200, body: '{"prices":"x"}' }],
    ['a nonsense price', { status: 200, body: '{"prices":[{"USD":-1}]}' }],
    ['a huge body', { status: 200, body: JSON.stringify({ prices: [{ USD: 1 }], pad: 'x'.repeat(70_000) }) }],
  ])('upstream failure (%s) is a 502 JSON error, not cached', async (_label, r) => {
    reply = () => r;
    const hour = pastHour();
    const res = await new Client(server).get(`/api/price/history?ts=${hour}`);
    expect(res.status).toBe(502);
    expect(res.data).toEqual({ error: 'bad_gateway' });
    reply = historyOk(2);
    expect((await new Client(server).get(`/api/price/history?ts=${hour}`)).status).toBe(200);
  });
});

const DAY = 24 * HOUR;
const today = () => now() - (now() % DAY);
/** mempool's whole-history answer for the last `days` days, newest first as mempool sends it: hourly for three years, daily before. */
function wholeHistory(days: number, usdAt: (t: number) => number = (t) => 50_000 + ((t / HOUR) % 24) * 10): string {
  const prices = [];
  for (let t = now() - (now() % HOUR); t > now() - days * DAY; t -= t > now() - 1095 * DAY ? HOUR : DAY) prices.push({ time: t, USD: usdAt(t) });
  return JSON.stringify({ prices, exchangeRates: {} });
}
const isWhole = (url: URL) => url.pathname === '/api/v1/historical-price' && !url.searchParams.has('timestamp');

// In order: the Worker's cache outlives a test, and the first good answer fills it for an hour.
describe('GET /api/price/series', () => {
  it.each([
    ['missing', ''],
    ['empty', '?days='],
    ['zero', '?days=0'],
    ['not a number', '?days=abc'],
    ['negative', '?days=-5'],
    ['decimal', '?days=1.5'],
    ['too long', '?days=1234567'],
  ])('rejects bad days (%s) with 400, without calling mempool', async (_label, query) => {
    const res = await new Client(server).get(`/api/price/series${query}`);
    expect(res.status).toBe(400);
    expect(res.data).toEqual({ error: 'bad_request' });
    expect(seen).toHaveLength(0);
  });

  it.each([
    ['an error status', { status: 503, body: 'down' }],
    ['not JSON', { status: 200, body: '<html>' }],
    ['the wrong shape', { status: 200, body: '{"prices":"x"}' }],
    ['a nonsense price', { status: 200, body: JSON.stringify({ prices: [{ time: now() - HOUR, USD: -1 }] }) }],
    ['nothing in the window', { status: 200, body: JSON.stringify({ prices: [{ time: 1_300_000_000, USD: 1 }] }) }],
  ])('upstream failure (%s) is a 502 JSON error, not cached', async (_label, r) => {
    reply = () => r;
    const res = await new Client(server).get('/api/price/series?days=30');
    expect(res.status).toBe(502);
    expect(res.data).toEqual({ error: 'bad_gateway' });
  });

  it('asks mempool once for the whole history, sends nothing about the browser, answers one point per day in integer cents', async () => {
    reply = (url) => (isWhole(url) ? { status: 200, body: wholeHistory(40) } : { status: 404, body: '' });
    const c = new Client(server);
    c.cookie = '__Secure-bb_session=secret';
    const res = await c.get('/api/price/series?days=30');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const { points } = res.data as { points: [number, number, number][] };
    expect(points).toHaveLength(30);
    expect(points.at(-1)?.[0]).toBe(today());
    expect(points[0]?.[0]).toBe(today() - 29 * DAY);
    for (const [day, close, high] of points) {
      expect(day % DAY).toBe(0);
      expect(Number.isSafeInteger(close) && Number.isSafeInteger(high) && high >= close).toBe(true);
    }
    // A whole past day: its high is the 23:00 price (the fake's highest), its close the same hour.
    expect(points[0]?.slice(1)).toEqual([5_023_000, 5_023_000]);
    expect(seen.map((s) => s.url)).toEqual(['/api/v1/historical-price?currency=USD']);
    const h = seen[0]?.headers ?? {};
    expect(h.cookie).toBeUndefined();
    expect(h.origin).toBeUndefined();
    expect(h.referer).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain(c.ip);
    // Another window comes from the same cached answer.
    const week = await c.get('/api/price/series?days=7');
    expect((week.data as { points: unknown[] }).points).toEqual(points.slice(-7));
    expect(seen).toHaveLength(1);
  });
});

describe('daily series', () => {
  const T = 1_759_708_800; // a UTC midnight (2025-10-06)
  it('keeps the last price and the highest of each UTC day, oldest first, whatever order mempool sends', () => {
    const data = {
      prices: [
        { time: T + DAY + 5 * HOUR, USD: 120_000 },
        { time: T + 19 * HOUR, USD: 126_073 },
        { time: T + 23 * HOUR, USD: 124_500.5 },
        { time: T + 2 * HOUR, USD: 123_000 },
        { time: T - DAY, USD: 1 }, // before the window
      ],
    };
    expect(dailySeries(data, T)).toEqual([
      [T, 12_450_050, 12_607_300],
      [T + DAY, 12_000_000, 12_000_000],
    ]);
  });

  it('is strict: any other shape, or a bad price in the window, is null', () => {
    for (const bad of [null, [], { prices: {} }, { prices: [1] }, { prices: [{ time: '1', USD: 1 }] }, { prices: [{ time: 1.5, USD: 1 }] }, { prices: [{ time: T, USD: '1' }] }, { prices: [{ time: T, USD: 0 }] }, { prices: [{ time: T, USD: Number.NaN }] }]) {
      expect(dailySeries(bad, T), JSON.stringify(bad)).toBeNull();
    }
    // A zero price long before the window is not used, so it does no harm.
    expect(dailySeries({ prices: [{ time: T - DAY, USD: 0 }] }, T)).toEqual([]);
  });

  it('days: whole numbers from 1, capped at ten years', () => {
    expect(seriesDays('1')).toBe(1);
    expect(seriesDays('1095')).toBe(1095);
    expect(seriesDays('999999')).toBe(MAX_SERIES_DAYS);
    expect(MAX_SERIES_DAYS).toBe(3660);
  });
});

const liveOk = (usd: number) => (url: URL) => (url.pathname === '/api/v1/prices' ? { status: 200, body: JSON.stringify({ time: 1, USD: usd, EUR: 93_000 }) } : { status: 404, body: '' });
const down = () => ({ status: 503, body: 'down' });
const liveCalls = () => seen.filter((s) => s.url === '/api/v1/prices').length;
const SPOT = '/v2/prices/BTC-USD/spot';
const coinbaseCalls = () => seen.filter((s) => s.url === SPOT).length;
const spot = (data: unknown) => ({ status: 200, body: JSON.stringify({ data }) });
/** mempool down, Coinbase answering `r`. */
const onlyCoinbase = (r: Reply) => (url: URL) => (url.pathname === SPOT ? r : down());

// In order: the Worker's cache outlives a test, and the first good answer fills it.
describe('GET /api/price', () => {
  it('mempool failing twice and Coinbase failing, with no last good price, is a 502 JSON error', async () => {
    reply = down;
    const res = await new Client(server).get('/api/price');
    expect(res.status).toBe(502);
    expect(res.data).toEqual({ error: 'bad_gateway' });
    expect(liveCalls()).toBe(2);
    expect(coinbaseCalls()).toBe(1);
  });

  it('one hiccup is retried once; the answer is integer cents and when it was fetched, cached for a minute', async () => {
    let calls = 0;
    reply = (url) => (url.pathname === '/api/v1/prices' && ++calls === 1 ? down() : liveOk(101_000)(url));
    const c = new Client(server);
    const before = Date.now();
    const res = await c.get('/api/price');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ usdCents: 10_100_000, asOf: expect.any(Number), source: 'mempool' });
    const { asOf } = res.data as { asOf: number };
    expect(asOf).toBeGreaterThanOrEqual(before - 5000);
    expect(asOf).toBeLessThanOrEqual(Date.now() + 5000);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(liveCalls()).toBe(2);
    expect(coinbaseCalls()).toBe(0);
    expect((await c.get('/api/price')).data).toEqual({ usdCents: 10_100_000, asOf, source: 'mempool' });
    expect(liveCalls()).toBe(2);
  });
});

/** The Cache API, stood in for in Node, so a test can let the one-minute answer run out. */
describe('live price when mempool is down (stand-in cache)', () => {
  const store = new Map<string, { body: string; cacheControl: string | null }>();
  let cacheBroken = false;
  const standIn = {
    match: (req: Request) => {
      if (cacheBroken) return Promise.reject(new Error('cache down'));
      const hit = store.get(req.url);
      return Promise.resolve(hit ? new Response(hit.body) : undefined);
    },
    put: async (req: Request, res: Response) => {
      if (cacheBroken) throw new Error('cache down');
      store.set(req.url, { body: await res.text(), cacheControl: res.headers.get('Cache-Control') });
    },
  };
  const FRESH = `${ORIGIN}/__price/live`;
  const LAST_GOOD = `${ORIGIN}/__price/live-last-good`;
  const env = { ORIGIN, MEMPOOL_URL: FAKE, COINBASE_URL: FAKE, DEV_ALLOW_HTTP: '1' };
  const browser = { 'Sec-Fetch-Site': 'same-origin', Origin: ORIGIN, Referer: `${ORIGIN}/`, Cookie: '__Secure-bb_session=secret', 'CF-Connecting-IP': '198.51.100.7' };
  const ask = async (e: Record<string, string> = env) => (await livePrice(new Request(`${ORIGIN}/api/price`, { headers: browser }), { ...e, ORIGIN })).json();

  beforeEach(() => {
    store.clear();
    cacheBroken = false;
    vi.stubGlobal('caches', { default: standIn });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the last good price for 6 hours and answers it, marked stale with its time, once the minute is over', async () => {
    reply = liveOk(90_000);
    const good = (await ask()) as { usdCents: number; asOf: number };
    expect(good).toEqual({ usdCents: 9_000_000, asOf: expect.any(Number), source: 'mempool' });
    expect(store.get(FRESH)?.cacheControl).toBe('public, max-age=60');
    expect(store.get(LAST_GOOD)?.cacheControl).toBe('public, max-age=21600');

    store.delete(FRESH); // the minute is over
    reply = down;
    seen.length = 0;
    expect(await ask()).toEqual({ usdCents: 9_000_000, asOf: good.asOf, source: 'mempool', stale: true });
    expect(liveCalls()).toBe(2);
    expect(coinbaseCalls()).toBe(1);
    // A stale answer is not cached as fresh: the next request asks mempool again.
    reply = liveOk(91_000);
    expect(await ask()).toEqual({ usdCents: 9_100_000, asOf: expect.any(Number), source: 'mempool' });
  });

  it('a 502 only when there is no last good price', async () => {
    reply = down;
    await expect(ask()).rejects.toMatchObject({ status: 502 });
    expect(liveCalls()).toBe(2);
    expect(coinbaseCalls()).toBe(1);
  });

  it('mempool down: Coinbase\'s spot price, in integer cents, cached like any good answer; it gets nothing from the browser', async () => {
    reply = onlyCoinbase(spot({ amount: '60195.125', base: 'BTC', currency: 'USD' }));
    expect(await ask()).toEqual({ usdCents: 6_019_513, asOf: expect.any(Number), source: 'coinbase' });
    expect(liveCalls()).toBe(2);
    expect(coinbaseCalls()).toBe(1);
    expect(store.has(FRESH) && store.has(LAST_GOOD)).toBe(true);
    const h = seen.find((x) => x.url === SPOT)?.headers ?? {};
    expect(h.cookie).toBeUndefined();
    expect(h.origin).toBeUndefined();
    expect(h.referer).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain('198.51.100.7');
  });

  it.each([
    ['an error status', { status: 503, body: 'down' }],
    ['a redirect', { status: 302, body: '' }],
    ['not JSON', { status: 200, body: '<html>' }],
    ['another coin', spot({ amount: '3000.00', base: 'ETH', currency: 'USD' })],
    ['another currency', spot({ amount: '55000.00', base: 'BTC', currency: 'EUR' })],
    ['a number, not a string', spot({ amount: 60195.12, base: 'BTC', currency: 'USD' })],
    ['a nonsense amount', spot({ amount: '-1', base: 'BTC', currency: 'USD' })],
    ['no data', { status: 200, body: '{"amount":"60195.12"}' }],
    ['a huge body', spot({ amount: '60195.12', base: 'BTC', currency: 'USD', pad: 'x'.repeat(70_000) })],
  ])('Coinbase failing too (%s): the last good price, or a 502 without one', async (_label, r) => {
    reply = onlyCoinbase(r);
    await expect(ask()).rejects.toMatchObject({ status: 502 });
    store.set(LAST_GOOD, { body: JSON.stringify({ usdCents: 8_000_000, asOf: 1_700_000_000_000, source: 'coinbase' }), cacheControl: null });
    expect(await ask()).toEqual({ usdCents: 8_000_000, asOf: 1_700_000_000_000, source: 'coinbase', stale: true });
  });

  it('COINBASE_URL=off: mempool alone, then the last good price', async () => {
    reply = onlyCoinbase(spot({ amount: '60195.12', base: 'BTC', currency: 'USD' }));
    await expect(ask({ ...env, COINBASE_URL: 'off' })).rejects.toMatchObject({ status: 502 });
    expect(coinbaseCalls()).toBe(0);
    expect(liveCalls()).toBe(2);
  });

  it('a COINBASE_URL that is not acceptable is a deploy error (500), like MEMPOOL_URL', async () => {
    await expect(ask({ ...env, COINBASE_URL: 'http://api.coinbase.com', DEV_ALLOW_HTTP: '' })).rejects.toMatchObject({ status: 500 });
    expect(seen).toHaveLength(0);
  });

  it('nonsense from mempool is a failure too (retried, then Coinbase, then the last good price)', async () => {
    store.set(LAST_GOOD, { body: JSON.stringify({ usdCents: 8_000_000, asOf: 1_700_000_000_000, source: 'coinbase' }), cacheControl: null });
    reply = (url) => (url.pathname === SPOT ? down() : { status: 200, body: '{"USD":-1}' });
    expect(await ask()).toEqual({ usdCents: 8_000_000, asOf: 1_700_000_000_000, source: 'coinbase', stale: true });
    expect(liveCalls()).toBe(2);
  });

  it.each(['{"usdCents":1}', '{"usdCents":1,"asOf":5}', '{"usdCents":1,"asOf":5,"source":"elsewhere"}', 'junk'])('ignores a stored answer of the wrong shape (%s; an older Worker kept no time)', async (body) => {
    store.set(FRESH, { body, cacheControl: null });
    store.set(LAST_GOOD, { body, cacheControl: null });
    reply = down;
    await expect(ask()).rejects.toMatchObject({ status: 502 });
    reply = liveOk(95_000);
    expect(await ask()).toEqual({ usdCents: 9_500_000, asOf: expect.any(Number), source: 'mempool' });
  });

  it('a broken cache never fails the request', async () => {
    cacheBroken = true;
    reply = liveOk(95_000);
    expect(await ask()).toEqual({ usdCents: 9_500_000, asOf: expect.any(Number), source: 'mempool' });
  });
});

/** The Cache API, stood in for in Node, for the series' cache lifetime and its size limit. */
describe('price series (stand-in cache)', () => {
  const store = new Map<string, { body: string; cacheControl: string | null }>();
  const standIn = {
    match: (req: Request) => Promise.resolve(store.has(req.url) ? new Response(store.get(req.url)?.body) : undefined),
    put: async (req: Request, res: Response) => void store.set(req.url, { body: await res.text(), cacheControl: res.headers.get('Cache-Control') }),
  };
  const env = { ORIGIN, MEMPOOL_URL: FAKE, DEV_ALLOW_HTTP: '1' };
  const ask = async (days: number) => {
    const res = await priceSeries(new Request(`${ORIGIN}/api/price/series?days=${days}`, { headers: { 'Sec-Fetch-Site': 'same-origin' } }), env, new URL(`${ORIGIN}/api/price/series?days=${days}`)).catch((e: unknown) => e);
    return res instanceof Response ? ((await res.json()) as { points: [number, number, number][] }) : res;
  };
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('caches', { default: standIn });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the worked-out series an hour, for every window, in a body far smaller than mempool\'s', async () => {
    const whole = wholeHistory(MAX_SERIES_DAYS + 30);
    expect(whole.length).toBeGreaterThan(900_000); // near the size mempool sends today (about 1.1 MB)
    reply = () => ({ status: 200, body: whole });
    const three = await ask(1095);
    expect((three as { points: unknown[] }).points).toHaveLength(1095);
    const cachedSeries = store.get(`${ORIGIN}/__price/series/v1`);
    expect(cachedSeries?.cacheControl).toBe('public, max-age=3600');
    expect(JSON.parse(cachedSeries?.body ?? '{}').points).toHaveLength(MAX_SERIES_DAYS);
    expect(JSON.stringify(three).length).toBeLessThan(40_000);
    seen.length = 0;
    expect(((await ask(99_999)) as { points: unknown[] }).points).toHaveLength(MAX_SERIES_DAYS);
    expect(seen).toHaveLength(0);
  });

  it('a body over 3 MiB is refused (502)', async () => {
    reply = () => ({ status: 200, body: JSON.stringify({ prices: [{ time: now(), USD: 1 }], pad: 'x'.repeat(3 * 1024 * 1024) }) });
    expect(await ask(30)).toMatchObject({ status: 502 });
    expect(store.size).toBe(0);
  });
});

describe('same origin only, no session needed', () => {
  it('another site cannot use the price endpoints (Origin or Sec-Fetch-Site)', async () => {
    reply = historyOk(1);
    const c = new Client(server);
    const ts = pastHour();
    for (const path of ['/api/price', `/api/price/history?ts=${ts}`, '/api/price/series?days=30']) {
      expect((await c.get(path, { origin: 'https://evil.example' })).status, path).toBe(403);
      const crossSite = await server.fetch(`http://localhost${path}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
      expect(crossSite.status, path).toBe(403);
      expect(crossSite.headers.get('Access-Control-Allow-Origin')).toBeNull();
      await crossSite.arrayBuffer();
      const sameSite = await server.fetch(`http://localhost${path}`, { headers: { 'Sec-Fetch-Site': 'same-site' } });
      expect(sameSite.status, path).toBe(403);
      await sameSite.arrayBuffer();
    }
    expect(seen).toHaveLength(0);
    // The app's own page: no Origin on a same-origin GET, Sec-Fetch-Site same-origin, no cookie needed.
    const own = await server.fetch(`http://localhost/api/price/history?ts=${ts}`, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    expect(own.status).toBe(200);
    await own.arrayBuffer();
    expect((await new Client(server).get(`/api/price/history?ts=${ts}`, { origin: ORIGIN })).status).toBe(200);
  });

  it('only GET', async () => {
    expect((await new Client(server).post('/api/price', {})).status).toBe(405);
  });
});

describe('Coinbase amounts', () => {
  it('turns a decimal dollar string into integer cents, half up, without floats', () => {
    expect(decimalDollarsToCents('60195.12')).toBe(6_019_512);
    expect(decimalDollarsToCents('60195.125')).toBe(6_019_513);
    expect(decimalDollarsToCents('60195.12499999')).toBe(6_019_512);
    expect(decimalDollarsToCents('60195')).toBe(6_019_500);
    expect(decimalDollarsToCents('0.1')).toBe(10);
    expect(decimalDollarsToCents('99999999.99')).toBe(9_999_999_999);
    for (const bad of ['', '0', '0.00', '0.004', '-1', '1e5', ' 1', '1.', '.5', '1,000.00', '100000000.01', '1234567890', 60195.12, null]) {
      expect(decimalDollarsToCents(bad), String(bad)).toBeNull();
    }
  });
});

describe('COINBASE_URL', () => {
  it('defaults to api.coinbase.com, can be turned off, and follows the MEMPOOL_URL rules', () => {
    expect(coinbaseBase({})).toBe('https://api.coinbase.com');
    expect(coinbaseBase({ COINBASE_URL: '' })).toBe('https://api.coinbase.com');
    expect(coinbaseBase({ COINBASE_URL: 'off' })).toBe('off');
    expect(coinbaseBase({ COINBASE_URL: ' OFF ' })).toBe('off');
    expect(coinbaseBase({ COINBASE_URL: 'https://proxy.example.com/' })).toBe('https://proxy.example.com');
    for (const bad of ['http://api.coinbase.com', 'https://u:p@api.coinbase.com', 'https://api.coinbase.com/?x=1', 'nope']) expect(coinbaseBase({ COINBASE_URL: bad }), bad).toBeNull();
  });
});

describe('MEMPOOL_URL', () => {
  it('defaults to mempool.space and accepts a self-hosted https instance', () => {
    const env: { MEMPOOL_URL?: string; DEV_ALLOW_HTTP?: string } = {};
    expect(mempoolBase(env)).toBe('https://mempool.space');
    expect(mempoolBase({ ...env, MEMPOOL_URL: '' })).toBe('https://mempool.space');
    expect(mempoolBase({ ...env, MEMPOOL_URL: 'https://mempool.example.com/' })).toBe('https://mempool.example.com');
    expect(mempoolBase({ ...env, MEMPOOL_URL: 'https://node.example.com/mempool' })).toBe('https://node.example.com/mempool');
  });

  it('refuses http (outside local dev), credentials, queries and junk', () => {
    const env: { MEMPOOL_URL?: string; DEV_ALLOW_HTTP?: string } = {};
    for (const bad of ['http://mempool.example.com', 'https://u:p@mempool.example.com', 'https://m.example.com/?x=1', 'https://m.example.com/#x', 'not a url', 'ftp://m.example.com']) {
      expect(mempoolBase({ ...env, MEMPOOL_URL: bad }), bad).toBeNull();
    }
    expect(mempoolBase({ ...env, MEMPOOL_URL: 'http://127.0.0.1:1', DEV_ALLOW_HTTP: '1' })).toBe('http://127.0.0.1:1');
  });
});
