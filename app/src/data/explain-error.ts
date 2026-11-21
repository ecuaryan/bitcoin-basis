import { ApiError, PasskeyError, RecoveryCodeError, VaultError } from '../vault/index.ts';

/** Plain-language text for anything the vault can throw. Never shows codes or internals. */
export function explainError(e: unknown): string {
  if (e instanceof RecoveryCodeError) return e.message;
  if (e instanceof VaultError) {
    switch (e.code) {
      case 'wrong-setup-code':
        return 'That setup code is not right. Copy it again from where the setup step printed it.';
      case 'already-claimed':
        return 'This app already belongs to someone. Choose “I already use Bitcoin Basis” instead.';
      case 'wrong-recovery-code':
        return 'That recovery code is well formed but does not open these records. It may be from an older kit.';
      case 'prf-unavailable':
        return 'This browser or passkey cannot unlock records. Try Chrome on Android, or Safari or Chrome on a Mac, or use your recovery code.';
      case 'passkeys-unsupported':
        return 'Passkeys are not available in this browser. Use your recovery code instead.';
      case 'passkey-rejected':
        return 'That passkey does not open these records. Try another one, or use your recovery code.';
      case 'synced-passkey-no-prf':
        return 'Your passkey from your other device signs in here, but it cannot unlock records on this device. Save your passkey in Google Password Manager (Android) or iCloud Keychain (Apple), then try again. Until then, use your recovery code here.';
      case 'no-passkey':
        return 'There is no passkey for these records on this device yet. Use your recovery code.';
      case 'offline':
        return 'You are offline, and this step needs a connection. Try again when you are back online.';
      case 'timeout':
        return 'Your server is taking too long to answer. Check your connection and try again.';
      case 'passkey-timeout':
        return 'The passkey prompt did not open. Tap Unlock to try again.';
      case 'aborted':
        return 'Cancelled. Tap to try again.';
      case 'storage-blocked':
        return 'Bitcoin Basis is busy in another window or tab. Close the others, then try again.';
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
      case 'recovery-code-changed':
        return 'Your recovery code was changed on another device. Unlock with the new code or a passkey to save changes.';
      default:
        return 'Something went wrong on the server. Try again in a minute.';
    }
  }
  if (e instanceof PasskeyError) {
    switch (e.code) {
      case 'cancelled':
      case 'aborted':
        return 'That was cancelled. Try again when you are ready.';
      case 'timeout':
        return 'The passkey prompt did not open. Try again.';
      case 'unsupported':
        return 'Passkeys are not available in this browser. Use your recovery code instead.';
      case 'prf-unavailable':
        return 'This passkey cannot unlock records. Use your recovery code.';
      case 'exists':
        return 'This device already has a passkey for these records, synced from another device. Use it to unlock.';
      case 'no-credential':
        return 'No passkey for these records was found on this device. Use your recovery code.';
      case 'constraint':
        return 'This device cannot make a passkey without a screen lock. Turn on a PIN, fingerprint or face unlock, then try again.';
      default:
        return 'The passkey prompt stopped with an error your browser did not explain. Try again, or use your recovery code.';
    }
  }
  if (e instanceof ApiError) {
    if (e.kind === 'network') return 'Could not reach your server. Check your connection and try again.';
    if (e.kind === 'timeout') return 'Your server is taking too long to answer. Check your connection and try again.';
    if (e.kind === 'rate-limited') return 'Too many tries. Wait a minute and try again.';
    return 'Your server did not accept that. Try again in a minute.';
  }
  return 'Something went wrong. Try again.';
}

/** True when the person simply dismissed the passkey prompt (not worth an error banner). */
export function wasCancelled(e: unknown): boolean {
  return e instanceof PasskeyError && e.code === 'cancelled';
}

/**
 * Welcome, "Open your records": the passkey found nothing usable on this device, so the recovery-code
 * field below is the way on. Says why in plain words, and points at the code.
 */
export function passkeyRestoreFallback(e: unknown): string {
  if (e instanceof PasskeyError && (e.code === 'cancelled' || e.code === 'no-credential')) return 'No passkey was used. If your passkey is not on this device, type your recovery code below.';
  if (e instanceof VaultError) {
    switch (e.code) {
      case 'no-passkey':
        return 'No passkey for these records was found on this device. Type your recovery code below.';
      case 'passkey-rejected':
        return 'That passkey does not open these records. Type your recovery code below instead.';
      case 'prf-unavailable':
        return 'That passkey cannot unlock records on this device. Type your recovery code below; you can add a passkey afterwards.';
      case 'passkeys-unsupported':
        return 'Passkeys are not available in this browser. Type your recovery code below.';
      default:
        break;
    }
  }
  return explainError(e);
}
