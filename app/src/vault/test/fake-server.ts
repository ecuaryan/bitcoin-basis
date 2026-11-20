/**
 * An in-memory server that follows docs/sync-protocol.md closely enough to test the client:
 * setup-code claim, stateless-looking challenge tokens, passkey and recovery sessions (cookies per
 * client), only-if-new storage, bucket-size checks and paged listing. It does not verify WebAuthn
 * signatures (the real Worker does, with @simplewebauthn/server).
 */
import { fromBase64Url, fromUtf8, randomBytes, toBase64Url, toBytes, toHex, type Bytes } from '../bytes.ts';
import { isValidBlobSize } from '../seal.ts';

interface StoredCred {
  publicKey: string;
  prfSalt: string;
  wrappedDk: string;
}
interface StoredRecovery {
  salt: string;
  authVerifier: string;
  wrappedDk: string;
}

export interface FakeClient {
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Simulate no connectivity for this client. */
  offline: boolean;
  /** Drop this client's session cookie (expired). */
  expireSession(): void;
}

export class FakeServer {
  claimed: { vaultId: string } | null = null;
  readonly creds = new Map<string, StoredCred>();
  readonly recovery = new Map<number, StoredRecovery>();
  readonly blobs = new Map<string, Bytes>();
  /** Every request body seen (for "nothing secret is sent" checks). */
  readonly requests: { path: string; body: string | Bytes }[] = [];
  /** Page size cap (the real server allows up to 200). */
  maxPage = 200;
  /** Server clock for blob keys (ms). Tests may move it to model a slow upload. */
  clock = 1_800_000_000_000;
  private readonly sessions = new Map<string, 'passkey' | 'recovery'>();
  private readonly challenges = new Map<string, { challenge: string; type: 'create' | 'get' }>();

  constructor(readonly setupCode: string) {}

  client(): FakeClient {
    let cookie: string | null = null;
    const c: FakeClient = {
      offline: false,
      expireSession: () => {
        cookie = null;
      },
      fetch: async (input, init) => {
        if (c.offline) throw new TypeError('fetch failed');
        if (init.credentials !== 'same-origin') throw new Error('fake server: credentials must be same-origin');
        const res = await this.handle(input, init, cookie === null ? null : (this.sessions.get(cookie) ?? null));
        if (res.session === 'clear') cookie = null;
        else if (res.session !== undefined) {
          cookie = toHex(randomBytes(16));
          this.sessions.set(cookie, res.session);
        }
        return new Response(res.json === undefined ? null : JSON.stringify(res.json), { status: res.status, headers: { 'Content-Type': 'application/json' } });
      },
    };
    return c;
  }

  /** Sorted blob keys. */
  keys(): string[] {
    return [...this.blobs.keys()].sort();
  }

