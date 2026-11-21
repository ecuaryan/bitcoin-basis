/** Errors the vault raises for the UI. Lower layers raise `ApiError`, `PasskeyError`, `RecoveryCodeError`, `KeyError` and `SealError`. */

export type VaultErrorCode =
  /** The action needs an unlocked vault. */
  | 'locked'
  /** No vault on this device yet (create one or restore with the recovery code). */
  | 'no-vault'
  /** This device already holds a vault. */
  | 'vault-exists'
  /** The server already belongs to a vault: restore instead of creating. */
  | 'already-claimed'
  | 'wrong-setup-code'
  /** The code is well-formed (its check passed) but doesn't open this vault, or was replaced. */
  | 'wrong-recovery-code'
  /** The server's vault is not the one stored on this device. */
  | 'vault-mismatch'
  /** The server rejected the passkey. */
  | 'passkey-rejected'
  /** The passkey or browser has no PRF: unlock with the recovery code on this device. */
  | 'prf-unavailable'
  /** No passkey on this device can unlock offline. */
  | 'no-passkey'
  /** Passkeys are not available in this browser. */
  | 'passkeys-unsupported'
  | 'offline'
  /** The server needs a fresh sign-in (call `connect()`). */
  | 'needs-session'
  /**
   * The recovery code was replaced on another device and this device was unlocked with the old one:
   * it can still read, but can't write until unlocked with the new code or a passkey.
   */
  | 'recovery-code-changed'
  /** Stored entries can't be removed: the ledger is append-only. */
  | 'append-only'
  /** The server answered with something the protocol doesn't allow. */
  | 'server';

export class VaultError extends Error {
  override readonly name = 'VaultError';
  constructor(readonly code: VaultErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? `vault: ${code}`, options);
  }
}
