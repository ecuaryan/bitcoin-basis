import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../src/headers.ts';
import { Client, startServer, WORKER_DIR, wranglerConfig } from './harness.ts';

const server = startServer();
beforeAll(() => server.listen(), 60_000);
afterAll(() => server.close());

function expectSecurityHeaders(headers: { get(name: string): string | null }, label: string) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name), `${label}: ${name}`).toBe(value);
}

describe('security headers', () => {
  it('are on API responses, success and error, with no-store and no CORS', async () => {
    const c = new Client(server);
    for (const res of [await c.get('/api/status'), await c.get('/api/nope'), await c.post('/api/login/options', {}, { origin: 'https://evil.example' })]) {
      expectSecurityHeaders(res.headers, `API ${res.status}`);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('are on static assets, including the single-page-app fallback', async () => {
    for (const path of ['/', '/app.js', '/holdings/some/deep/link']) {
      const res = await server.fetch(`http://localhost${path}`);
      expect(res.status, path).toBe(200);
      expectSecurityHeaders(res.headers, path);
      await res.arrayBuffer();
    }
  });

  it('app/public/_headers carries exactly the Worker set, for every path', () => {
    const text = readFileSync(resolve(WORKER_DIR, '../app/public/_headers'), 'utf8');
    const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    expect(lines[0]).toBe('/*');
    const parsed = Object.fromEntries(lines.slice(1).map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }));
    expect(parsed).toEqual(SECURITY_HEADERS);
  });
});

describe('configuration', () => {
  it('runs Worker code only for /api/*, serves the app as a SPA, and wires the buckets and cron', () => {
    const cfg = wranglerConfig() as ReturnType<typeof wranglerConfig> & { r2_buckets: { binding: string }[]; triggers: { crons: string[] } };
    expect(cfg.name).toBe('bitcoin-basis');
    expect(cfg.assets).toEqual({ directory: '../app/dist', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] });
    expect(cfg.r2_buckets.map((b) => b.binding)).toEqual(['DATA', 'BACKUP']);
    expect(Object.keys(cfg.vars).sort()).toEqual(['ORIGIN', 'RP_ID', 'RP_NAME']);
    expect(cfg.triggers.crons).toHaveLength(1);
    expect(cfg.observability).toEqual({ enabled: false });
  });

  it('has no delete and no unconditional put anywhere in the Worker source', () => {
    const dir = join(WORKER_DIR, 'src');
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, file).not.toMatch(/\.delete\s*\(/);
      for (const call of src.matchAll(/\.put\(([^;]*)\)/g)) expect(call[1], `${file}: ${call[0]}`).toMatch(/ONLY_IF_NEW/);
    }
  });
});
