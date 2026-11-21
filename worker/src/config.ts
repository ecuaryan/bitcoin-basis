// Deployment sanity checks: the API config (run before every API request) and the price source URLs.

export interface ConfigVars {
  ORIGIN?: string;
  RP_ID?: string;
  SESSION_SECRET?: string;
  DEV_ALLOW_HTTP?: string;
}

/**
 * The API refuses to run (500) unless SESSION_SECRET is long enough and ORIGIN is a bare https
 * origin whose hostname is RP_ID. Plain http is allowed only with DEV_ALLOW_HTTP=1, which is set
 * in worker/.dev.vars for `wrangler dev` and nowhere else.
 */
export function configOk(env: ConfigVars): boolean {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || !env.ORIGIN || !env.RP_ID) return false;
  let url: URL;
  try {
    url = new URL(env.ORIGIN);
  } catch {
    return false;
  }
  if (url.origin !== env.ORIGIN) return false;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && env.DEV_ALLOW_HTTP === '1')) return false;
  return url.hostname === env.RP_ID;
}

export const DEFAULT_MEMPOOL = 'https://mempool.space';
/** The second source for the live price only (Coinbase's public spot price; no key, no account). */
export const DEFAULT_COINBASE = 'https://api.coinbase.com';

/** A price source base URL: https (http only with DEV_ALLOW_HTTP=1), no credentials, query or fragment, no trailing slash. */
function sourceBase(value: string | undefined, fallback: string, devAllowHttp: string | undefined): string | null {
  const raw = value?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const httpOk = url.protocol === 'https:' || (url.protocol === 'http:' && devAllowHttp === '1');
  if (!httpOk || url.username || url.password || url.search || url.hash) return null;
  return url.href.replace(/\/+$/, '');
}

/** The mempool base URL (live and historical prices), or null if MEMPOOL_URL is not acceptable. */
export function mempoolBase(env: { MEMPOOL_URL?: string; DEV_ALLOW_HTTP?: string }): string | null {
  return sourceBase(env.MEMPOOL_URL, DEFAULT_MEMPOOL, env.DEV_ALLOW_HTTP);
}

/**
 * The second live-price source, asked only when mempool fails: `off` when COINBASE_URL is `off` (self-hosters who
 * want mempool alone), null if it is not acceptable, else its base URL (default api.coinbase.com).
 */
export function coinbaseBase(env: { COINBASE_URL?: string; DEV_ALLOW_HTTP?: string }): string | 'off' | null {
  if (env.COINBASE_URL?.trim().toLowerCase() === 'off') return 'off';
  return sourceBase(env.COINBASE_URL, DEFAULT_COINBASE, env.DEV_ALLOW_HTTP);
}
