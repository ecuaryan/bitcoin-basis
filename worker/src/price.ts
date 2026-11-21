// Public BTC/USD price, fetched server-side from mempool.space (or a self-hosted mempool at MEMPOOL_URL),
// so the browser never contacts a third party: no IP, Origin, Referer or cookies leave for the source.
// Answers are cents per BTC (integers). No session is needed (the data is public), but only the app's own
// pages may ask, requests are rate limited, and answers are cached so the sources see few calls.
// The live price: mempool, asked twice at most; if it still fails, Coinbase's public spot price (COINBASE_URL,
// `off` to skip it); if that fails too, the last good price, kept for a few hours and marked stale with the
// time it is from. Only with none of these is it an error. Historical prices come from mempool alone, one hour at
// a time (`/api/price/history`) or as a daily series for the chart (`/api/price/series`, from one upstream call).
import { coinbaseBase, mempoolBase } from './config.ts';
import { fail, HttpError, json } from './http.ts';

export interface PriceEnv {
  ORIGIN: string;
  /** Base URL of a mempool instance. Default https://mempool.space (see `mempoolBase`). */
  MEMPOOL_URL?: string;
  /** Base URL of the second live-price source, Coinbase's API. Default https://api.coinbase.com; `off` skips it. */
  COINBASE_URL?: string;
  DEV_ALLOW_HTTP?: string;
  /** Cloudflare's rate-limit binding (`RateLimit`), described by the one method used so tests can load this file. */
  PRICE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const HOUR = 3600;
const UPSTREAM_TIMEOUT_MS = 8000;
/** The genesis block (2009-01-03). Nothing earlier has a price. */
const GENESIS = 1_231_006_505;
const LIVE_TTL = 60;
/** How long the last good live price is kept, to answer with (marked stale) while mempool is down. */
const LAST_GOOD_TTL = 6 * HOUR;
/** Pause before the one retry of mempool's live price. */
const RETRY_PAUSE_MS = 250;
/** The retry happens only if at least this much of mempool's time is left. */
const MIN_RETRY_MS = 1000;
/**
 * A live lookup takes at most UPSTREAM_TIMEOUT_MS in all, as a single upstream call always could: mempool (both
 * tries and the pause) gets LIVE_MEMPOOL_MS, Coinbase the rest.
 */
const LIVE_MEMPOOL_MS = 5000;
const LIVE_COINBASE_MS = UPSTREAM_TIMEOUT_MS - LIVE_MEMPOOL_MS;
/** Past hours never change; the latest two hours may still be filled in upstream. */
const HISTORY_TTL = 30 * 24 * HOUR;
const RECENT_TTL = 5 * 60;
const MAX_UPSTREAM_BYTES = 64 * 1024;
const DAY = 24 * HOUR;
/** The whole history in one answer is about 1.1 MB (2026); room to grow, still bounded. */
const MAX_SERIES_BYTES = 3 * 1024 * 1024;
/** The daily series covers at most ten years; asking for more answers this much. */
export const MAX_SERIES_DAYS = 3660;
/** The series is worked out from one upstream call and kept this long, so mempool sees about one call an hour. */
const SERIES_TTL = HOUR;

/** Dollars (number) to integer cents, or null if not a sane positive price. */
export function dollarsToCents(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100_000_000) return null;
  return Math.round(v * 100);
}

/** A decimal dollar string (`"60195.12"`, as Coinbase sends) to integer cents, half up, without floats; null if not a sane price. */
export function decimalDollarsToCents(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,9})(?:\.(\d{1,12}))?$/.exec(v);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(3, '0');
  const cents = Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return cents > 0 && cents <= 10_000_000_000 ? cents : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `?ts=<unix seconds>`, validated and rounded DOWN to the hour. */
export function historyHour(param: string | null, nowMs: number): number {
  if (param === null || !/^\d{1,11}$/.test(param)) fail(400);
  const ts = Number(param);
  if (ts < GENESIS || ts > Math.floor(nowMs / 1000)) fail(400);
  return ts - (ts % HOUR);
}

/** `?days=<whole days>`, 1 or more; more than MAX_SERIES_DAYS is capped. */
export function seriesDays(param: string | null): number {
  if (param === null || !/^\d{1,6}$/.test(param)) fail(400);
  const days = Number(param);
  if (days < 1) fail(400);
  return Math.min(days, MAX_SERIES_DAYS);
}

/** Only the app's own pages (or the address bar) may ask: no other site can use this as a proxy. */
function sameOriginOnly(req: Request, origin: string): void {
  const site = req.headers.get('Sec-Fetch-Site');
  if (site !== null && site !== 'same-origin' && site !== 'none') fail(403);
  const from = req.headers.get('Origin');
  if (from !== null && from !== origin) fail(403);
}

async function limit(req: Request, env: PriceEnv): Promise<void> {
  if (!env.PRICE_LIMITER) return;
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await env.PRICE_LIMITER.limit({ key: `price:${ip}` })).success) fail(429);
}

