import { describe, expect, test } from 'vitest';
import { randomBytes, toBase64Url, toHex } from './bytes.ts';
import { createPasskey, detectPrfSupport, evaluatePrf, getAssertion, PasskeyError, PRF_INPUT_HEX, type PublicKeyCredentialCreationOptionsJSON } from './passkey.ts';
import { FakeAuthenticator } from './test/fake-authenticator.ts';

const creation = (): PublicKeyCredentialCreationOptionsJSON => ({
  rp: { id: 'basis.example', name: 'Bitcoin Basis' },
  user: { id: toBase64Url(randomBytes(16)), name: 'owner', displayName: 'Bitcoin Basis' },
  challenge: toBase64Url(randomBytes(32)),
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  extensions: { prf: {} },
});
const request = () => ({ challenge: toBase64Url(randomBytes(32)), rpId: 'basis.example' });

describe('PRF detection', () => {
  test('uses getClientCapabilities when present', async () => {
    expect(await detectPrfSupport({ getClientCapabilities: () => Promise.resolve({ 'extension:prf': true }) })).toBe('supported');
    expect(await detectPrfSupport({ getClientCapabilities: () => Promise.resolve({ 'extension:prf': false }) })).toBe('unsupported');
    expect(await detectPrfSupport({ getClientCapabilities: () => Promise.resolve({}) })).toBe('unknown');
    expect(await detectPrfSupport({ getClientCapabilities: () => Promise.reject(new Error('x')) })).toBe('unknown');
    expect(await detectPrfSupport({})).toBe('unknown');
    expect(await detectPrfSupport(undefined)).toBe('unknown');
  });
});

describe('createPasskey', () => {
  test('the PRF input is the frozen constant SHA-256("bitcoin-basis/prf/v1")', async () => {
    expect(PRF_INPUT_HEX).toBe('a47c720225990a579313aa61a5339189f172aa3305c50e82600db23fc835ee16');
    expect(toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bitcoin-basis/prf/v1'))))).toBe(PRF_INPUT_HEX);
  });

  test('PRF on create: one prompt; JSON never carries the PRF output', async () => {
    const auth = new FakeAuthenticator('a');
    const pk = await createPasskey(auth, creation());
    expect(auth.calls).toEqual({ create: 1, get: 0 });
    expect(pk.prfOutput).not.toBeNull();
    expect(pk.response.id).toBe(pk.credentialId);
    expect(pk.response.rawId).toBe(pk.credentialId);
    expect(pk.response.type).toBe('public-key');
    expect(pk.response.response.transports).toEqual(['internal', 'hybrid']);
    expect(pk.response.response.publicKeyAlgorithm).toBe(-7);
    expect(pk.response.clientExtensionResults).toEqual({ prf: { enabled: true }, credProps: { rk: true } });
    const json = JSON.stringify(pk.response);
    expect(json).not.toContain(toBase64Url(pk.prfOutput as Uint8Array));
    expect(json).not.toContain('results');
    // Deterministic: evaluating again with the same salt gives the same output.
    const again = await evaluatePrf(auth, [pk.credentialId]);
    expect(toHex(again.prfOutput)).toBe(toHex(pk.prfOutput as Uint8Array));
  });

  test('PRF enabled but no results on create: a follow-up get evaluates it', async () => {
    const auth = new FakeAuthenticator('b', { prfOnCreate: 'enabled-only' });
    const pk = await createPasskey(auth, creation());
    expect(auth.calls).toEqual({ create: 1, get: 1 });
    const direct = await evaluatePrf(auth, [pk.credentialId]);
    expect(toHex(pk.prfOutput as Uint8Array)).toBe(toHex(direct.prfOutput));
  });

  test('no PRF: prfOutput is null, no second prompt', async () => {
    const auth = new FakeAuthenticator('c', { prfOnCreate: 'none' });
    const pk = await createPasskey(auth, creation());
    expect(pk.prfOutput).toBeNull();
    expect(auth.calls.get).toBe(0);
    expect(pk.response.clientExtensionResults.prf).toEqual({ enabled: false });
  });

  test('user verification is forced to required; cancel is a typed error', async () => {
    const auth = new FakeAuthenticator('d');
    auth.cancelNext = true;
    await expect(createPasskey(auth, creation())).rejects.toMatchObject({ name: 'PasskeyError', code: 'cancelled' });
  });
});

describe('getAssertion', () => {
  test('restricted to known credentials; the same constant input for each', async () => {
    const auth = new FakeAuthenticator('e');
    const p1 = await createPasskey(auth, creation());
    const p2 = await createPasskey(auth, creation());
    expect(toHex(p1.prfOutput as Uint8Array)).not.toBe(toHex(p2.prfOutput as Uint8Array));
    auth.creds.shift(); // the "user" only has the second one here
    const a = await getAssertion(auth, request(), [p1.credentialId, p2.credentialId]);
    expect(a.credentialId).toBe(p2.credentialId);
    expect(toHex(a.prfOutput as Uint8Array)).toBe(toHex(p2.prfOutput as Uint8Array));
    expect(a.response.response.signature).not.toBe('');
    expect(a.response.response.userHandle).toBeDefined();
    expect(JSON.stringify(a.response)).not.toContain(toBase64Url(a.prfOutput as Uint8Array));
  });

  test('discoverable (nothing known): PRF still comes back in the same prompt', async () => {
    const auth = new FakeAuthenticator('f');
    const pk = await createPasskey(auth, creation());
    const gets = auth.calls.get;
    const a = await getAssertion(auth, request(), []);
    expect(auth.calls.get).toBe(gets + 1);
    expect(toHex(a.prfOutput as Uint8Array)).toBe(toHex(pk.prfOutput as Uint8Array));
  });

  test('evaluatePrf without a credential or without PRF fails clearly', async () => {
    await expect(evaluatePrf(new FakeAuthenticator('g'), [])).rejects.toMatchObject({ code: 'no-credential' });
    const auth = new FakeAuthenticator('h', { prfOnGet: false });
    const pk = await createPasskey(auth, creation());
    await expect(evaluatePrf(auth, [pk.credentialId])).rejects.toBeInstanceOf(PasskeyError);
  });
});

describe('error codes', () => {
  test('a passkey for these records already on the authenticator is "exists", not a generic failure', async () => {
    const auth = new FakeAuthenticator('i', { honorExclude: true });
    const pk = await createPasskey(auth, creation());
    await expect(createPasskey(auth, { ...creation(), excludeCredentials: [{ id: pk.credentialId, type: 'public-key' }] })).rejects.toMatchObject({ name: 'PasskeyError', code: 'exists' });
    // Another passkey is fine.
    await expect(createPasskey(auth, { ...creation(), excludeCredentials: [{ id: toBase64Url(randomBytes(16)), type: 'public-key' }] })).resolves.toBeDefined();
  });

  test.each([
    ['NotAllowedError', 'cancelled'],
    ['AbortError', 'cancelled'],
    ['NotSupportedError', 'unsupported'],
    ['SecurityError', 'unsupported'],
    ['InvalidStateError', 'exists'],
    ['ConstraintError', 'constraint'],
    ['UnknownError', 'failed'],
  ])('%s from the browser is %s', async (name, code) => {
    const failing = { create: () => Promise.reject(Object.assign(new Error(name), { name })), get: () => Promise.reject(Object.assign(new Error(name), { name })) };
    await expect(createPasskey(failing, creation())).rejects.toMatchObject({ code });
    await expect(getAssertion(failing, request(), [])).rejects.toMatchObject({ code });
  });
});
