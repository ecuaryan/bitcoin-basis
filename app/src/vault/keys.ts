/**
 * Key handling, exactly as docs/sync-protocol.md, "Cryptography".
 *
 * Data keys come in epochs: epoch n has its own DK_n. Each recovery-code rotation starts a new epoch,
 * so the old code (which wraps only DK_1..DK_n) can never open anything sealed afterwards.
 *
 * - Each passkey has an ECDH P-256 key pair. The private key (PKCS#8) is wrapped with the passkey's
 *   PRF KEK; the public key is stored in clear so any unlocked device can deliver a new DK to it.
 * - A delivery = ECDH(ephemeral, credential public key) → HKDF → AES-GCM wrap of the raw DK.
 * - The recovery code wraps the DK of its own epoch (version = epoch).
 * - Epoch e's "history" holds DK_1..DK_{e-1} sealed under DK_e, so any holder of DK_e reads old blobs.
 * - A credential "binding" (AES-GCM tag over an empty message, under the DK of the epoch it was
 *   registered in) lets an unlocked device check that a passkey's public key was registered by a
 *   key holder, not planted in storage, before delivering a new DK to it.
 *
 * Extractability: every DK used for sealing is a non-extractable `CryptoKey`, and so is every
 * unwrapped ECDH private key. Raw DK bytes exist only briefly while wrapping a new copy, and are
 * wiped by the caller; raw ECDH private keys never reach JavaScript (`wrapKey`/`unwrapKey`).
 */
import { concatBytes, randomBytes, utf8, wipe, type Bytes } from './bytes.ts';

export const INFO_PASSKEY_KEK = 'bitcoin-basis/kek/passkey/v2';
export const INFO_RECOVERY_KEK = 'bitcoin-basis/kek/recovery/v1';
export const INFO_RECOVERY_AUTH = 'bitcoin-basis/auth/recovery/v1';
export const INFO_DELIVERY_KEK = 'bitcoin-basis/kek/delivery/v2';
export const WRAP_AAD_PREFIX = 'bitcoin-basis/wrap/v2';
export const CREDKEY_AAD_PREFIX = 'bitcoin-basis/credkey/v2';
export const HISTORY_AAD_PREFIX = 'bitcoin-basis/history/v2';
export const BINDING_AAD_PREFIX = 'bitcoin-basis/credbind/v2';

export const DK_BYTES = 32;
export const SALT_BYTES = 32;
export const IV_BYTES = 12;
const TAG_BYTES = 16;
/** `iv (12) || AES-GCM(DK) (32) || tag (16)`. */
export const WRAPPED_DK_BYTES = IV_BYTES + DK_BYTES + TAG_BYTES;
export const AUTH_TOKEN_BYTES = 32;
/** Uncompressed P-256 public key. */
export const EC_PUBLIC_KEY_BYTES = 65;
/** `iv (12) || tag (16)`. */
export const BINDING_BYTES = IV_BYTES + TAG_BYTES;

/** What a wrapped DK copy is bound to. */
export type WrapKind =
  | { readonly type: 'recovery'; readonly version: number }
  | { readonly type: 'delivery'; readonly epoch: number; readonly credentialId: string };

export type KeyErrorCode = 'unwrap-failed' | 'malformed';

/** `unwrap-failed`: wrong key, wrong vault, wrong credential/version, or tampered data. */
export class KeyError extends Error {
  override readonly name = 'KeyError';
  constructor(readonly code: KeyErrorCode, message?: string) {
    super(message ?? (code === 'unwrap-failed' ? 'could not unwrap the data key' : 'malformed key material'));
  }
}

const AES = { name: 'AES-GCM', length: 256 } as const;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** AAD for a wrapped DK: `bitcoin-basis/wrap/v2|<vaultId>|recovery:<v>` or `…|epoch:<e>|passkey:<credentialId>`. */
export function wrapAad(vaultId: string, kind: WrapKind): Bytes {
  assertField(vaultId, 'vault id');
  if (kind.type === 'recovery') return utf8(`${WRAP_AAD_PREFIX}|${vaultId}|recovery:${epochText(kind.version)}`);
  assertField(kind.credentialId, 'credential id');
  return utf8(`${WRAP_AAD_PREFIX}|${vaultId}|epoch:${epochText(kind.epoch)}|passkey:${kind.credentialId}`);
}

