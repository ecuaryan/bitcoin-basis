// Deployment sanity check, run before every API request.

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
