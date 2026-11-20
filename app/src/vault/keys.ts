/**
 * Key handling: the data key (DK), the key-encryption keys (KEKs) that wrap it, and the recovery
 * auth token. Exactly as docs/sync-protocol.md, "Cryptography".
 *
 * Extractability: the DK used for sealing is always a non-extractable `CryptoKey`. Unlocking uses
 * `unwrapKey` straight into a non-extractable key, so raw DK bytes never reach JavaScript then.
 * Raw bytes exist only briefly while a new copy is wrapped (vault creation, adding a passkey,
 * rotating the recovery code): `unwrapDataKeyBytes` decrypts them from an existing wrapping and the
 * caller wipes them right after `wrapDataKey`. The vault keeps the non-extractable KEK it unlocked
 * with (not an extractable DK) so it can do that.
 */
import { concatBytes, randomBytes, utf8, type Bytes } from './bytes.ts';

export const INFO_PASSKEY_KEK = 'bitcoin-basis/kek/passkey/v1';
export const INFO_RECOVERY_KEK = 'bitcoin-basis/kek/recovery/v1';
export const INFO_RECOVERY_AUTH = 'bitcoin-basis/auth/recovery/v1';
export const WRAP_AAD_PREFIX = 'bitcoin-basis/wrap/v1';

export const DK_BYTES = 32;
export const SALT_BYTES = 32;
export const IV_BYTES = 12;
const TAG_BYTES = 16;
/** `iv (12) || AES-GCM(DK) (32) || tag (16)`. */
export const WRAPPED_DK_BYTES = IV_BYTES + DK_BYTES + TAG_BYTES;
export const AUTH_TOKEN_BYTES = 32;

/** What a wrapped DK copy is bound to. */
export type WrapKind = { readonly type: 'passkey'; readonly credentialId: string } | { readonly type: 'recovery'; readonly version: number };

export type KeyErrorCode = 'unwrap-failed' | 'malformed';

/** `unwrap-failed`: wrong key, wrong vault, wrong credential/version, or tampered data. */
export class KeyError extends Error {
  override readonly name = 'KeyError';
  constructor(readonly code: KeyErrorCode, message?: string) {
    super(message ?? (code === 'unwrap-failed' ? 'could not unwrap the data key' : 'malformed key material'));
  }
}

const AES = { name: 'AES-GCM', length: 256 } as const;

/** AAD for a wrapped DK: `bitcoin-basis/wrap/v1|<vaultId>|passkey:<credentialId>` or `…|recovery:<version>`. */
export function wrapAad(vaultId: string, kind: WrapKind): Bytes {
  assertField(vaultId, 'vault id');
  let k: string;
  if (kind.type === 'passkey') {
    assertField(kind.credentialId, 'credential id');
    k = `passkey:${kind.credentialId}`;
  } else {
    if (!Number.isSafeInteger(kind.version) || kind.version < 1) throw new KeyError('malformed', 'recovery version must be a positive integer');
    k = `recovery:${kind.version}`;
  }
  return utf8(`${WRAP_AAD_PREFIX}|${vaultId}|${k}`);
}

/** 32 fresh random bytes for a new DK. Wipe after wrapping and importing. */
export function newDataKeyBytes(): Bytes {
  return randomBytes(DK_BYTES);
}

/** Import raw DK bytes as a non-extractable AES-256-GCM key for sealing and opening blobs. */
export function importDataKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== DK_BYTES) throw new KeyError('malformed', 'data key must be 32 bytes');
  return crypto.subtle.importKey('raw', raw, AES, false, ['encrypt', 'decrypt']);
}

/** Passkey KEK: HKDF-SHA-256(ikm = PRF output, salt = the credential's prfSalt, info = `…/kek/passkey/v1`). */
export function derivePasskeyKek(prfOutput: Bytes, prfSalt: Bytes): Promise<CryptoKey> {
  if (prfOutput.length < 32) throw new KeyError('malformed', 'PRF output must be at least 32 bytes');
  return deriveKek(prfOutput, prfSalt, INFO_PASSKEY_KEK);
}

/** Recovery KEK: HKDF-SHA-256(ikm = recovery secret, salt = recovery salt, info = `…/kek/recovery/v1`). */
export function deriveRecoveryKek(secret: Bytes, salt: Bytes): Promise<CryptoKey> {
  return deriveKek(secret, salt, INFO_RECOVERY_KEK);
}

/** Recovery auth token: 32 bytes of HKDF-SHA-256(recovery secret, recovery salt, `…/auth/recovery/v1`). */
export async function deriveRecoveryAuthToken(secret: Bytes, salt: Bytes): Promise<Bytes> {
  checkSalt(salt);
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(INFO_RECOVERY_AUTH) }, base, AUTH_TOKEN_BYTES * 8);
  return new Uint8Array(bits);
}

/** What the server stores instead of the token: `SHA-256(token)`. */
export async function authVerifier(token: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', token));
}

/** AES-GCM-encrypt raw DK bytes under a KEK. Returns `iv || ciphertext+tag` (60 bytes). `iv` is injectable for test vectors only. */
export async function wrapDataKey(rawDk: Bytes, kek: CryptoKey, aad: Bytes, iv: Bytes = randomBytes(IV_BYTES)): Promise<Bytes> {
  if (rawDk.length !== DK_BYTES) throw new KeyError('malformed', 'data key must be 32 bytes');
  if (iv.length !== IV_BYTES) throw new KeyError('malformed', 'IV must be 12 bytes');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, kek, rawDk);
  return concatBytes(iv, new Uint8Array(ct));
}

/** Unwrap straight into a non-extractable DK. Throws `KeyError('unwrap-failed')`. */
export async function unwrapDataKey(wrapped: Bytes, kek: CryptoKey, aad: Bytes): Promise<CryptoKey> {
  const { iv, ct } = splitWrapped(wrapped);
  try {
    return await crypto.subtle.unwrapKey('raw', ct, kek, { name: 'AES-GCM', iv, additionalData: aad }, AES, false, ['encrypt', 'decrypt']);
  } catch {
    throw new KeyError('unwrap-failed');
  }
}

/** Decrypt raw DK bytes, only to wrap another copy. The caller must `wipe` the result. */
export async function unwrapDataKeyBytes(wrapped: Bytes, kek: CryptoKey, aad: Bytes): Promise<Bytes> {
  const { iv, ct } = splitWrapped(wrapped);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, kek, ct));
  } catch {
    throw new KeyError('unwrap-failed');
  }
}

async function deriveKek(ikm: Bytes, salt: Bytes, info: string): Promise<CryptoKey> {
  checkSalt(salt);
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, base, AES, false, ['encrypt', 'decrypt', 'unwrapKey']);
}

function splitWrapped(wrapped: Bytes): { iv: Bytes; ct: Bytes } {
  if (wrapped.length !== WRAPPED_DK_BYTES) throw new KeyError('malformed', 'wrapped data key must be 60 bytes');
  return { iv: wrapped.slice(0, IV_BYTES), ct: wrapped.slice(IV_BYTES) };
}

function checkSalt(salt: Bytes): void {
  if (salt.length !== SALT_BYTES) throw new KeyError('malformed', 'salt must be 32 bytes');
}

function assertField(value: string, what: string): void {
  if (value.length === 0 || value.includes('|')) throw new KeyError('malformed', `${what} must be non-empty and contain no "|"`);
}