/** AAD for a passkey's wrapped ECDH private key: `bitcoin-basis/credkey/v2|<vaultId>|<credentialId>`. */
export function credentialKeyAad(vaultId: string, credentialId: string): Bytes {
  assertField(vaultId, 'vault id');
  assertField(credentialId, 'credential id');
  return utf8(`${CREDKEY_AAD_PREFIX}|${vaultId}|${credentialId}`);
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

/** Passkey KEK: HKDF-SHA-256(ikm = PRF output, salt = the credential's prfSalt, info = `…/kek/passkey/v2`). Wraps the ECDH private key. */
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

// --- Credential ECDH keys and deliveries ---------------------------------------------------------

/** A new ECDH P-256 key pair for a passkey. The private key is extractable only so it can be wrapped once. */
export async function generateCredentialKey(): Promise<{ privateKey: CryptoKey; publicKey: Bytes }> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  return { privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

/** `iv || AES-GCM(PKCS#8 private key)` under the passkey KEK. The PKCS#8 bytes never reach JavaScript. */
export async function wrapCredentialKey(privateKey: CryptoKey, kek: CryptoKey, aad: Bytes, iv: Bytes = randomBytes(IV_BYTES)): Promise<Bytes> {
  return concatBytes(iv, new Uint8Array(await crypto.subtle.wrapKey('pkcs8', privateKey, kek, { name: 'AES-GCM', iv, additionalData: aad })));
}

/** Unwrap a passkey's ECDH private key as a non-extractable key. Throws `KeyError('unwrap-failed')`. */
export async function unwrapCredentialKey(wrapped: Bytes, kek: CryptoKey, aad: Bytes): Promise<CryptoKey> {
  if (wrapped.length < IV_BYTES + TAG_BYTES + 64) throw new KeyError('malformed', 'wrapped credential key is too short');
  try {
    return await crypto.subtle.unwrapKey('pkcs8', wrapped.slice(IV_BYTES), kek, { name: 'AES-GCM', iv: wrapped.slice(0, IV_BYTES), additionalData: aad }, ECDH, false, ['deriveBits']);
  } catch {
    throw new KeyError('unwrap-failed');
  }
}

/**
 * The AES key for a delivery: HKDF-SHA-256(ikm = ECDH shared secret, salt = SHA-256(ephemeral public ||
 * credential public), info = `…/kek/delivery/v2`). Either side computes it with its own private key and
 * the other's public key.
 */
export async function deliveryKek(privateKey: CryptoKey, peerPublic: Bytes, ephemeralPublic: Bytes, credentialPublic: Bytes): Promise<CryptoKey> {
  const peer = await importEcPublicKey(peerPublic);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256));
  try {
    const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', concatBytes(ephemeralPublic, credentialPublic)));
    return await deriveKek(shared, salt, INFO_DELIVERY_KEK);
  } finally {
    wipe(shared);
  }
}

export interface Delivery {
  readonly ephemeralPublicKey: Bytes;
  readonly wrappedDk: Bytes;
}

/** Deliver raw DK bytes of `epoch` to a credential's ECDH public key (fresh ephemeral key each time). */
export async function deliverDataKey(rawDk: Bytes, credentialPublic: Bytes, vaultId: string, epoch: number, credentialId: string): Promise<Delivery> {
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const ephemeralPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const kek = await deliveryKek(eph.privateKey, credentialPublic, ephemeralPublicKey, credentialPublic);
  return { ephemeralPublicKey, wrappedDk: await wrapDataKey(rawDk, kek, wrapAad(vaultId, { type: 'delivery', epoch, credentialId })) };
}

/** The KEK and AAD that open a delivery with the credential's private key (pass to `unwrapDataKey`). */
export async function openDelivery(
  privateKey: CryptoKey,
  credentialPublic: Bytes,
  delivery: Delivery,
  vaultId: string,
  epoch: number,
  credentialId: string,
): Promise<{ kek: CryptoKey; aad: Bytes }> {
  try {
    return { kek: await deliveryKek(privateKey, delivery.ephemeralPublicKey, delivery.ephemeralPublicKey, credentialPublic), aad: wrapAad(vaultId, { type: 'delivery', epoch, credentialId }) };
  } catch (e) {
    if (e instanceof KeyError) throw e;
    throw new KeyError('unwrap-failed', 'could not open the data-key delivery');
  }
}

// --- History ------------------------------------------------------------------------------------

function historyAad(vaultId: string, epoch: number): Bytes {
  assertField(vaultId, 'vault id');
  return utf8(`${HISTORY_AAD_PREFIX}|${vaultId}|${epochText(epoch)}`);
}

/** Seal the raw DKs of epochs 1..e-1 (concatenated, in order) under DK_e. Returns `iv || ciphertext+tag`. */
export async function sealHistory(older: Bytes, dk: CryptoKey, vaultId: string, epoch: number, iv: Bytes = randomBytes(IV_BYTES)): Promise<Bytes> {
  if (older.length !== DK_BYTES * (epoch - 1)) throw new KeyError('malformed', 'history must hold one key per older epoch');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: historyAad(vaultId, epoch) }, dk, older);
  return concatBytes(iv, new Uint8Array(ct));
}

