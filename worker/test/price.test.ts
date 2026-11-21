// The public price endpoints: the Worker fetches mempool server-side (a local fake here), so the browser
// never contacts a third party. Input is validated, timestamps are rounded down to the hour, answers are
// cached, and any upstream trouble is a 502 JSON error.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mempoolBase } from '../src/config.ts';
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

const server = startServer({ MEMPOOL_URL: FAKE, DEV_ALLOW_HTTP: '1' });
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

describe('GET /api/price', () => {
  it('answers the live USD price in integer cents, cached for a minute', async () => {
    reply = (url) => (url.pathname === '/api/v1/prices' ? { status: 200, body: JSON.stringify({ time: 1, USD: 101_000, EUR: 93_000 }) } : { status: 404, body: '' });
    const c = new Client(server);
    const res = await c.get('/api/price');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ usdCents: 10_100_000 });
    const calls = seen.length;
    expect((await c.get('/api/price')).data).toEqual({ usdCents: 10_100_000 });
    expect(seen.length).toBe(calls);
  });
});

describe('same origin only, no session needed', () => {
  it('another site cannot use the price endpoints (Origin or Sec-Fetch-Site)', async () => {
    reply = historyOk(1);
    const c = new Client(server);
    const ts = pastHour();
    for (const path of ['/api/price', `/api/price/history?ts=${ts}`]) {
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
