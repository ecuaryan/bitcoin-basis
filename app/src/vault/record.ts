/** The `vault` record kept in IndexedDB: public metadata and wrapped keys only. Binary fields are base64url. */

export const RECORD_KEY = 'vault';

export interface StoredCredential {
  readonly id: string;
  readonly prfSalt: string;
  readonly wrappedDk: string;
}

export interface StoredRecovery {
  readonly version: number;
  readonly salt: string;
  readonly wrappedDk: string;
}

export interface VaultRecord {
  readonly vaultId: string;
  /** `null` on a device first unlocked with a synced passkey (it never saw the recovery wrapping). */
  readonly recovery: StoredRecovery | null;
  /** Passkeys with PRF that can unlock this device. */
  readonly credentials: readonly StoredCredential[];
  /** Last pulled server key. */
  readonly cursor: string | null;
  readonly origin: string;
}

/** Validate a stored record (it may come from an older build or be damaged). */
export function parseRecord(v: unknown): VaultRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.vaultId !== 'string' || !Array.isArray(r.credentials)) return null;
  const rec = r.recovery as Record<string, unknown> | null | undefined;
  const recovery =
    rec && typeof rec.version === 'number' && typeof rec.salt === 'string' && typeof rec.wrappedDk === 'string' ? { version: rec.version, salt: rec.salt, wrappedDk: rec.wrappedDk } : null;
  const credentials = (r.credentials as unknown[]).flatMap((c) => {
    const o = c as Record<string, unknown> | null;
    return o && typeof o.id === 'string' && typeof o.prfSalt === 'string' && typeof o.wrappedDk === 'string' ? [{ id: o.id, prfSalt: o.prfSalt, wrappedDk: o.wrappedDk }] : [];
  });
  return { vaultId: r.vaultId, recovery, credentials, cursor: typeof r.cursor === 'string' ? r.cursor : null, origin: typeof r.origin === 'string' ? r.origin : '' };
}
