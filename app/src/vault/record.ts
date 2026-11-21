/** The `vault` record kept in IndexedDB: public metadata and wrapped keys only. Binary fields are base64url. */

export const RECORD_KEY = 'vault';
/** Bumped when the record's shape changes; an older record is treated as no vault on this device. */
export const RECORD_FORMAT = 2;

/** A data key delivered to a passkey for one epoch (ephemeral ECDH public key + wrapped DK). */
export interface StoredDelivery {
  readonly epoch: number;
  readonly ephemeralPublicKey: string;
  readonly wrappedDk: string;
}

export interface StoredCredential {
  readonly id: string;
  readonly prfSalt: string;
  /** The passkey's ECDH private key (PKCS#8), wrapped with its PRF KEK. */
  readonly wrappedPrivateKey: string;
  /** The passkey's ECDH public key (65 bytes, uncompressed). */
  readonly publicKey: string;
  /** The newest data-key delivery this device holds for the passkey. */
  readonly delivery: StoredDelivery;
}

/** The recovery code's wrapping of DK_version (version = epoch). */
export interface StoredRecovery {
  readonly version: number;
  readonly salt: string;
  readonly wrappedDk: string;
}

export interface VaultRecord {
  readonly format: typeof RECORD_FORMAT;
  readonly vaultId: string;
  /** `null` on a device first unlocked with a synced passkey, or after the code was rotated elsewhere. */
  readonly recovery: StoredRecovery | null;
  /** Passkeys with PRF that can unlock this device. */
  readonly credentials: readonly StoredCredential[];
  /** The newest data-key epoch this device has heard of. */
  readonly epoch: number;
  /** Epoch → that epoch's history (older data keys sealed under its key), as on the server. */
  readonly histories: Readonly<Record<string, string>>;
  /**
   * Epoch → device time (ms) when this device first heard of it. A blob of an older epoch whose
   * server key is stamped well after that moment can't come from an honest server (uploads under
   * an older epoch are refused once a newer one exists), so it is refused as a possible forgery
   * with a revoked key.
   */
  readonly learned: Readonly<Record<string, number>>;
  /** The recovery code was replaced on another device; this device dropped its copy of the old wrapping. */
  readonly recoveryChanged: boolean;
  /** A lock happened offline: end the server session the next time we are online. */
  readonly logoutPending: boolean;
  /** Last pulled server key. */
  readonly cursor: string | null;
  readonly origin: string;
}

const str = (v: unknown): v is string => typeof v === 'string';
const pos = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

function parseDelivery(v: unknown): StoredDelivery | null {
  const o = v as Record<string, unknown> | null | undefined;
  return o && pos(o.epoch) && str(o.ephemeralPublicKey) && str(o.wrappedDk) ? { epoch: o.epoch, ephemeralPublicKey: o.ephemeralPublicKey, wrappedDk: o.wrappedDk } : null;
}

/** Validate a stored record (it may come from an older build or be damaged). */
export function parseRecord(v: unknown): VaultRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.format !== RECORD_FORMAT || !str(r.vaultId) || !Array.isArray(r.credentials) || !pos(r.epoch)) return null;
  const rec = r.recovery as Record<string, unknown> | null | undefined;
  const recovery = rec && pos(rec.version) && str(rec.salt) && str(rec.wrappedDk) ? { version: rec.version, salt: rec.salt, wrappedDk: rec.wrappedDk } : null;
  const credentials = (r.credentials as unknown[]).flatMap((c) => {
    const o = c as Record<string, unknown> | null;
    const delivery = parseDelivery(o?.delivery);
    return o && str(o.id) && str(o.prfSalt) && str(o.wrappedPrivateKey) && str(o.publicKey) && delivery
      ? [{ id: o.id, prfSalt: o.prfSalt, wrappedPrivateKey: o.wrappedPrivateKey, publicKey: o.publicKey, delivery }]
      : [];
  });
  const learned: Record<string, number> = {};
  if (typeof r.learned === 'object' && r.learned !== null) {
    for (const [k, t] of Object.entries(r.learned as Record<string, unknown>)) if (/^[1-9]\d*$/.test(k) && typeof t === 'number' && Number.isFinite(t)) learned[k] = t;
  }
  const histories: Record<string, string> = {};
  if (typeof r.histories === 'object' && r.histories !== null) {
    for (const [k, h] of Object.entries(r.histories as Record<string, unknown>)) if (/^[1-9]\d*$/.test(k) && str(h)) histories[k] = h;
  }
  return {
    format: RECORD_FORMAT,
    vaultId: r.vaultId,
    recovery,
    credentials,
    epoch: r.epoch,
    histories,
    learned,
    recoveryChanged: r.recoveryChanged === true,
    logoutPending: r.logoutPending === true,
    cursor: str(r.cursor) ? r.cursor : null,
    origin: str(r.origin) ? r.origin : '',
  };
}
