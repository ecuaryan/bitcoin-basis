// Runs the real Worker (worker/wrangler.jsonc) in workerd with local R2 and static
// assets, via wrangler's test harness. Only the assets folder, vars and secrets differ.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { createTestHarness, type TestHarness } from 'wrangler';
import { b64u, SoftAuthenticator } from './authenticator.ts';

export const WORKER_DIR = resolve(import.meta.dirname, '..');
export const ORIGIN = 'https://basis.example.test';
export const RP_ID = 'basis.example.test';
export const SESSION_SECRET = 'test-session-secret-0123456789-abcdefghij';
export const SETUP_CODE = 'test-setup-code-0123456789';

/** The real wrangler.jsonc, parsed (it's JSONC). */
export function wranglerConfig(): Record<string, unknown> & { assets: Record<string, unknown>; vars: Record<string, string> } {
  const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(join(WORKER_DIR, 'wrangler.jsonc'), 'utf8'));
  if (error) throw new Error('wrangler.jsonc does not parse');
  return config;
}

/** A small static site standing in for app/dist, with the real app/public/_headers. */
function fakeAssets(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bb-assets-'));
  copyFileSync(resolve(WORKER_DIR, '../app/public/_headers'), join(dir, '_headers'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Bitcoin Basis</title><script type="module" src="/app.js"></script>');
  writeFileSync(join(dir, 'app.js'), 'console.log("app");');
  return dir;
}

export function startServer(): TestHarness {
  const raw = wranglerConfig();
  delete raw.$schema;
  return createTestHarness({
    root: WORKER_DIR,
    workers: [{
      config: {
        ...raw,
        main: join(WORKER_DIR, 'src/index.ts'),
        assets: { ...raw.assets, directory: fakeAssets() },
        vars: { ...raw.vars, ORIGIN, RP_ID, SESSION_SECRET, SETUP_CODE },
      },
    }],
  });
}

const rand = (n: number) => b64u(randomBytes(n));
export const sha256b64u = (b: Uint8Array) => b64u(createHash('sha256').update(b).digest());

/** Fake app-side key material in the exact shapes the protocol requires. */
export function fakeVault() {
  const authToken = randomBytes(32);
  return {
    vaultId: rand(16),
    authToken: b64u(authToken),
    recovery: { salt: rand(32), authVerifier: sha256b64u(authToken), wrappedDk: rand(60) },
  };
}

export const fakeCredentialKeys = () => ({ prfSalt: rand(32), wrappedDk: rand(60) });

/** A sealed blob of a valid size: version byte 1, then random bytes. */
export function fakeBlob(bucketKiB = 1): Uint8Array {
  const b = new Uint8Array(randomBytes(bucketKiB * 1024 + 29));
  b[0] = 1;
  return b;
}

/** Signs a token exactly like the Worker does, to forge expired or tampered ones in tests. */
export function forgeToken(payload: Record<string, unknown>, secret = SESSION_SECRET): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`;
}

type Init = { origin?: string | null; type?: string | null; cookie?: string };

/** A browser-like client: same origin, JSON bodies, keeps the session cookie. */
export class Client {
  cookie: string | undefined;
  constructor(private readonly server: TestHarness) {}

  async request(method: string, path: string, body?: unknown, init: Init = {}) {
    const headers: Record<string, string> = {};
    const origin = init.origin === undefined ? ORIGIN : init.origin;
    if (origin !== null) headers.Origin = origin;
    const raw = body instanceof Uint8Array;
    const type = init.type === undefined ? (raw ? 'application/octet-stream' : 'application/json') : init.type;
    if (type !== null && method !== 'GET') headers['Content-Type'] = type;
    const cookie = init.cookie ?? this.cookie;
    if (cookie) headers.Cookie = cookie;
    const res = await this.server.fetch(`http://localhost${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
    });
    const setCookie = res.headers.get('Set-Cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    // Tests read deep into responses (e.g. data.options.challenge); `any` keeps them readable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = res.headers.get('Content-Type')?.startsWith('application/json') ? JSON.parse(text) : text;
    return { status: res.status, headers: res.headers, setCookie, data };
  }

  get = (path: string, init?: Init) => this.request('GET', path, undefined, init);
  post = (path: string, body?: unknown, init?: Init) => this.request('POST', path, body ?? {}, init);

  async registerOptions(body: Record<string, unknown> = {}) {
    return this.post('/api/register/options', body);
  }

  /** Full registration ceremony with a software authenticator. */
  async register(auth: SoftAuthenticator, extra: Record<string, unknown> = {}, optionsBody: Record<string, unknown> = {}) {
    const opts = await this.registerOptions(optionsBody);
    if (opts.status !== 200) return opts;
    const response = auth.register({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
    return this.post('/api/register/verify', { response, challengeToken: opts.data.challengeToken, ...fakeCredentialKeys(), ...extra });
  }

  async login(auth: SoftAuthenticator) {
    const opts = await this.post('/api/login/options');
    const response = auth.assert({ origin: ORIGIN, rpId: RP_ID, challenge: opts.data.options.challenge });
    return this.post('/api/login/verify', { response, challengeToken: opts.data.challengeToken });
  }
}

/** Claims a fresh vault with the setup code. Returns a logged-in client and its authenticator. */
export async function claimVault(server: TestHarness) {
  const client = new Client(server);
  const auth = new SoftAuthenticator();
  const vault = fakeVault();
  const res = await client.register(auth, { claim: { vaultId: vault.vaultId, recovery: vault.recovery } }, { setupCode: SETUP_CODE });
  if (res.status !== 201) throw new Error(`claim failed: ${res.status} ${JSON.stringify(res.data)}`);
  return { client, auth, vault };
}
