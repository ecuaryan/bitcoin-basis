import { createDecipheriv, hkdfSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { fromHex, toBase64Url, toHex, utf8 } from './bytes.ts';
import {
  authVerifier,
  deriveRecoveryAuthToken,
  deriveRecoveryKek,
  derivePasskeyKek,
  importDataKey,
  INFO_RECOVERY_KEK,
  KeyError,
  unwrapDataKey,
  unwrapDataKeyBytes,
  wrapAad,
  wrapDataKey,
} from './keys.ts';
import { openBlob, pad, sealPadded } from './seal.ts';

// Fixed inputs. The outputs below are frozen: if any changes, existing vaults would stop opening.
const SECRET = fromHex('000102030405060708090a0b0c0d0e0f');
const SALT = fromHex('10'.repeat(32));
const PRF = fromHex('20'.repeat(32));
const PRF_SALT = fromHex('30'.repeat(32));
const DK = fromHex('40'.repeat(32));
const IV = fromHex('50'.repeat(12));
const VAULT = 'vault-A';

const TOKEN = '6dbc9cbae2887c672bbbc0dd0ca5cf800ebf501faf559563d2b60c2d9b47cb98'; // gitleaks:allow (fixed test vector)
const VERIFIER = 'k3F-CTFs9UM_6fyp6nYN0q1a-XD1CuJtFVTKE8-hkJY';
const WRAPPED_RECOVERY = '5050505050505050505050500638601a6406688291cf910ab4ee4199df80d2fb6154cbe8f4ac3e2a4bcbe36e750f854146f6b2d20c64d575302eb8a4';
const WRAPPED_PASSKEY = '505050505050505050505050006299aea5698f3280172c0f05d62ef533f8e64cc540cc9e1ac429ecd835b4f735a2231b194c00205801efb328922b48'; // gitleaks:allow (fixed test vector)
const EMPTY_BLOB_SHA256 = '50193d0405d7b4a4e5323273dd0ec101d61b0b06096957ee24c60980caa3ce4c';

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
    expect(new TextDecoder().decode(aad)).toBe('bitcoin-basis/wrap/v1|vault-A|recovery:1');
    expect(toHex(await wrapDataKey(DK, kek, aad, IV))).toBe(WRAPPED_RECOVERY);
    // Independent check: Node HKDF + AES-256-GCM decrypt.
    const key = Buffer.from(hkdfSync('sha256', SECRET, SALT, INFO_RECOVERY_KEK, 32));
    const w = Buffer.from(WRAPPED_RECOVERY, 'hex');
    const d = createDecipheriv('aes-256-gcm', key, w.subarray(0, 12));
    d.setAAD(aad);
    d.setAuthTag(w.subarray(w.length - 16));
    expect(Buffer.concat([d.update(w.subarray(12, w.length - 16)), d.final()]).toString('hex')).toBe(toHex(DK));
  });

  test('DK wrapped under the passkey KEK', async () => {
    const kek = await derivePasskeyKek(PRF, PRF_SALT);
    const aad = wrapAad(VAULT, { type: 'passkey', credentialId: 'cred-1' });
    expect(new TextDecoder().decode(aad)).toBe('bitcoin-basis/wrap/v1|vault-A|passkey:cred-1');
    expect(toHex(await wrapDataKey(DK, kek, aad, IV))).toBe(WRAPPED_PASSKEY);
    const key = Buffer.from(hkdfSync('sha256', PRF, PRF_SALT, 'bitcoin-basis/kek/passkey/v1', 32));
    const w = Buffer.from(WRAPPED_PASSKEY, 'hex');
    const d = createDecipheriv('aes-256-gcm', key, w.subarray(0, 12));
    d.setAAD(aad);
    d.setAuthTag(w.subarray(w.length - 16));
    expect(Buffer.concat([d.update(w.subarray(12, w.length - 16)), d.final()]).toString('hex')).toBe(toHex(DK));
  });

  test('a frozen wrapping unwraps to a DK that seals a frozen blob', async () => {
    const kek = await deriveRecoveryKek(SECRET, SALT);
    const dk = await unwrapDataKey(fromHex(WRAPPED_RECOVERY), kek, wrapAad(VAULT, { type: 'recovery', version: 1 }));
    expect(dk.extractable).toBe(false);
    const blob = await sealPadded(dk, VAULT, pad(utf8('{"v":1,"entries":[]}')), IV);
    expect(blob.length).toBe(1024 + 29);
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
    ['a passkey kind', wrapAad(VAULT, { type: 'passkey', credentialId: 'x' })],
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
    expect(() => wrapAad('v', { type: 'passkey', credentialId: '' })).toThrow(KeyError);
    expect(() => wrapAad('v', { type: 'recovery', version: 0 })).toThrow(KeyError);
    expect(() => derivePasskeyKek(PRF.slice(0, 16), PRF_SALT)).toThrow(KeyError);
    await expect(deriveRecoveryAuthToken(SECRET, SALT.slice(1))).rejects.toThrow(KeyError);
  });
});
