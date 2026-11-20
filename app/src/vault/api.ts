/**
 * Typed client for the sync Worker's API (docs/sync-protocol.md, "API").
 *
 * Same origin only: relative URLs, `credentials: 'same-origin'` (the session is an HttpOnly
 * cookie), JSON bodies except the blob upload. Binary fields in JSON are unpadded base64url
 * (the decoder also accepts standard base64).
 * Every failure is an `ApiError` with a `kind` the vault can act on.
 */
import { fromBase64Url, type Bytes } from './bytes.ts';
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from './passkey.ts';

export type ApiErrorKind =
  /** No response at all (offline, DNS, CORS, aborted). */
  | 'network'
  | 'bad-request'
  /** 401: no session, or wrong recovery token. */
  | 'unauthorized'
  /** 403: wrong origin, setup code, or vault already claimed. */
  | 'forbidden'
  | 'not-found'
  /** 409: the key already exists (only-if-new write). */
  | 'conflict'
  | 'too-large'
  | 'rate-limited'
  | 'server'
  /** The server answered, but not with what the protocol says. */
  | 'bad-response';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number | null,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? `API ${kind}${status === null ? '' : ` (${status})`}`, options);
  }
}

export interface ChallengeOptions<T> {
  readonly options: T;
  readonly challengeToken: string;
}

export interface RecoveryRecordInput {
  readonly salt: string;
  readonly authVerifier: string;
  readonly wrappedDk: string;
}

export interface RegisterVerifyBody {
  readonly response: RegistrationResponseJSON;
  readonly challengeToken: string;
  readonly prfSalt: string;
  readonly wrappedDk: string;
  readonly claim?: { readonly vaultId: string; readonly recovery: RecoveryRecordInput };
}

export interface LoginResult {
  readonly vaultId: string;
  readonly prfSalt: string;
  readonly wrappedDk: string;
}

export interface RecoveryParams {
  readonly vaultId: string;
  readonly version: number;
  readonly salt: string;
}

export interface RemoteBlob {
  readonly key: string;
  readonly data: Bytes;
}

export interface BlobPage {
  readonly blobs: readonly RemoteBlob[];
  readonly more: boolean;
}

export const MAX_PAGE = 200;

export interface ApiClient {
  status(): Promise<{ claimed: boolean }>;
  registerOptions(auth: { setupCode: string } | null): Promise<ChallengeOptions<PublicKeyCredentialCreationOptionsJSON>>;
  /** Stores the credential and starts a session (cookie). */
  registerVerify(body: RegisterVerifyBody): Promise<{ credentialId: string }>;
  loginOptions(): Promise<ChallengeOptions<PublicKeyCredentialRequestOptionsJSON>>;
  loginVerify(body: { response: AuthenticationResponseJSON; challengeToken: string }): Promise<LoginResult>;
  recoveryParams(): Promise<RecoveryParams>;
  recoveryLogin(authToken: string): Promise<{ wrappedDk: string; version: number }>;
  /** `version` is the new version (current + 1); the client needs it for the wrapping AAD. */
  recoveryRotate(body: RecoveryRecordInput & { readonly version: number }): Promise<{ version: number }>;
  uploadBlob(blob: Bytes): Promise<{ key: string }>;
  /** `after` is a key or any `e/<13 digits>` prefix; `null` lists from the start. */
  listBlobs(after: string | null, limit?: number): Promise<BlobPage>;
  logout(): Promise<void>;
}

export interface ApiClientOptions {
  /** Defaults to the global `fetch`. */
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** Prefix for every path; default `''` (same origin). */
  readonly baseUrl?: string;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const base = options.baseUrl ?? '';

  async function request(method: 'GET' | 'POST', path: string, body?: unknown, raw?: Bytes): Promise<unknown> {
    const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' };
    if (raw !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/octet-stream' };
      init.body = raw;
    } else if (method === 'POST') {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body ?? {});
    }
    let res: Response;
    try {
      res = await doFetch(base + path, init);
    } catch (e) {
      throw new ApiError('network', null, 'could not reach the server', { cause: e });
    }
    if (!res.ok) throw new ApiError(kindFor(res.status), res.status);
    const text = await res.text().catch(() => '');
    if (text === '') return {};
    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      throw new ApiError('bad-response', res.status, 'response is not JSON', { cause: e });
    }
  }

  const post = (path: string, body?: unknown) => request('POST', path, body);

  return {
    async status() {
      const r = obj(await request('GET', '/api/status'));
      return { claimed: bool(r.claimed) };
    },
    async registerOptions(auth) {
      return challenge<PublicKeyCredentialCreationOptionsJSON>(await post('/api/register/options', auth ?? {}));
    },
    async registerVerify(body) {
      const r = obj(await post('/api/register/verify', body));
      return { credentialId: str(r.credentialId) };
    },
    async loginOptions() {
      return challenge<PublicKeyCredentialRequestOptionsJSON>(await post('/api/login/options', {}));
    },
    async loginVerify(body) {
      const r = obj(await post('/api/login/verify', body));
      return { vaultId: str(r.vaultId), prfSalt: str(r.prfSalt), wrappedDk: str(r.wrappedDk) };
    },
    async recoveryParams() {
      const r = obj(await request('GET', '/api/recovery/params'));
      return { vaultId: str(r.vaultId), version: int(r.version), salt: str(r.salt) };
    },
    async recoveryLogin(authToken) {
      const r = obj(await post('/api/recovery/login', { authToken }));
      return { wrappedDk: str(r.wrappedDk), version: int(r.version) };
    },
    async recoveryRotate(body) {
      const r = obj(await post('/api/recovery/rotate', body));
      return { version: r.version === undefined ? body.version : int(r.version) };
    },
    async uploadBlob(blob) {
      const r = obj(await request('POST', '/api/blobs', undefined, blob));
      return { key: str(r.key) };
    },
    async listBlobs(after, limit = MAX_PAGE) {
      const q = new URLSearchParams({ limit: String(Math.min(Math.max(1, limit), MAX_PAGE)) });
      if (after !== null) q.set('after', after);
      const r = obj(await request('GET', `/api/blobs?${q.toString()}`));
      if (!Array.isArray(r.blobs)) throw bad('blobs');
      const blobs = r.blobs.map((b: unknown) => {
        const o = obj(b);
        try {
          return { key: str(o.key), data: fromBase64Url(str(o.data)) };
        } catch (e) {
          if (e instanceof ApiError) throw e;
          throw bad('blob data');
        }
      });
      let prev = after;
      for (const b of blobs) {
        if (prev !== null && !(b.key > prev)) throw bad('blobs are not ascending after the cursor');
        prev = b.key;
      }
      return { blobs, more: bool(r.more) };
    },
    async logout() {
      await post('/api/logout', {});
    },
  };
}

function kindFor(status: number): ApiErrorKind {
  if (status === 400) return 'bad-request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too-large';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server';
  return 'bad-response';
}

const bad = (what: string) => new ApiError('bad-response', null, `unexpected response: ${what}`);

function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw bad('not an object');
  return v as Record<string, unknown>;
}
function str(v: unknown): string {
  if (typeof v !== 'string') throw bad('expected a string');
  return v;
}
function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') throw bad('expected a boolean');
  return v;
}
function int(v: unknown): number {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw bad('expected a positive integer');
  return n;
}
function challenge<T>(v: unknown): ChallengeOptions<T> {
  const r = obj(v);
  return { options: obj(r.options) as T, challengeToken: str(r.challengeToken) };
}
