// The service worker (app/public/sw.js) run in a sandbox with fake caches and network.
// Regression for review 3: an API answer, an error page or the single-page-app fallback must never become
// the offline shell or a cached build file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://bb.example.workers.dev';
type FetchEvent = { request: Request; respondWith(p: Promise<Response>): void; waitUntil(p: Promise<unknown>): void };
type Handler = (event: FetchEvent) => void;

const html = (body = '<!doctype html><div id="root"></div>', status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const typed = (body: string, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } });

function loadSw(network: (req: Request) => Promise<Response>, { precache = [] as string[], existingCaches = [] as string[] } = {}) {
  const store = new Map<string, Response>();
  const keyOf = (key: Request | string) => (typeof key === 'string' ? key : new URL(key.url).pathname);
  const cache = {
    put: (key: Request | string, res: Response) => {
      store.set(keyOf(key), res);
      return Promise.resolve();
    },
    match: (key: Request | string) => Promise.resolve(store.get(keyOf(key))),
  };
  const cacheNames = new Set(existingCaches);
  const posted: unknown[] = [];
  const handlers: Record<string, Handler> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, h: Handler) => (handlers[t] = h),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([{ postMessage: (m: unknown) => posted.push(m) }]) },
  };
  const caches = {
    open: (name: string) => {
      cacheNames.add(name);
      return Promise.resolve(cache);
    },
    match: cache.match,
    keys: () => Promise.resolve([...cacheNames]),
    delete: (name: string) => Promise.resolve(cacheNames.delete(name)),
  };
  const fetchImpl = (input: Request | string) => network(typeof input === 'string' ? new Request(new URL(input, ORIGIN)) : input);
  const src = readFileSync(resolve(import.meta.dirname, '../public/sw.js'), 'utf8')
    .replace("'__BB_VERSION__'", '"v2"')
    .replace("'__BB_PRECACHE__'", JSON.stringify(precache));
  runInNewContext(src, { self, caches, fetch: fetchImpl, URL, Response, Request, Promise, Array, JSON, Error });

  /** Runs an extendable event and waits for everything it started. */
  const run = async (type: string, request?: Request): Promise<Response | null> => {
    let out: Promise<Response> | null = null;
    const pending: Promise<unknown>[] = [];
    handlers[type]?.({ request: request as Request, respondWith: (p) => (out = p), waitUntil: (p) => void pending.push(p) });
    const res = out ? await out : null;
    while (pending.length) await pending.shift();
    return res;
  };
  return { store, cacheNames, posted, run, fetch: (req: Request) => run('fetch', req) };
}

function nav(path: string): Request {
  const r = new Request(ORIGIN + path);
  Object.defineProperty(r, 'mode', { value: 'navigate' });
  return r;
}

describe('offline shell', () => {
  it('a navigation that answers the app (200 text/html) becomes the shell', async () => {
    const sw = loadSw(() => Promise.resolve(html()));
    await sw.fetch(nav('/holdings'));
    expect(await sw.store.get('/')?.clone().text()).toContain('id="root"');
  });

  it('an API URL, an error status or a non-HTML page never replaces the shell', async () => {
    const sw = loadSw((req) => {
      const p = new URL(req.url).pathname;
      if (p === '/') return Promise.resolve(html());
      if (p === '/oops') return Promise.resolve(html('<h1>Error 1101</h1>', 500));
      if (p === '/text') return Promise.resolve(typed('plain', 'text/plain'));
      return Promise.resolve(typed('{"error":"unauthorized"}', 'application/json', 401));
    });
    await sw.fetch(nav('/'));
    // e.g. <a href="https://bb.example.workers.dev/api/blobs"> on any website: not even intercepted.
    expect(await sw.fetch(nav('/api/blobs'))).toBeNull();
    const err = await sw.fetch(nav('/oops'));
    expect(err?.status).toBe(500); // the page still gets the real answer
    await sw.fetch(nav('/text'));
    expect(await sw.store.get('/')?.clone().text()).toContain('id="root"');
  });

  it('offline, a navigation gets the cached shell', async () => {
    let online = true;
    const sw = loadSw(() => (online ? Promise.resolve(html()) : Promise.reject(new TypeError('offline'))));
    await sw.fetch(nav('/'));
    online = false;
    expect(await (await sw.fetch(nav('/records')))?.text()).toContain('id="root"');
  });
});

