import { createDecipheriv, createECDH, createHash, hkdfSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { concatBytes, fromHex, toBase64Url, toHex, utf8, type Bytes } from './bytes.ts';
import {
  authVerifier,
  bindCredential,
  credentialKeyAad,
  deliverDataKey,
  deliveryKek,
  deriveRecoveryAuthToken,
  deriveRecoveryKek,
  derivePasskeyKek,
  generateCredentialKey,
  importDataKey,
  INFO_DELIVERY_KEK,
  INFO_RECOVERY_KEK,
  KeyError,
  openDelivery,
  openHistory,
  openHistoryBytes,
  sealHistory,
  unwrapCredentialKey,
  unwrapDataKey,
  unwrapDataKeyBytes,
  verifyCredentialBinding,
  wrapAad,
  wrapCredentialKey,
  wrapDataKey,
} from './keys.ts';
import { openBlob, pad, sealPadded } from './seal.ts';

// Fixed inputs. The outputs below are frozen: if any changes, existing vaults would stop opening.
const SECRET = fromHex('000102030405060708090a0b0c0d0e0f');
const SALT = fromHex('10'.repeat(32));
const DK = fromHex('40'.repeat(32));
const IV = fromHex('50'.repeat(12));
const CRED_D = fromHex('60'.repeat(32));
const EPH_D = fromHex('70'.repeat(32));
const VAULT = 'vault-A';

const TOKEN = '6dbc9cbae2887c672bbbc0dd0ca5cf800ebf501faf559563d2b60c2d9b47cb98'; // gitleaks:allow (fixed test vector)
const VERIFIER = 'k3F-CTFs9UM_6fyp6nYN0q1a-XD1CuJtFVTKE8-hkJY';
const WRAPPED_RECOVERY = '5050505050505050505050500638601a6406688291cf910ab4ee4199df80d2fb6154cbe8f4ac3e2a4bcbe36e284474b43dcb99cf55c7c76c42dec8f4'; // gitleaks:allow (fixed test vector)
const WRAPPED_DELIVERY = '505050505050505050505050fe04cc96291707f4fdb76d7ded28681634db5fc00335569c940b8e3a79cd72100c369750ced4d4ebe7138fdadd710444'; // gitleaks:allow (fixed test vector)
const HISTORY = '5050505050505050505050507dc4a20d1280ad04df05331c4f49af4557c42af1f434d4c554f7db4c7da37fe314f8dea8440cf929ab2784b81933b3bda49e9be08abee0e3bf739d71a8bf8056b4d5391960c4bc41db16f32630be298a'; // gitleaks:allow (fixed test vector)
const EMPTY_BLOB_SHA256 = '7b664efff48aae7ad034eca5f08f0e03dcb19d9ad81a542832442e2ac5f3e764';

/** A P-256 key pair from a fixed private scalar: WebCrypto keys plus the raw public point. */
async function fixedEcKey(d: Bytes): Promise<{ privateKey: CryptoKey; publicKey: Bytes }> {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = new Uint8Array(ecdh.getPublicKey());
  const jwk = { kty: 'EC', crv: 'P-256', d: toBase64Url(d), x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33)) };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { privateKey, publicKey: pub };
}

function nodeDecrypt(key: Uint8Array, wrapped: Uint8Array, aad: Uint8Array): string {
  const w = Buffer.from(wrapped);
  const d = createDecipheriv('aes-256-gcm', key, w.subarray(0, 12));
  d.setAAD(aad);
  d.setAuthTag(w.subarray(w.length - 16));
  return Buffer.concat([d.update(w.subarray(12, w.length - 16)), d.final()]).toString('hex');
}

