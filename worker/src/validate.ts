// Input validation. Every helper throws 400 on bad input, so handlers read as plain code.
import { fromB64u } from './crypto.ts';
import { fail } from './http.ts';

export type Obj = Record<string, unknown>;

export function obj(v: unknown): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(400);
  return v as Obj;
}

/** Base64url (unpadded, canonical) string whose decoded length is exactly `bytes`, or within [min, max]. */
export function b64u(v: unknown, bytes: number | [min: number, max: number]): string {
  const [min, max] = typeof bytes === 'number' ? [bytes, bytes] : bytes;
  if (typeof v !== 'string' || v.length > Math.ceil((max * 4) / 3)) fail(400);
  const decoded = fromB64u(v as string);
  if (!decoded || decoded.length < min || decoded.length > max) fail(400);
  return v as string;
}

/** Vault id: 16 random bytes in base64url, as the app generates it. */
export const vaultId = (v: unknown): string => b64u(v, 16);

/** Recovery record fields sent by the app (at claim and at rotation). */
export function recoveryInput(v: unknown): { salt: string; authVerifier: string; wrappedDk: string } {
  const r = obj(v);
  return { salt: b64u(r.salt, 32), authVerifier: b64u(r.authVerifier, 32), wrappedDk: wrappedDk(r.wrappedDk) };
}

/** A wrapped data key: IV (12) || AES-GCM ciphertext of the 32-byte key (32) || tag (16). */
export const wrappedDk = (v: unknown): string => b64u(v, 60);

export const CREDENTIAL_ID_BYTES: [number, number] = [16, 512];

/** The JSON a browser's WebAuthn call returns, checked just enough to hand to @simplewebauthn/server. */
export function credentialResponse(v: unknown, fields: string[]): Obj {
  const r = obj(v);
  b64u(r.id, CREDENTIAL_ID_BYTES);
  if (r.rawId !== r.id || r.type !== 'public-key') fail(400);
  const inner = obj(r.response);
  for (const f of fields) if (typeof inner[f] !== 'string') fail(400);
  return r;
}