/** Raw DKs of epochs 1..e-1, concatenated. Only to re-seal them; the caller must `wipe` the result. */
export async function openHistoryBytes(history: Bytes, dk: CryptoKey, vaultId: string, epoch: number): Promise<Bytes> {
  if (history.length !== IV_BYTES + DK_BYTES * (epoch - 1) + TAG_BYTES) throw new KeyError('malformed', 'history has the wrong size');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: history.slice(0, IV_BYTES), additionalData: historyAad(vaultId, epoch) }, dk, history.slice(IV_BYTES)));
  } catch {
    throw new KeyError('unwrap-failed', 'could not open the key history');
  }
}

/** The data keys of epochs 1..e-1, as non-extractable keys (epoch → key). */
export async function openHistory(history: Bytes, dk: CryptoKey, vaultId: string, epoch: number): Promise<Map<number, CryptoKey>> {
  const raw = await openHistoryBytes(history, dk, vaultId, epoch);
  try {
    const out = new Map<number, CryptoKey>();
    for (let e = 1; e < epoch; e++) {
      const one = raw.slice((e - 1) * DK_BYTES, e * DK_BYTES);
      try {
        out.set(e, await importDataKey(one));
      } finally {
        wipe(one);
      }
    }
    return out;
  } finally {
    wipe(raw);
  }
}

// --- Credential binding --------------------------------------------------------------------------

function bindingAad(vaultId: string, credentialId: string, epoch: number, publicKey: Bytes): Bytes {
  assertField(vaultId, 'vault id');
  assertField(credentialId, 'credential id');
  return concatBytes(utf8(`${BINDING_AAD_PREFIX}|${vaultId}|${credentialId}|${epochText(epoch)}|`), publicKey);
}

/** `iv || tag`: AES-GCM over an empty message with the credential's id, epoch and public key as AAD, under DK_epoch. */
export async function bindCredential(dk: CryptoKey, vaultId: string, credentialId: string, epoch: number, publicKey: Bytes, iv: Bytes = randomBytes(IV_BYTES)): Promise<Bytes> {
  const tag = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bindingAad(vaultId, credentialId, epoch, publicKey) }, dk, new Uint8Array(0));
  return concatBytes(iv, new Uint8Array(tag));
}

export async function verifyCredentialBinding(dk: CryptoKey, vaultId: string, credentialId: string, epoch: number, publicKey: Bytes, binding: Bytes): Promise<boolean> {
  if (binding.length !== BINDING_BYTES || publicKey.length !== EC_PUBLIC_KEY_BYTES) return false;
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: binding.slice(0, IV_BYTES), additionalData: bindingAad(vaultId, credentialId, epoch, publicKey) }, dk, binding.slice(IV_BYTES));
    return true;
  } catch {
    return false;
  }
}

/**
 * True when two non-extractable data keys are the same key: an AES-GCM tag made under `a` (empty
 * message, random IV, a fixed AAD) verifies under `b`. Local only; nothing is stored or sent.
 */
export async function sameDataKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const iv = randomBytes(IV_BYTES);
  const aad = utf8('bitcoin-basis/keycheck/v1');
  const tag = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, a, new Uint8Array(0));
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, b, tag);
    return true;
  } catch {
    return false;
  }
}

// --- Internals -----------------------------------------------------------------------------------

async function importEcPublicKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== EC_PUBLIC_KEY_BYTES || raw[0] !== 4) throw new KeyError('malformed', 'public key must be an uncompressed P-256 point');
  try {
    return await crypto.subtle.importKey('raw', raw, ECDH, false, []);
  } catch {
    throw new KeyError('malformed', 'public key is not a P-256 point');
  }
}

async function deriveKek(ikm: Bytes, salt: Bytes, info: string): Promise<CryptoKey> {
  checkSalt(salt);
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, base, AES, false, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
}

function splitWrapped(wrapped: Bytes): { iv: Bytes; ct: Bytes } {
  if (wrapped.length !== WRAPPED_DK_BYTES) throw new KeyError('malformed', 'wrapped data key must be 60 bytes');
  return { iv: wrapped.slice(0, IV_BYTES), ct: wrapped.slice(IV_BYTES) };
}

function checkSalt(salt: Bytes): void {
  if (salt.length !== SALT_BYTES) throw new KeyError('malformed', 'salt must be 32 bytes');
}

function epochText(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new KeyError('malformed', 'epoch / version must be a positive integer');
  return String(n);
}

function assertField(value: string, what: string): void {
  if (value.length === 0 || value.includes('|')) throw new KeyError('malformed', `${what} must be non-empty and contain no "|"`);
}