/** GETs JSON from mempool: no cookies, no Origin, no Referer, no redirects, bounded size and time. Any failure is a 502. */
async function upstream(base: string, path: string, timeoutMs = UPSTREAM_TIMEOUT_MS, maxBytes = MAX_UPSTREAM_BYTES): Promise<unknown> {
  try {
    const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) fail(502);
    if (Number(res.headers.get('Content-Length') ?? 0) > maxBytes) fail(502);
    const text = await res.text();
    if (text.length > maxBytes) fail(502);
    return JSON.parse(text) as unknown;
  } catch {
    return fail(502);
  }
}

/** Cache API (per data centre). Best effort: a cache failure never fails the request. */
const edgeCache = (): Cache | undefined => (globalThis as { caches?: { default?: Cache } }).caches?.default;

async function cacheGet(key: string): Promise<unknown> {
  const hit = await edgeCache()?.match(new Request(key)).catch(() => undefined);
  return hit ? ((await hit.json().catch(() => null)) as unknown) : null;
}

async function cachePut(key: string, body: Record<string, unknown>, ttl: number): Promise<void> {
  await edgeCache()?.put(new Request(key), json(body, 200, { 'Cache-Control': `public, max-age=${ttl}` })).catch(() => undefined);
}

async function cached(key: string, ttl: number, produce: () => Promise<Record<string, unknown>>): Promise<Response> {
  const hit = await cacheGet(key);
  if (hit !== null) return json(hit);
  const body = await produce();
  await cachePut(key, body, ttl);
  return json(body);
}

type LiveSource = 'mempool' | 'coinbase';

interface LiveAnswer {
  usdCents: number;
  /** When the Worker fetched this price from its source (ms since epoch). */
  asOf: number;
  /** Where it came from, so the app can name it (an entry's note says where its price came from). */
  source: LiveSource;
}

/** A stored live answer, or null if absent or not the current shape. */
function asLive(v: unknown): LiveAnswer | null {
  if (!isRecord(v)) return null;
  const { usdCents, asOf, source } = v;
  if (typeof usdCents !== 'number' || !Number.isSafeInteger(usdCents) || usdCents <= 0) return null;
  if (typeof asOf !== 'number' || !Number.isSafeInteger(asOf) || asOf <= 0) return null;
  if (source !== 'mempool' && source !== 'coinbase') return null;
  return { usdCents, asOf, source };
}

async function mempoolOnce(base: string, timeoutMs: number): Promise<number> {
  const data = await upstream(base, '/api/v1/prices', timeoutMs);
  return (isRecord(data) ? dollarsToCents(data['USD']) : null) ?? fail(502);
}

/** mempool's live price, asked once more after a failure, both tries within LIVE_MEMPOOL_MS. */
async function mempoolLive(base: string): Promise<number> {
  const start = Date.now();
  try {
    return await mempoolOnce(base, LIVE_MEMPOOL_MS);
  } catch {
    await new Promise((done) => setTimeout(done, RETRY_PAUSE_MS));
    const left = LIVE_MEMPOOL_MS - (Date.now() - start);
    if (left < MIN_RETRY_MS) fail(502);
    return mempoolOnce(base, left);
  }
}

/** Coinbase's public spot price: `{ "data": { "amount": "60195.12", "base": "BTC", "currency": "USD" } }`, strictly. */
async function coinbaseLive(base: string): Promise<number> {
  const body = await upstream(base, '/v2/prices/BTC-USD/spot', LIVE_COINBASE_MS);
  const data = isRecord(body) ? body['data'] : null;
  if (!isRecord(data) || data['base'] !== 'BTC' || data['currency'] !== 'USD') return fail(502);
  return decimalDollarsToCents(data['amount']) ?? fail(502);
}

/** The live price from mempool, else from Coinbase (unless turned off). Any failure of both is a 502. */
async function liveFromUpstream(mempool: string, coinbase: string | 'off'): Promise<{ usdCents: number; source: LiveSource }> {
  try {
    return { usdCents: await mempoolLive(mempool), source: 'mempool' };
  } catch (e) {
    if (coinbase === 'off') throw e;
    return { usdCents: await coinbaseLive(coinbase), source: 'coinbase' };
  }
}

/**
 * `{ usdCents, asOf, source }`, cached for a minute. If mempool (twice) and Coinbase fail, the last good price (kept
 * 6 hours) with `stale: true`; a 502 only when there is none.
 */
