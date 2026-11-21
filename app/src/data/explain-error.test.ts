import { describe, expect, test } from 'vitest';
import { PasskeyError, VaultError, type PasskeyErrorCode, type VaultErrorCode } from '../vault/index.ts';
import { explainError, passkeyRestoreFallback } from './explain-error.ts';

const OLD_GENERIC = 'The passkey did not work. Try again.';
const SERVER_DEFAULT = 'Something went wrong on the server. Try again in a minute.';

// Every code, so a new one can't be added without deciding its text.
const PASSKEY_CODES = { unsupported: 1, cancelled: 1, 'no-credential': 1, 'prf-unavailable': 1, exists: 1, constraint: 1, failed: 1, aborted: 1, timeout: 1 } satisfies Record<PasskeyErrorCode, 1>;

describe('passkey failures say why', () => {
  test.each(Object.keys(PASSKEY_CODES) as PasskeyErrorCode[])('%s has its own plain text', (code) => {
    const text = explainError(new PasskeyError(code));
    expect(text).not.toBe(OLD_GENERIC);
    expect(text).not.toMatch(/[A-Z][a-z]+Error|PRF|WebAuthn/);
  });

  test('a synced passkey already here, and one without PRF', () => {
    expect(explainError(new PasskeyError('exists'))).toContain('already has a passkey');
    const noPrf = explainError(new VaultError('synced-passkey-no-prf'));
    expect(noPrf).toContain('Google Password Manager (Android)');
    expect(noPrf).toContain('iCloud Keychain (Apple)');
  });

  test.each(['synced-passkey-no-prf', 'no-passkey', 'passkey-rejected', 'prf-unavailable', 'passkeys-unsupported', 'passkey-timeout', 'recovery-code-changed'] satisfies VaultErrorCode[])(
    'vault code %s is not the server catch-all',
    (code) => {
      expect(explainError(new VaultError(code))).not.toBe(SERVER_DEFAULT);
    },
  );
});

describe('the passkey route on "Open your records" falls back to the code', () => {
  test.each([new PasskeyError('cancelled'), new VaultError('no-passkey'), new VaultError('passkey-rejected'), new VaultError('prf-unavailable'), new VaultError('passkeys-unsupported')])('%s points at the recovery code', (e) => {
    expect(passkeyRestoreFallback(e)).toContain('recovery code below');
  });

  test('other problems keep their own text', () => {
    expect(passkeyRestoreFallback(new VaultError('offline'))).toBe(explainError(new VaultError('offline')));
  });
});
