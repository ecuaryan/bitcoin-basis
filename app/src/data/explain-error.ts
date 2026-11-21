import { ApiError, PasskeyError, RecoveryCodeError, VaultError } from '../vault/index.ts';

/** Plain-language text for anything the vault can throw. Never shows codes or internals. */
export function explainError(e: unknown): string {
  if (e instanceof RecoveryCodeError) return e.message;
  if (e instanceof VaultError) {
    switch (e.code) {
      case 'wrong-setup-code':
        return 'That setup code is not right. Copy it again from your install script.';
      case 'already-claimed':
        return 'This app already belongs to someone. Use “Open my records” instead.';
      case 'wrong-recovery-code':
        return 'That recovery code is well formed but does not open these records. It may be from an older kit.';
      case 'prf-unavailable':
        return 'This browser or passkey cannot unlock records. Try Chrome on Android, or Safari or Chrome on a Mac, or use your recovery code.';
      case 'passkeys-unsupported':
        return 'Passkeys are not available in this browser. Use your recovery code instead.';
      case 'passkey-rejected':
        return 'That passkey does not open these records. Try another one, or use your recovery code.';
      case 'no-passkey':
        return 'There is no passkey on this device yet. Use your recovery code.';
      case 'offline':
        return 'You are offline, and this step needs a connection. Try again when you are back online.';
      case 'needs-session':
        return 'Sign in again to sync. Tap Connect.';
      case 'no-vault':
        return 'The server has no records to restore yet. Set up first.';
      case 'vault-mismatch':
        return 'These records belong to a different app than the one on this device.';
      case 'locked':
        return 'Unlock first.';
      case 'vault-exists':
        return 'This device already has records. Unlock them instead.';
      default:
        return 'Something went wrong on the server. Try again in a minute.';
    }
  }
  if (e instanceof PasskeyError) {
    if (e.code === 'cancelled') return 'That was cancelled. Try again when you are ready.';
    if (e.code === 'unsupported') return 'Passkeys are not available in this browser. Use your recovery code instead.';
    if (e.code === 'prf-unavailable') return 'This passkey cannot unlock records. Use your recovery code.';
    return 'The passkey did not work. Try again.';
  }
  if (e instanceof ApiError) {
    if (e.kind === 'network') return 'Could not reach your server. Check your connection and try again.';
    if (e.kind === 'rate-limited') return 'Too many tries. Wait a minute and try again.';
    return 'Your server did not accept that. Try again in a minute.';
  }
  return 'Something went wrong. Try again.';
}

/** True when the person simply dismissed the passkey prompt (not worth an error banner). */
export function wasCancelled(e: unknown): boolean {
  return e instanceof PasskeyError && e.code === 'cancelled';
}