export async function livePrice(req: Request, env: PriceEnv): Promise<Response> {
  sameOriginOnly(req, env.ORIGIN);
  const mempool = mempoolBase(env) ?? fail(500);
  const coinbase = coinbaseBase(env) ?? fail(500);
  await limit(req, env);
  const freshKey = `${env.ORIGIN}/__price/live`;
  const lastGoodKey = `${env.ORIGIN}/__price/live-last-good`;
  const fresh = asLive(await cacheGet(freshKey));
  if (fresh !== null) return json(fresh);
  let answer: LiveAnswer;
  try {
    answer = { ...(await liveFromUpstream(mempool, coinbase)), asOf: Date.now() };
  } catch (e) {
    const lastGood = e instanceof HttpError && e.status === 502 ? asLive(await cacheGet(lastGoodKey)) : null;
    if (lastGood === null) throw e;
    return json({ ...lastGood, stale: true });
  }
  await Promise.all([cachePut(freshKey, { ...answer }, LIVE_TTL), cachePut(lastGoodKey, { ...answer }, LAST_GOOD_TTL)]);
  return json(answer);
}

export async function historicalPrice(req: Request, env: PriceEnv, url: URL, nowMs = Date.now()): Promise<Response> {
  sameOriginOnly(req, env.ORIGIN);
  const ts = historyHour(url.searchParams.get('ts'), nowMs);
  const base = mempoolBase(env) ?? fail(500);
  await limit(req, env);
  const recent = Math.floor(nowMs / 1000) - ts < 2 * HOUR;
  return cached(`${env.ORIGIN}/__price/history/${ts}`, recent ? RECENT_TTL : HISTORY_TTL, async () => {
    const data = await upstream(base, `/api/v1/historical-price?currency=USD&timestamp=${ts}`);
    if (!isRecord(data) || !Array.isArray(data['prices'])) return fail(502);
    const prices = data['prices'] as unknown[];
    if (prices.length === 0) fail(404); // no price for that hour
    const first = prices[0];
    const usdCents = isRecord(first) ? dollarsToCents(first['USD']) : null;
    if (usdCents === null) fail(502);
    return { ts, usdCents };
  });
}

/** One UTC day of the series: its start (unix seconds), the last price that day and the highest, in cents. */
export type SeriesDay = [day: number, closeCents: number, highCents: number];

/**
 * mempool's whole history (`{ prices: [{ time, USD }, ...] }`, hourly lately, daily or weekly further back, in any
 * order) to one point per UTC day from `fromSec` on, oldest first. Each day keeps its last price and its highest,
 * so a peak inside a day survives. Strict: anything but that shape, or a price in the window that is not a sane
 * positive number, is null.
 */
export function dailySeries(data: unknown, fromSec: number): SeriesDay[] | null {
  if (!isRecord(data) || !Array.isArray(data['prices'])) return null;
  const days = new Map<number, { closeAt: number; close: number; high: number }>();
  for (const p of data['prices'] as unknown[]) {
    if (!isRecord(p)) return null;
    const { time, USD } = p;
    if (typeof time !== 'number' || !Number.isSafeInteger(time) || time < 0 || typeof USD !== 'number' || !Number.isFinite(USD)) return null;
    if (time < fromSec) continue;
    const cents = dollarsToCents(USD);
    if (cents === null) return null;
    const day = time - (time % DAY);
    const d = days.get(day);
    if (d === undefined) days.set(day, { closeAt: time, close: cents, high: cents });
    else {
      if (time >= d.closeAt) Object.assign(d, { closeAt: time, close: cents });
      d.high = Math.max(d.high, cents);
    }
  }
  return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([day, d]): SeriesDay => [day, d.close, d.high]);
}

/** A stored series, or null if absent or not the current shape. */
function asSeries(v: unknown): SeriesDay[] | null {
  if (!isRecord(v) || !Array.isArray(v['points'])) return null;
  const ok = (v['points'] as unknown[]).every((p) => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0));
  return ok ? (v['points'] as SeriesDay[]) : null;
}

/**
 * `{ points: [[dayStart, closeCents, highCents], ...] }` for the last `?days=` UTC days (today included), oldest
 * first: the price chart's history in one request. Worked out from one call for mempool's whole history, kept an
 * hour for every window. A 502 when mempool fails or sends nothing for the window.
 */
export async function priceSeries(req: Request, env: PriceEnv, url: URL, nowMs = Date.now()): Promise<Response> {
  sameOriginOnly(req, env.ORIGIN);
  const days = seriesDays(url.searchParams.get('days'));
  const base = mempoolBase(env) ?? fail(500);
  await limit(req, env);
  const now = Math.floor(nowMs / 1000);
  const today = now - (now % DAY);
  const key = `${env.ORIGIN}/__price/series/v1`;
  let all = asSeries(await cacheGet(key));
  if (all === null) {
    const data = await upstream(base, '/api/v1/historical-price?currency=USD', UPSTREAM_TIMEOUT_MS, MAX_SERIES_BYTES);
    all = dailySeries(data, today - (MAX_SERIES_DAYS - 1) * DAY) ?? fail(502);
    if (all.length === 0) fail(502);
    await cachePut(key, { points: all }, SERIES_TTL);
  }
  const from = today - (days - 1) * DAY;
  const points = all.filter((p) => p[0] >= from);
  if (points.length === 0) fail(502);
  return json({ points });
}
