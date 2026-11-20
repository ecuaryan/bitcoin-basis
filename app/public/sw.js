// Bitcoin Basis service worker: caches the built app shell so it opens offline.
// The build step replaces the PRECACHE list and VERSION below (see vite.config.ts).
// - hashed assets under /assets/: cache-first (their names change when content changes)
// - index.html (navigations): network-first, falling back to the cached shell
// Anything else (including mempool.space price calls) is left to the network.
const VERSION = '__BB_VERSION__';
const PRECACHE = '__BB_PRECACHE__';
const CACHE = `bb-shell-${VERSION}`;

self.addEventListener('install', (event) => {
  const urls = Array.isArray(PRECACHE) ? PRECACHE : [];
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', ...urls])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bb-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
