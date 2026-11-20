/** Public API of the vault: keys, encrypted local storage and sync. See docs/sync-protocol.md. */
export { Vault, type CreateResult, type LockReason, type UnlockResult, type VaultEnvironment, type VaultOptions, type VaultState, type VaultStatus } from './vault.ts';
export { VaultError, type VaultErrorCode } from './errors.ts';
export { EncryptedLedgerStore, type SyncPhase, type SyncResult, type SyncStatus } from './encrypted-store.ts';
export {
  cleanRecoveryCodeInput,
  formatRecoveryCode,
  parseRecoveryCode,
  readRecoveryFragment,
  recoveryLink,
  RecoveryCodeError,
  takeRecoveryCodeFromUrl,
  type RecoveryCode,
  type RecoveryCodeProblem,
} from './recovery-code.ts';
export { ApiError, createApiClient, type ApiClient, type ApiErrorKind } from './api.ts';
export { detectPrfSupport, PasskeyError, type PasskeyErrorCode, type PrfSupport } from './passkey.ts';
export { openIndexedDb, createMemoryDb, type VaultDb } from './idb.ts';