describe('test vectors', () => {
  test('recovery auth token and verifier', async () => {
    const token = await deriveRecoveryAuthToken(SECRET, SALT);
    expect(toHex(token)).toBe(TOKEN);
    expect(toBase64Url(await authVerifier(token))).toBe(VERIFIER);
    // Independent check with Node's HKDF.
    expect(Buffer.from(hkdfSync('sha256', SECRET, SALT, 'bitcoin-basis/auth/recovery/v1', 32)).toString('hex')).toBe(TOKEN);
  });

  test('DK wrapped under the recovery KEK', async () => {
    const kek = await deriveRecoveryKek(SECRET, SALT);
    const aad = wrapAad(VAULT, { type: 'recovery', version: 1 });
    expect(new TextDecoder().decode(aad)).toBe('bitcoin-basis/wrap/v2|vault-A|recovery:1');
    expect(toHex(await wrapDataKey(DK, kek, aad, IV))).toBe(WRAPPED_RECOVERY);
    // Independent check: Node HKDF + AES-256-GCM decrypt.
    const key = Buffer.from(hkdfSync('sha256', SECRET, SALT, INFO_RECOVERY_KEK, 32));
    expect(nodeDecrypt(key, fromHex(WRAPPED_RECOVERY), aad)).toBe(toHex(DK));
  });

  test('DK delivered to a credential key (ECDH → HKDF → AES-GCM)', async () => {
    const cred = await fixedEcKey(CRED_D);
    const eph = await fixedEcKey(EPH_D);
    const aad = wrapAad(VAULT, { type: 'delivery', epoch: 3, credentialId: 'cred-1' });
    expect(new TextDecoder().decode(aad)).toBe('bitcoin-basis/wrap/v2|vault-A|epoch:3|passkey:cred-1');
    const sender = await deliveryKek(eph.privateKey, cred.publicKey, eph.publicKey, cred.publicKey);
    const wrapped = await wrapDataKey(DK, sender, aad, IV);
    expect(toHex(wrapped)).toBe(WRAPPED_DELIVERY);
    // The recipient opens it with its private key and the ephemeral public key.
    const opened = await openDelivery(cred.privateKey, cred.publicKey, { ephemeralPublicKey: eph.publicKey, wrappedDk: wrapped }, VAULT, 3, 'cred-1');
    expect(toHex(await unwrapDataKeyBytes(wrapped, opened.kek, opened.aad))).toBe(toHex(DK));
    // Independent check: Node ECDH + HKDF + AES-256-GCM.
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(CRED_D);
    const shared = ecdh.computeSecret(eph.publicKey);
    const salt = createHash('sha256').update(concatBytes(eph.publicKey, cred.publicKey)).digest();
    const key = Buffer.from(hkdfSync('sha256', shared, salt, INFO_DELIVERY_KEK, 32));
    expect(nodeDecrypt(key, wrapped, aad)).toBe(toHex(DK));
  });

  test('history: older DKs sealed under the epoch key', async () => {
    const dk3 = await importDataKey(DK.slice());
    const older = concatBytes(fromHex('01'.repeat(32)), fromHex('02'.repeat(32)));
    const h = await sealHistory(older, dk3, VAULT, 3, IV);
    expect(toHex(h)).toBe(HISTORY);
    expect(nodeDecrypt(DK, h, utf8('bitcoin-basis/history/v2|vault-A|3'))).toBe(toHex(older));
    expect(toHex(await openHistoryBytes(h, dk3, VAULT, 3))).toBe(toHex(older));
    const keys = await openHistory(h, dk3, VAULT, 3);
    expect([...keys.keys()]).toEqual([1, 2]);
    for (const k of keys.values()) expect(k.extractable).toBe(false);
  });

  test('a frozen wrapping unwraps to a DK that seals a frozen blob', async () => {
    const kek = await deriveRecoveryKek(SECRET, SALT);
    const dk = await unwrapDataKey(fromHex(WRAPPED_RECOVERY), kek, wrapAad(VAULT, { type: 'recovery', version: 1 }));
    expect(dk.extractable).toBe(false);
    const blob = await sealPadded(dk, VAULT, 1, pad(utf8('{"v":1,"entries":[]}')), IV);
    expect(blob.length).toBe(1024 + 33);
    expect(toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', blob)))).toBe(EMPTY_BLOB_SHA256);
    expect(await openBlob(dk, VAULT, blob)).toEqual([]);
  });
});

describe('wrap and unwrap', () => {
  test('round trip; the imported DK is not extractable', async () => {
    const kek = await deriveRecoveryKek(SECRET, SALT);
    const aad = wrapAad(VAULT, { type: 'recovery', version: 2 });
    const wrapped = await wrapDataKey(DK, kek, aad);
    expect(wrapped.length).toBe(60);
    expect(toHex(await unwrapDataKeyBytes(wrapped, kek, aad))).toBe(toHex(DK));
    const key = await unwrapDataKey(wrapped, kek, aad);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    expect((await importDataKey(DK.slice())).extractable).toBe(false);
  });

  test.each([
    ['another vault', wrapAad('vault-B', { type: 'recovery', version: 1 })],
    ['another recovery version', wrapAad(VAULT, { type: 'recovery', version: 2 })],
    ['a delivery kind', wrapAad(VAULT, { type: 'delivery', epoch: 1, credentialId: 'x' })],
  ])('fails with the AAD of %s', async (_name, aad) => {
    const kek = await deriveRecoveryKek(SECRET, SALT);
    await expect(unwrapDataKey(fromHex(WRAPPED_RECOVERY), kek, aad)).rejects.toMatchObject({ code: 'unwrap-failed' });
    await expect(unwrapDataKeyBytes(fromHex(WRAPPED_RECOVERY), kek, aad)).rejects.toBeInstanceOf(KeyError);
  });

  test('fails with the wrong secret or a tampered wrapping', async () => {
    const aad = wrapAad(VAULT, { type: 'recovery', version: 1 });
    const wrong = await deriveRecoveryKek(fromHex('ff'.repeat(16)), SALT);
    await expect(unwrapDataKey(fromHex(WRAPPED_RECOVERY), wrong, aad)).rejects.toMatchObject({ code: 'unwrap-failed' });
    const kek = await deriveRecoveryKek(SECRET, SALT);
    const tampered = fromHex(WRAPPED_RECOVERY);
    tampered[20] = (tampered[20] ?? 0) ^ 1;
    await expect(unwrapDataKey(tampered, kek, aad)).rejects.toMatchObject({ code: 'unwrap-failed' });
    await expect(unwrapDataKey(tampered.slice(1), kek, aad)).rejects.toMatchObject({ code: 'malformed' });
  });

  test('rejects bad inputs', async () => {
    expect(() => wrapAad('a|b', { type: 'recovery', version: 1 })).toThrow(KeyError);
    expect(() => wrapAad('v', { type: 'delivery', epoch: 1, credentialId: '' })).toThrow(KeyError);
    expect(() => wrapAad('v', { type: 'delivery', epoch: 0, credentialId: 'x' })).toThrow(KeyError);
    expect(() => wrapAad('v', { type: 'recovery', version: 0 })).toThrow(KeyError);
    expect(() => derivePasskeyKek(fromHex('20'.repeat(16)), SALT)).toThrow(KeyError);
    await expect(deriveRecoveryAuthToken(SECRET, SALT.slice(1))).rejects.toThrow(KeyError);
    await expect(sealHistory(new Uint8Array(32), await importDataKey(DK.slice()), VAULT, 3)).rejects.toThrow(KeyError);
  });
});

describe('credential keys, deliveries and bindings', () => {
  test('the ECDH private key wraps under the passkey KEK and unwraps non-extractable, bound to vault and credential', async () => {
    const kek = await derivePasskeyKek(fromHex('20'.repeat(32)), fromHex('30'.repeat(32)));
    const { privateKey, publicKey } = await generateCredentialKey();
    expect(publicKey.length).toBe(65);
    const aad = credentialKeyAad(VAULT, 'cred-1');
    const wrapped = await wrapCredentialKey(privateKey, kek, aad);
    const back = await unwrapCredentialKey(wrapped, kek, aad);
    expect(back.extractable).toBe(false);
    await expect(unwrapCredentialKey(wrapped, kek, credentialKeyAad(VAULT, 'cred-2'))).rejects.toMatchObject({ code: 'unwrap-failed' });
    await expect(unwrapCredentialKey(wrapped, kek, credentialKeyAad('vault-B', 'cred-1'))).rejects.toMatchObject({ code: 'unwrap-failed' });
    const other = await derivePasskeyKek(fromHex('21'.repeat(32)), fromHex('30'.repeat(32)));
    await expect(unwrapCredentialKey(wrapped, other, aad)).rejects.toMatchObject({ code: 'unwrap-failed' });

    // A delivery to that key opens only with it, for that vault, epoch and credential.
    const d = await deliverDataKey(DK, publicKey, VAULT, 4, 'cred-1');
    const opened = await openDelivery(back, publicKey, d, VAULT, 4, 'cred-1');
    expect(toHex(await unwrapDataKeyBytes(d.wrappedDk, opened.kek, opened.aad))).toBe(toHex(DK));
    const wrongEpoch = await openDelivery(back, publicKey, d, VAULT, 5, 'cred-1');
    await expect(unwrapDataKey(d.wrappedDk, wrongEpoch.kek, wrongEpoch.aad)).rejects.toMatchObject({ code: 'unwrap-failed' });
    const stranger = await generateCredentialKey();
    const theirs = await openDelivery(stranger.privateKey, stranger.publicKey, d, VAULT, 4, 'cred-1');
    await expect(unwrapDataKey(d.wrappedDk, theirs.kek, theirs.aad)).rejects.toMatchObject({ code: 'unwrap-failed' });
    await expect(deliverDataKey(DK, publicKey.slice(1), VAULT, 4, 'cred-1')).rejects.toThrow(KeyError);
  });

  test('a binding verifies only for its key, credential, epoch and DK', async () => {
    const dk = await importDataKey(DK.slice());
    const { publicKey } = await generateCredentialKey();
    const binding = await bindCredential(dk, VAULT, 'cred-1', 2, publicKey);
    expect(binding.length).toBe(28);
    expect(await verifyCredentialBinding(dk, VAULT, 'cred-1', 2, publicKey, binding)).toBe(true);
    const planted = await generateCredentialKey();
    expect(await verifyCredentialBinding(dk, VAULT, 'cred-1', 2, planted.publicKey, binding)).toBe(false);
    expect(await verifyCredentialBinding(dk, VAULT, 'cred-2', 2, publicKey, binding)).toBe(false);
    expect(await verifyCredentialBinding(dk, VAULT, 'cred-1', 3, publicKey, binding)).toBe(false);
    expect(await verifyCredentialBinding(await importDataKey(fromHex('41'.repeat(32))), VAULT, 'cred-1', 2, publicKey, binding)).toBe(false);
    expect(await verifyCredentialBinding(dk, VAULT, 'cred-1', 2, publicKey, binding.slice(1))).toBe(false);
  });
});
