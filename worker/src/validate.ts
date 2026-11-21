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

/** A positive safe integer (epochs, versions). */
export function posInt(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) fail(400);
  return v as number;
}

/** Vault id: 16 random bytes in base64url, as the app generates it. */
export const vaultId = (v: unknown): string => b64u(v, 16);

const IV = 12;
const TAG = 16;
const DK = 32;

/** A wrapped data key: IV (12) || AES-GCM ciphertext of the 32-byte key (32) || tag (16). */
export const wrappedDk = (v: unknown): string => b64u(v, IV + DK + TAG);

/** An uncompressed P-256 public key (65 bytes, starting with 0x04). */
export function ecPublicKey(v: unknown): string {
  const s = b64u(v, 65);
  if (fromB64u(s)?.[0] !== 4) fail(400);
  return s;
}

/** Epoch `epoch`'s history: IV || AES-GCM(32 bytes for each older epoch) || tag. */
export const historyCt = (v: unknown, epoch: number): string => b64u(v, IV + DK * (epoch - 1) + TAG);

/** Recovery record fields sent by the app (at claim and at rotation). */
export function recoveryInput(v: unknown): { salt: string; authVerifier: string; wrappedDk: string } {
  const r = obj(v);
  return { salt: b64u(r.salt, 32), authVerifier: b64u(r.authVerifier, 32), wrappedDk: wrappedDk(r.wrappedDk) };
}

/** A credential's ECDH key: public key in clear; PKCS#8 private key wrapped (IV || ciphertext || tag); binding = IV || GMAC tag. */
export function credentialKeyInput(v: unknown): { publicKey: string; wrappedPrivateKey: string; epoch: number; binding: string } {
  const r = obj(v);
  return { publicKey: ecPublicKey(r.publicKey), wrappedPrivateKey: b64u(r.wrappedPrivateKey, [IV + 64 + TAG, IV + 256 + TAG]), epoch: posInt(r.epoch), binding: b64u(r.binding, IV + TAG) };
}

/** A data key delivered to one credential: ephemeral ECDH public key and the wrapped DK. */
export function deliveryInput(v: unknown): { ephemeralPublicKey: string; wrappedDk: string } {
  const r = obj(v);
  return { ephemeralPublicKey: ecPublicKey(r.ephemeralPublicKey), wrappedDk: wrappedDk(r.wrappedDk) };
}

/** A rotation's delivery to one credential, plus that credential's binding re-made under the new data key. */
export function rotationDeliveryInput(v: unknown): { ephemeralPublicKey: string; wrappedDk: string; binding: string } {
  return { ...deliveryInput(v), binding: b64u(obj(v).binding, IV + TAG) };
}

export const CREDENTIAL_ID_BYTES: [number, number] = [16, 512];

/** A credential id: unpadded base64url of 16–512 bytes (so `epoch/000000/cred/<id>` stays well inside R2's key limit). */
export const credentialId = (v: unknown): string => b64u(v, CREDENTIAL_ID_BYTES);

/** The JSON a browser's WebAuthn call returns, checked just enough to hand to @simplewebauthn/server. */
export function credentialResponse(v: unknown, fields: string[]): Obj & { id: string } {
  const r = obj(v);
  credentialId(r.id);
  if (r.rawId !== r.id || r.type !== 'public-key') fail(400);
  const inner = obj(r.response);
  for (const f of fields) if (typeof inner[f] !== 'string') fail(400);
  return r as Obj & { id: string };
}

export type StepUpInput = { response: Obj & { id: string }; challengeToken: unknown } | { authToken: string };

/** Step-up proof: a fresh passkey assertion `{ response, challengeToken }`, or (registration only) the recovery `{ authToken }`. */
export function stepUpInput(v: unknown): StepUpInput {
  const r = obj(v);
  if (r.authToken !== undefined) return { authToken: b64u(r.authToken, 32) };
  return { response: credentialResponse(r.response, ['clientDataJSON', 'authenticatorData', 'signature']), challengeToken: r.challengeToken };
}
