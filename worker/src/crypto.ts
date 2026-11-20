// Small WebCrypto helpers: base64url, random bytes, SHA-256, constant-time
// comparison and HMAC-signed tokens (sessions and WebAuthn challenges).

const enc = new TextEncoder();

export const toB64u = (bytes: Uint8Array): string => bytes.toBase64({ alphabet: 'base64url', omitPadding: true });

/** Decodes canonical, unpadded base64url; returns null for anything else. */
export function fromB64u(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bytes = Uint8Array.fromBase64(s, { alphabet: 'base64url' });
    return toB64u(bytes) === s ? bytes : null;
  } catch {
    return null;
  }
}

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

export const sha256 = async (data: Uint8Array | string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));

/** Constant-time equality for two secrets of any length (hashes both first). */
export async function sameSecret(a: Uint8Array | string, b: Uint8Array | string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

const hmacKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export type TokenPayload = { typ: string; exp: number } & Record<string, unknown>;

/** `base64url(JSON payload) "." base64url(HMAC-SHA-256(secret, first part))` */
export async function signToken(secret: string, payload: TokenPayload): Promise<string> {
  const body = toB64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${toB64u(new Uint8Array(sig))}`;
}

/** Returns the payload if the signature is valid (constant time), `typ` matches and it hasn't expired. */
export async function verifyToken(secret: string, token: unknown, typ: string): Promise<TokenPayload | null> {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sigText, extra] = token.split('.');
  if (body === undefined || sigText === undefined || extra !== undefined) return null;
  const sig = fromB64u(sigText);
  if (sig?.length !== 32) return null;
  if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(body)))) return null;
  const json = fromB64u(body);
  if (!json) return null;
  const payload: unknown = JSON.parse(new TextDecoder().decode(json));
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<TokenPayload>;
  if (p.typ !== typ || typeof p.exp !== 'number' || p.exp <= Date.now()) return null;
  return p as TokenPayload;
}
