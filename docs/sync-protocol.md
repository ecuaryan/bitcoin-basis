# Keys, storage and sync protocol

The contract between the app (`app/src/vault/`) and the sync Worker (`worker/`). The server is a dumb, encrypted mailbox: it stores ciphertext and wrapped keys, verifies passkeys, and never sees a key or plaintext. Nothing can be overwritten or deleted through it.

## Cryptography (WebCrypto only)

| Item | Algorithm | Notes |
|---|---|---|
| Data key (DK) | AES-256-GCM, random | Encrypts every entry. Lives unwrapped only in memory while unlocked. |
| Passkey KEK | HKDF-SHA-256 over the passkey PRF output | `salt` = 32 random bytes stored with that credential, `info` = `bitcoin-basis/kek/passkey/v1`. Derives an AES-256-GCM key used only to wrap the DK. |
| Recovery KEK | HKDF-SHA-256 over the 128-bit recovery secret | `salt` = 32 random bytes (the vault's recovery salt), `info` = `bitcoin-basis/kek/recovery/v1`. |
| Recovery auth token | HKDF-SHA-256, same input and salt | `info` = `bitcoin-basis/auth/recovery/v1`, 32 bytes. The server stores only `SHA-256(token)`. |
| Wrapping | AES-256-GCM `encrypt` of the raw DK | 12-byte random IV, AAD = `bitcoin-basis/wrap/v1|<vaultId>|<kind>` where kind is `passkey:<credentialId>` or `recovery:<version>`. |
| Entry sealing | AES-256-GCM | 12-byte random IV per blob, AAD = `bitcoin-basis/blob/v1|<vaultId>`. |

No slow KDF is used for the recovery code: it carries 128 bits of entropy, so brute force is already infeasible.

### Recovery code

- 128 random bits, plus a 22-bit check (the first 22 bits of `SHA-256(secret)`), = 150 bits.
- Written as 30 characters in six groups of five, `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`, in Crockford base32: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32 symbols). The letters `I L O U` are not in the alphabet, so no two symbols look alike.
- Input is forgiving: case-insensitive, spaces and dashes ignored, `O` read as `0` and `I`/`L` read as `1`. A failed check means a typo, reported before any network call.
- Labeled everywhere: **This is NOT a Bitcoin seed phrase.**
- QR form: `https://<app>/#recover=<code>`. The code lives in the URL fragment, which browsers never send to the server; the app removes it from the address bar and history (`history.replaceState`) as soon as it reads it.

### Padding

Plaintext blob = UTF-8 JSON `{"v":1,"entries":[…]}`, then one `0x80` byte, then zero bytes up to the smallest bucket that fits: **1 KiB, 4 KiB, 16 KiB, 64 KiB**. Larger batches are split across several blobs. The server rejects any blob whose size isn't exactly `bucket + 12 (IV) + 16 (tag) + 1 (version byte)`.

Blob wire format: `version (1 byte = 1) || iv (12) || ciphertext+tag`.

## On the device

IndexedDB database `bitcoin-basis` (all values are ciphertext or public metadata):

- `vault`: `{ vaultId, recovery: { version, salt, wrappedDk }, credentials: [{ id, prfSalt, wrappedDk }], cursor, origin }`
- `blobs`: server key → sealed bytes (everything ever synced: the device keeps a full copy)
- `outbox`: local id → sealed bytes not yet uploaded

Unlock = unwrap the DK (passkey PRF or recovery code), decrypt all blobs into memory, replay. Lock = drop the DK and all plaintext; auto-lock after N idle minutes (setting, default 5) and when the page is hidden for longer than that.

## Server storage (R2, private bucket `DATA`)

All writes use `put(key, body, { onlyIf: { etagDoesNotMatch: '*' } })` ("only if new"); a `null` result means the key exists → `409`. The Worker has no code path that deletes or overwrites.

| Key | Body |
|---|---|
| `meta/claimed` | `{ vaultId, claimedAt }`, written at the first passkey registration |
| `cred/<credentialId>` | `{ publicKey, transports, createdAt, prfSalt, wrappedDk }` |
| `recovery/<version, 6 digits>` | `{ salt, authVerifier, wrappedDk, createdAt }`; the highest version is current |
| `e/<13-digit server ms>-<16 hex random>` | a sealed blob |

Passkey sign counters are not enforced (synced passkeys report 0, and the store is append-only).

## Sessions and requests

- Session = `HttpOnly; Secure; SameSite=Strict; Path=/api` cookie holding an HMAC-SHA-256-signed `{ kind: 'passkey' | 'recovery', exp }` (12 h). Secret: Worker secret `SESSION_SECRET`.
- WebAuthn challenges are stateless: HMAC-signed, 5-minute challenge tokens returned with the options and sent back with the response.
- Every non-GET request must have `Origin` equal to the configured `ORIGIN` and `Content-Type: application/json` (or `application/octet-stream` for blob upload). Responses carry no CORS headers (same origin only).
- RP ID = the app's hostname. `workers.dev` is on the Public Suffix List, so each instance is its own passkey scope.

## API

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/status` | none | `{ claimed }` |
| `POST /api/register/options` | session, **or** `{ setupCode }` while unclaimed | WebAuthn creation options (PRF requested, resident key, user verification required) |
| `POST /api/register/verify` | same | `{ response, challengeToken, prfSalt, wrappedDk, claim?: { vaultId, recovery: { salt, authVerifier, wrappedDk } } }` → stores the credential; `claim` only on the first registration |
| `POST /api/login/options` | none | assertion options + challenge token |
| `POST /api/login/verify` | none | verifies the assertion → session cookie + `{ vaultId, prfSalt, wrappedDk }` for that credential |
| `GET /api/recovery/params` | none | `{ vaultId, version, salt }` |
| `POST /api/recovery/login` | none | `{ authToken }` → session cookie + `{ wrappedDk, version }` (constant-time comparison of `SHA-256(authToken)`) |
| `POST /api/recovery/rotate` | session | new recovery version (after printing a new kit) |
| `POST /api/blobs` | session | body = sealed blob → `{ key }` |
| `GET /api/blobs?after=<key>&limit=<≤200>` | session | `{ blobs: [{ key, data (base64) }], more }`, ascending by key |
| `POST /api/logout` | session | clears the cookie |

The setup code is a 128-bit random value set as the Worker secret `SETUP_CODE` by the setup script. It works only while `meta/claimed` doesn't exist. After that, registering a new passkey requires a session (an unlocked device).

## Backups

A daily cron trigger lists `DATA` and copies every object missing from the `BACKUP` bucket (only-if-new). `BACKUP` has an R2 bucket lock rule (set by the owner with `wrangler`), so nothing in it can be deleted or overwritten for the retention period, even by the Worker.

## What the server can still do (honest limits)

It can withhold or delay blobs (each device keeps a full copy and notices missing data on the next full compare), learn timing and approximate volume of writes, and, as with any web app, a compromised deployment could serve malicious code. See `SECURITY.md`.
