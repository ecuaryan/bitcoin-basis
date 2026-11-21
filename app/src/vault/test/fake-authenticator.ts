/**
 * A fake `navigator.credentials` with a deterministic PRF (HMAC-SHA-256 over the WebAuthn PRF salt
 * construction), for tests. Share one instance between two "devices" to model a synced passkey.
 */
import { concatBytes, fromUtf8, toBase64Url, toBytes, utf8, type Bytes } from '../bytes.ts';
import type { CredentialsLike } from '../passkey.ts';

interface FakeCred {
  readonly id: Bytes;
  readonly secret: Bytes;
  readonly userHandle: Bytes;
  readonly rpId: string;
}

export interface FakeAuthenticatorOptions {
  /** What `create` reports for PRF: results, only `enabled: true`, or no PRF support at all. */
  readonly prfOnCreate?: 'results' | 'enabled-only' | 'none';
  /** Whether `get` evaluates PRF. */
  readonly prfOnGet?: boolean;
  readonly origin?: string;
  readonly rpId?: string;
}

export class FakeAuthenticator implements CredentialsLike {
  readonly creds: FakeCred[] = [];
  /** Every PRF output handed out (tests check none of them leaves the device). */
  readonly prfOutputs: Bytes[] = [];
  readonly calls = { create: 0, get: 0 };
  /** Make the next prompt fail as if the user cancelled. */
  cancelNext = false;
  /**
   * The next N `get` prompts never settle and ignore their abort signal (the worst case: a prompt
   * a phone decided not to show).
   */
  hangGets = 0;
  /** The signal each `get` was given (every prompt must be abortable). */
  readonly getSignals: (AbortSignal | undefined)[] = [];
  /** For discoverable prompts: which credential the "user" picks (default: the newest). */
  choose: ((creds: readonly FakeCred[]) => FakeCred | undefined) | null = null;
  private counter = 0;

  constructor(
    private readonly seed: string,
    private readonly options: FakeAuthenticatorOptions = {},
  ) {}

  async create(options: CredentialCreationOptions): Promise<Credential | null> {
    this.calls.create++;
    this.maybeCancel();
    const pk = options.publicKey as PublicKeyCredentialCreationOptions;
    if (pk.authenticatorSelection?.userVerification !== 'required') throw new Error('fake: user verification must be required');
    const n = this.counter++;
    const id = (await sha256(utf8(`${this.seed}/id/${n}`))).slice(0, 16);
    const secret = await sha256(utf8(`${this.seed}/secret/${n}`));
    const cred: FakeCred = { id, secret, userHandle: toBytes(pk.user.id as BufferSource), rpId: pk.rp.id ?? this.options.rpId ?? 'basis.example' };
    this.creds.push(cred);
    const mode = this.options.prfOnCreate ?? 'results';
    const prfIn = (pk.extensions as { prf?: { eval?: { first: BufferSource } } } | undefined)?.prf;
    let prfOut: Record<string, unknown> | undefined;
    if (prfIn !== undefined && mode !== 'none') {
      prfOut = { enabled: true };
      if (mode === 'results' && prfIn.eval !== undefined) prfOut.results = { first: (await this.prf(cred, toBytes(prfIn.eval.first))).buffer };
    } else if (prfIn !== undefined) {
      prfOut = { enabled: false };
    }
    const clientData = utf8(JSON.stringify({ type: 'webauthn.create', challenge: toBase64Url(toBytes(pk.challenge as BufferSource)), origin: this.origin }));
    return {
      type: 'public-key',
      id: toBase64Url(id),
      rawId: id.slice().buffer,
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: clientData.buffer,
        attestationObject: utf8('fake-attestation').buffer,
        getTransports: () => ['internal', 'hybrid'],
        getPublicKey: () => utf8(`fake-public-key/${toBase64Url(id)}`).buffer,
        getPublicKeyAlgorithm: () => -7,
        getAuthenticatorData: () => utf8('fake-auth-data').buffer,
      },
      getClientExtensionResults: () => ({ credProps: { rk: true }, ...(prfOut === undefined ? {} : { prf: prfOut }) }),
    } as unknown as Credential;
  }

  async get(options: CredentialRequestOptions): Promise<Credential | null> {
    this.calls.get++;
    this.getSignals.push(options.signal ?? undefined);
    if (this.hangGets > 0) {
      this.hangGets--;
      return new Promise<Credential | null>(() => undefined);
    }
    this.maybeCancel();
    const pk = options.publicKey as PublicKeyCredentialRequestOptions;
    if (pk.userVerification !== 'required') throw new Error('fake: user verification must be required');
    const allow = (pk.allowCredentials ?? []).map((d) => toBase64Url(toBytes(d.id)));
    const candidates = allow.length > 0 ? this.creds.filter((c) => allow.includes(toBase64Url(c.id))) : this.creds;
    const cred = allow.length > 0 ? candidates[0] : (this.choose?.(candidates) ?? candidates.at(-1));
    if (cred === undefined) throw Object.assign(new Error('no credential'), { name: 'NotAllowedError' });
    const prfIn = (pk.extensions as { prf?: { eval?: { first: BufferSource }; evalByCredential?: Record<string, { first: BufferSource }> } } | undefined)?.prf;
    const salt = prfIn?.evalByCredential?.[toBase64Url(cred.id)]?.first ?? prfIn?.eval?.first;
    const ext: Record<string, unknown> = {};
    if (prfIn !== undefined && salt !== undefined && this.options.prfOnGet !== false && this.options.prfOnCreate !== 'none') {
      ext.prf = { results: { first: (await this.prf(cred, toBytes(salt))).buffer } };
    }
    const clientData = utf8(JSON.stringify({ type: 'webauthn.get', challenge: toBase64Url(toBytes(pk.challenge)), origin: this.origin }));
    return {
      type: 'public-key',
      id: toBase64Url(cred.id),
      rawId: cred.id.slice().buffer,
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: clientData.buffer,
        authenticatorData: utf8('fake-auth-data').buffer,
        signature: utf8('fake-signature').buffer,
        userHandle: cred.userHandle.slice().buffer,
      },
      getClientExtensionResults: () => ext,
    } as unknown as Credential;
  }

  private get origin(): string {
    return this.options.origin ?? 'https://basis.example';
  }

  private maybeCancel(): void {
    if (!this.cancelNext) return;
    this.cancelNext = false;
    throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
  }

  /** WebAuthn PRF: HMAC(secret, SHA-256("WebAuthn PRF" || 0x00 || salt)). */
  private async prf(cred: FakeCred, salt: Bytes): Promise<Bytes> {
    const s = await sha256(concatBytes(utf8('WebAuthn PRF'), Uint8Array.of(0), salt));
    const key = await crypto.subtle.importKey('raw', cred.secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const out = new Uint8Array(await crypto.subtle.sign('HMAC', key, s));
    this.prfOutputs.push(out.slice());
    return out;
  }
}

async function sha256(b: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b));
}

/** Decode a `clientDataJSON` field (base64url) from a response JSON. */
export function readClientData(b64: string, decode: (s: string) => Bytes): { type: string; challenge: string } {
  return JSON.parse(fromUtf8(decode(b64))) as { type: string; challenge: string };
}