  private async handle(
    input: string,
    init: RequestInit,
    session: 'passkey' | 'recovery' | null,
  ): Promise<{ status: number; json?: unknown; session?: 'passkey' | 'recovery' | 'clear' }> {
    const url = new URL(input, 'https://basis.example');
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    let body: unknown = null;
    if (method !== 'GET') {
      const ct = headers['Content-Type'];
      if (url.pathname === '/api/blobs') {
        if (ct !== 'application/octet-stream') return { status: 415 };
        const raw = toBytes(init.body as Uint8Array);
        this.requests.push({ path: url.pathname, body: raw });
        body = raw;
      } else {
        if (ct !== 'application/json') return { status: 415 };
        this.requests.push({ path: url.pathname, body: init.body as string });
        body = JSON.parse(init.body as string) as unknown;
      }
    }
    const b = body as Record<string, unknown>;
    const route = `${method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/status':
        return { status: 200, json: { claimed: this.claimed !== null } };
      case 'POST /api/register/options': {
        if (session === null) {
          if (this.claimed !== null) return { status: b.setupCode !== undefined ? 403 : 401 };
          if (b.setupCode !== this.setupCode) return { status: 403 };
        }
        const challenge = toBase64Url(randomBytes(32));
        const challengeToken = toBase64Url(randomBytes(16));
        this.challenges.set(challengeToken, { challenge, type: 'create' });
        return {
          status: 200,
          json: {
            challengeToken,
            options: {
              rp: { id: 'basis.example', name: 'Bitcoin Basis' },
              user: { id: toBase64Url(randomBytes(16)), name: 'owner', displayName: 'Bitcoin Basis' },
              challenge,
              pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
              authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
              excludeCredentials: [...this.creds.keys()].map((id) => ({ id, type: 'public-key' })),
              extensions: { prf: {} },
            },
          },
        };
      }
      case 'POST /api/register/verify': {
        const claim = b.claim as { vaultId: string; recovery: StoredRecovery } | undefined;
        if (session === null && !(this.claimed === null && claim !== undefined)) return { status: 401 };
        if (claim !== undefined && this.claimed !== null) return { status: 409 };
        if (claim === undefined && this.claimed === null) return { status: 400 };
        const response = b.response as { id: string; rawId: string; type: string; response: { clientDataJSON: string; publicKey?: string }; clientExtensionResults: Record<string, unknown> };
        if (!this.checkChallenge(b.challengeToken, response.response.clientDataJSON, 'create')) return { status: 400 };
        if (response.id !== response.rawId || response.type !== 'public-key') return { status: 400 };
        if (this.creds.has(response.id)) return { status: 409 };
        if (!isB64u(b.prfSalt, 32) || !isB64u(b.wrappedDk, 60)) return { status: 400 };
        if (claim !== undefined && (!isB64u(claim.vaultId, 16) || !isB64u(claim.recovery.salt, 32) || !isB64u(claim.recovery.authVerifier, 32) || !isB64u(claim.recovery.wrappedDk, 60))) return { status: 400 };
        this.creds.set(response.id, { publicKey: response.response.publicKey ?? '', prfSalt: b.prfSalt as string, wrappedDk: b.wrappedDk as string });
        if (claim !== undefined) {
          this.claimed = { vaultId: claim.vaultId };
          this.recovery.set(1, claim.recovery);
        }
        return { status: 201, json: { credentialId: response.id }, session: 'passkey' };
      }
      case 'POST /api/login/options': {
        const challenge = toBase64Url(randomBytes(32));
        const challengeToken = toBase64Url(randomBytes(16));
        this.challenges.set(challengeToken, { challenge, type: 'get' });
        return { status: 200, json: { challengeToken, options: { challenge, rpId: 'basis.example', userVerification: 'required', allowCredentials: [] } } };
      }
      case 'POST /api/login/verify': {
        const response = b.response as { id: string; response: { clientDataJSON: string; signature: string } };
        if (!this.checkChallenge(b.challengeToken, response.response.clientDataJSON, 'get')) return { status: 401 };
        const cred = this.creds.get(response.id);
        if (cred === undefined || this.claimed === null || response.response.signature === '') return { status: 401 };
        return { status: 200, json: { vaultId: this.claimed.vaultId, prfSalt: cred.prfSalt, wrappedDk: cred.wrappedDk }, session: 'passkey' };
      }
      case 'GET /api/recovery/params': {
        const v = this.currentVersion();
        if (this.claimed === null || v === null) return { status: 404 };
        return { status: 200, json: { vaultId: this.claimed.vaultId, version: v, salt: (this.recovery.get(v) as StoredRecovery).salt } };
      }
      case 'POST /api/recovery/login': {
        const v = this.currentVersion();
        if (v === null || typeof b.authToken !== 'string') return { status: 401 };
        const rec = this.recovery.get(v) as StoredRecovery;
        const h = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(b.authToken))));
        if (h !== rec.authVerifier) return { status: 401 };
        return { status: 200, json: { wrappedDk: rec.wrappedDk, version: v }, session: 'recovery' };
      }
      case 'POST /api/recovery/rotate': {
        if (session === null) return { status: 401 };
        const v = this.currentVersion() ?? 0;
        if (b.version !== v + 1) return { status: 409 };
        if (!isB64u(b.salt, 32) || !isB64u(b.authVerifier, 32) || !isB64u(b.wrappedDk, 60)) return { status: 400 };
        this.recovery.set(v + 1, { salt: b.salt as string, authVerifier: b.authVerifier as string, wrappedDk: b.wrappedDk as string });
        return { status: 201, json: { version: v + 1 } };
      }
      case 'POST /api/blobs': {
        if (session === null) return { status: 401 };
        const raw = body as Bytes;
        if (!isValidBlobSize(raw.length)) return { status: 400 };
        const key = `e/${String(this.clock++).padStart(13, '0')}-${toHex(randomBytes(8))}`;
        this.blobs.set(key, raw);
        return { status: 201, json: { key } };
      }
      case 'GET /api/blobs': {
        if (session === null) return { status: 401 };
        const after = url.searchParams.get('after');
        if (after !== null && !/^e\/\d{13}/.test(after)) return { status: 400 };
        const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 200, this.maxPage);
        const keys = this.keys().filter((k) => after === null || k > after);
        const page = keys.slice(0, limit);
        return { status: 200, json: { blobs: page.map((key) => ({ key, data: toBase64Url(this.blobs.get(key) as Bytes) })), more: keys.length > page.length } };
      }
      case 'POST /api/logout':
        return { status: 200, json: {}, session: 'clear' };
      default:
        return { status: 404 };
    }
  }

  private currentVersion(): number | null {
    const vs = [...this.recovery.keys()];
    return vs.length === 0 ? null : Math.max(...vs);
  }

  private checkChallenge(token: unknown, clientDataJSON: string, type: 'create' | 'get'): boolean {
    if (typeof token !== 'string') return false;
    const c = this.challenges.get(token);
    this.challenges.delete(token);
    if (c === undefined || c.type !== type) return false;
    const data = JSON.parse(fromUtf8(fromBase64Url(clientDataJSON))) as { type: string; challenge: string };
    return data.type === `webauthn.${type}` && data.challenge === c.challenge;
  }
}

function isB64u(v: unknown, bytes: number): boolean {
  if (typeof v !== 'string' || /[+/=]/.test(v)) return false;
  try {
    return fromBase64Url(v).length === bytes;
  } catch {
    return false;
  }
}
