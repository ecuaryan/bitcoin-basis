// Public BTC/USD price, fetched server-side from mempool.space (or a self-hosted mempool at MEMPOOL_URL),
// so the browser never contacts a third party: no IP, Origin, Referer or cookies leave for mempool.
// Answers are cents per BTC (integers). No session is needed (the data is public), but only the app's own
// pages may ask, requests are rate limited, and answers are cached so mempool sees few calls.
import { mempoolBase } from './config.ts';
import { fail, json } from './http.ts';

export interface PriceEnv {
  ORIGIN: string;
  /** Base URL of a mempool instance. Default https://mempool.space (see `mempoolBase`). */
  MEMPOOL_URL?: string;
  DEV_ALLOW_HTTP?: string;
  PRICE_LIMITER?: RateLimit;
}

const HOUR = 3600;
/** The genesis block (2009-01-03). Nothing earlier has a price. */
const GENESIS = 1_231_006_505;
const LIVE_TTL = 60;
/** Past hours never change; the latest two hours may still be filled in upstream. */
const HISTORY_TTL = 30 * 24 * HOUR;
const RECENT_TTL = 5 * 60;
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_UPSTREAM_BYTES = 64 * 1024;

/** Dollars (number) to integer cents, or null if not a sane positive price. */
export function dollarsToCents(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100_000_000) return null;
  return Math.round(v * 100);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `?ts=<unix seconds>`, validated and rounded DOWN to the hour. */
export function historyHour(param: string | null, nowMs: number): number {
  if (param === null || !/^\d{1,11}$/.test(param)) fail(400);
  const ts = Number(param);
  if (ts < GENESIS || ts > Math.floor(nowMs / 1000)) fail(400);
  return ts - (ts % HOUR);
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
async function upstream(base: string, path: string): Promise<unknown> {
  try {
    const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) fail(502);
    const text = await res.text();
    if (text.length > MAX_UPSTREAM_BYTES) fail(502);
    return JSON.parse(text) as unknown;
  } catch {
    return fail(502);
  }
}

/** Cache API (per data centre). Best effort: a cache failure never fails the request. */
async function cached(key: string, ttl: number, produce: () => Promise<Record<string, unknown>>): Promise<Response> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const keyReq = new Request(key);
  const hit = await cache?.match(keyReq).catch(() => undefined);
  if (hit) return json(await hit.json());
  const body = await produce();
  const stored = json(body, 200, { 'Cache-Control': `public, max-age=${ttl}` });
  await cache?.put(keyReq, stored).catch(() => undefined);
  return json(body);
}

export async function livePrice(req: Request, env: PriceEnv): Promise<Response> {
  sameOriginOnly(req, env.ORIGIN);
  const base = mempoolBase(env) ?? fail(500);
  await limit(req, env);
  return cached(`${env.ORIGIN}/__price/live`, LIVE_TTL, async () => {
    const data = await upstream(base, '/api/v1/prices');
    const usdCents = isRecord(data) ? dollarsToCents(data['USD']) : null;
    if (usdCents === null) fail(502);
    return { usdCents };
  });
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