describe('build files', () => {
  it('a missing chunk answered with index.html (the SPA fallback) is not cached under the .js name', async () => {
    const sw = loadSw(() => Promise.resolve(html()));
    await sw.fetch(new Request(`${ORIGIN}/assets/WhatIf-OLDHASH.js`));
    expect(sw.store.has('/assets/WhatIf-OLDHASH.js')).toBe(false);
  });

  it('a 404 or an error is not cached', async () => {
    const sw = loadSw(() => Promise.resolve(typed('{"error":"not_found"}', 'application/json', 404)));
    expect((await sw.fetch(new Request(`${ORIGIN}/assets/a-1.js`)))?.status).toBe(404);
    expect(sw.store.size).toBe(0);
  });

  it.each([
    ['/assets/index-abc.js', 'text/javascript; charset=utf-8'],
    ['/assets/index-abc.js', 'application/javascript'],
    ['/assets/index-abc.css', 'text/css; charset=utf-8'],
    ['/assets/inter-latin-wght-normal-abc.woff2', 'font/woff2'],
    ['/icons/icon-192.png', 'image/png'],
    ['/icons/logo-mark.webp', 'image/webp'],
  ])('%s served as %s is cached, then served from the cache', async (path, type) => {
    let calls = 0;
    const sw = loadSw(() => {
      calls += 1;
      return Promise.resolve(typed('x', type));
    });
    await sw.fetch(new Request(ORIGIN + path));
    expect(sw.store.has(path)).toBe(true);
    await sw.fetch(new Request(ORIGIN + path));
    expect(calls).toBe(1);
  });

  it.each([
    ['/assets/index-abc.js', 'text/css'],
    ['/assets/index-abc.css', 'text/javascript'],
    ['/icons/icon-192.png', 'text/html'],
    ['/assets/unknown.bin', 'application/octet-stream'],
  ])('%s served as %s (wrong type for its extension) is not cached', async (path, type) => {
    const sw = loadSw(() => Promise.resolve(typed('x', type)));
    await sw.fetch(new Request(ORIGIN + path));
    expect(sw.store.has(path)).toBe(false);
  });

  it('the API and the price are never intercepted or cached', async () => {
    const sw = loadSw(() => Promise.resolve(typed('{"usdCents":1}', 'application/json')));
    expect(await sw.fetch(new Request(`${ORIGIN}/api/price`))).toBeNull();
    expect(sw.store.size).toBe(0);
  });
});

describe('install and update', () => {
  it('install refuses a precache entry with the wrong type (no poisoned shell)', async () => {
    const sw = loadSw((req) => Promise.resolve(new URL(req.url).pathname === '/' ? html() : html('fallback')), { precache: ['/assets/index-abc.js'] });
    await expect(sw.run('install')).rejects.toThrow(/precache/);
  });

  it('install stores the shell and the build files', async () => {
    const sw = loadSw((req) => Promise.resolve(new URL(req.url).pathname === '/' ? html() : typed('x', 'text/javascript')), { precache: ['/assets/index-abc.js'] });
    await sw.run('install');
    expect([...sw.store.keys()].sort()).toEqual(['/', '/assets/index-abc.js']);
  });

  it('a new version taking over deletes the old cache and tells open pages', async () => {
    const sw = loadSw(() => Promise.resolve(html()), { existingCaches: ['bb-shell-v1', 'bb-shell-v2', 'other'] });
    await sw.run('activate');
    expect([...sw.cacheNames].sort()).toEqual(['bb-shell-v2', 'other']);
    expect(sw.posted).toEqual([{ type: 'bb-sw-updated', version: 'v2' }]);
  });

  it('the first install does not announce an update', async () => {
    const sw = loadSw(() => Promise.resolve(html()), { existingCaches: ['bb-shell-v2'] });
    await sw.run('activate');
    expect(sw.posted).toEqual([]);
  });
});
