// Bitcoin Basis service worker: caches the built app shell so it opens offline.
// The build step replaces the PRECACHE list and VERSION below (see vite.config.ts).
// - hashed assets under /assets/ and icons: cache-first (their names change when content changes)
// - navigations: network-first, falling back to the cached shell
// - /api/* (the sync API and the price) and anything else: left to the network, never cached
// Only a genuine response is ever stored: status 200 and the content type the file should have. An error
// page, an API answer or the single-page-app fallback (index.html under a .js name) is never cached.
const VERSION = '__BB_VERSION__';
const PRECACHE = '__BB_PRECACHE__';
const CACHE = `bb-shell-${VERSION}`;
const PREFIX = 'bb-shell-';

/** Expected Content-Type (start of it) per file extension. Anything not listed is not cached. */
const TYPES = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  woff2: 'font/woff2',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
};

const typeOf = (res) => (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

/** The app shell: a 200 HTML page. */
function isShell(res) {
  return res.ok && res.status === 200 && typeOf(res) === 'text/html';
}

/** A build file: 200 and the content type its extension calls for (`application/javascript` counts as JS). */
function isAsset(pathname, res) {
  if (!res.ok || res.status !== 200) return false;
  const ext = (pathname.match(/\.([a-z0-9]+)$/i) || [])[1];
  const want = ext ? TYPES[ext.toLowerCase()] : undefined;
  if (!want) return false;
  const got = typeOf(res);
  if (want === 'text/javascript') return got === 'text/javascript' || got === 'application/javascript';
  if (want === 'application/manifest+json') return got === want || got === 'application/json';
  return got.startsWith(want);
}

self.addEventListener('install', (event) => {
  const urls = Array.isArray(PRECACHE) ? PRECACHE : [];
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          ['/', ...urls].map((url) =>
            fetch(url, { cache: 'reload' }).then((res) => {
              const ok = url === '/' ? isShell(res) : isAsset(new URL(url, self.location.origin).pathname, res);
              if (!ok) throw new Error(`precache: unexpected response for ${url}`);
              return c.put(url, res);
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        const old = keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE);
        await Promise.all(old.map((k) => caches.delete(k)));
        await self.clients.claim();
        // An update (an older version was installed): tell open pages, so they can offer a reload.
        if (old.length > 0) {
          const pages = await self.clients.matchAll({ type: 'window' });
          for (const page of pages) page.postMessage({ type: 'bb-sw-updated', version: VERSION });
        }
      }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (isShell(res)) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((c) => c.put('/', copy)));
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (isAsset(url.pathname, res)) {
              const copy = res.clone();
              event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
            }
            return res;
          }),
      ),
    );
  }
});
