import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Strict CSP, written into the built index.html only. The dev server needs inline
 * scripts/styles for hot reload, so dev runs without it; `npm run preview` serves the real thing.
 */
const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  // The only Trusted Types policy: `sw` in src/register-sw.ts (allows exactly /sw.js).
  'trusted-types sw',
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'bb-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

/** Fills the service worker's precache list with the hashed files this build produced. */
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'bb-sw-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle(_options, bundle) {
      // Latin font subsets only; other unicode ranges are cached when first used.
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && (!f.endsWith('.woff2') || f.includes('-latin-wght-')));
      const statics = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-48.png', '/icons/favicon-32.png', '/icons/favicon-16.png', '/icons/icon-maskable-512.png', '/icons/logo-mark.webp'];
      const urls = [...files.filter((f) => f !== 'index.html').map((f) => `/${f}`), ...statics].sort();
      const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12);
      const path = resolve(outDir, 'sw.js');
      const src = readFileSync(path, 'utf8').replace("'__BB_VERSION__'", JSON.stringify(version)).replace("'__BB_PRECACHE__'", JSON.stringify(urls));
      writeFileSync(path, src);
    },
  };
}

export default defineConfig(({ mode }) => ({
  // The fake server and authenticator exist only in `--mode fake` (the e2e build). Every other mode gets `false`,
  // so the bundler removes them. There is deliberately no environment variable that can switch this on.
  define: { __BB_FAKE__: JSON.stringify(mode === 'fake') },
  plugins: [react(), tailwindcss(), cspMeta(), serviceWorkerManifest()],
  build: { outDir: 'dist', sourcemap: false, target: 'es2023' },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
}));
