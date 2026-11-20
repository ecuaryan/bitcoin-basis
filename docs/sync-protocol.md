# Keys, storage and sync protocol

The contract between the app (`app/src/vault/`) and the sync Worker (`worker/`). The server is a dumb, encrypted mailbox: it stores ciphertext and wrapped keys, verifies passkeys, and never sees a key or plaintext. Nothing can be overwritten or deleted through it.

## Cryptography (WebCrypto only)

| Item | Algorithm | Notes |
|---|---|---|
| Data key (DK) | AES-256-GCM, random | Encrypts every entry. Lives unwrapped only in memory while unlocked. |
| Passkey KEK | HKDF-SHA-256 over the passkey PRF output | `salt` = 32 random bytes stored with that credential, `info` = `bitcoin-basis/kek/passkey/v1`. Derives an AES-256-GCM key used only to wrap the DK. |
| Recovery KEK | HKDF-SHA-256 over the 128-bit recovery secret | `salt` = 32 random bytes (the vault's recovery salt), `info` = `bitcoin-basis/kek/recovery/v1`. |
| Recovery auth token | HKDF-SHA-256, same input and salt | `info` = `bitcoin-basis/auth/recovery/v1`, 32 bytes. The server stores only `SHA-256(token)`. |
| Wrapping | AES-256-GCM `encrypt` of the raw DK | 12-byte random IV, AAD = `bitcoin-basis/wrap/v1|<vaultId>|<kind>` where kind is `passkey:<credentialId>` or `recovery:<version>`. `wrappedDk` = `iv (12) || ciphertext+tag (48)` = 60 bytes. |
| Entry sealing | AES-256-GCM | 12-byte random IV per blob, AAD = `bitcoin-basis/blob/v1|<vaultId>`. |

**Encoding.** Every binary value in JSON is unpadded base64url. Exact sizes, checked by the server: `vaultId` 16 random bytes, `salt` / `prfSalt` / `authVerifier` / `authToken` 32 bytes, `wrappedDk` 60 bytes, credential ids 16–512 bytes.

**PRF.** Registration options ask for the `prf` extension (`prf: {}`). The PRF `eval` input is the app's business: it adds it to the options before calling WebAuthn. The server never sees PRF output.

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

All writes use `put(key, body, { onlyIf: { etagDoesNotMatch: '*' } })` ("only if new"); a `null` result means the key exists → `409`. The Worker has no code path that deletes or overwrites (a test scans the source for it).

| Key | Body |
|---|---|
| `meta/claimed` | `{ vaultId, claimedAt }`, written at the first passkey registration |
| `cred/<credentialId>` | `{ publicKey, transports, createdAt, prfSalt, wrappedDk }` |
| `recovery/<version, 6 digits>` | `{ salt, authVerifier, wrappedDk, createdAt }`; the highest version is current |
| `e/<13-digit server ms>-<16 hex random>` | a sealed blob |
| `used/<challenge>` | empty; marks a WebAuthn challenge as spent (not backed up) |

The first registration writes `meta/claimed` first (it is the lock: of two racing setups only one gets past it), then `recovery/000001`, then `cred/<id>`. All input is validated before the first write.

Passkey sign counters are not enforced (synced passkeys report 0, and the store is append-only).

## Sessions and requests

- Session = `bb_session` cookie, `HttpOnly; Secure; SameSite=Strict; Path=/api`, holding an HMAC-SHA-256-signed `{ kind: 'passkey' | 'recovery', exp }` (12 h). Secret: Worker secret `SESSION_SECRET`. Token format: `base64url(JSON) "." base64url(HMAC)`, verified with `crypto.subtle.verify` (constant time).
- WebAuthn challenges are stateless to issue: HMAC-signed, 5-minute challenge tokens (bound to their purpose, `register` or `login`) returned with the options and sent back with the response. They are single-use: verifying one writes `used/<challenge>` only-if-new, so a replay gets `401`. A registration token also records whether it was issued for the setup code, so `register/verify` doesn't need the code again.
- Every non-GET request must have `Origin` equal to the configured `ORIGIN` and `Content-Type: application/json` (or `application/octet-stream` for blob upload). Responses carry no CORS headers (same origin only).
- Limits: JSON bodies ≤ 32 KiB (`413` above), blob bodies ≤ 64 KiB + 29 bytes.
- Errors are always `{ "error": "<code>" }`, never internals: `400 bad_request`, `401 unauthorized`, `403 forbidden` (Origin), `404 not_found`, `405 method_not_allowed`, `409 conflict`, `413 payload_too_large`, `415 unsupported_media_type`, `500 server_error`.
- Every response carries the security headers (CSP, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP/CORP `same-origin`). API responses get them from the Worker plus `Cache-Control: no-store`; static files get the same set from `app/public/_headers`, because Worker code runs only for `/api/*`.
- RP ID = the app's hostname. `workers.dev` is on the Public Suffix List, so each instance is its own passkey scope.

## API

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/status` | none | `{ claimed }` |
| `POST /api/register/options` | session, **or** `{ setupCode }` while unclaimed | `{ options, challengeToken }`: WebAuthn creation options (PRF requested, resident key, user verification required, existing credentials excluded) |
| `POST /api/register/verify` | same (carried by the challenge token) | `{ response, challengeToken, prfSalt, wrappedDk, claim?: { vaultId, recovery: { salt, authVerifier, wrappedDk } } }` → `201 { credentialId }` + session cookie. `claim` is required on the first registration and refused (`409`) after it; an existing credential id is `409` |
| `POST /api/login/options` | none | `{ options, challengeToken }` (discoverable credentials, user verification required) |
| `POST /api/login/verify` | none | `{ response, challengeToken }` → session cookie + `{ vaultId, prfSalt, wrappedDk }` for that credential |
| `GET /api/recovery/params` | none | `{ vaultId, version, salt }` |
| `POST /api/recovery/login` | none | `{ authToken }` → session cookie + `{ wrappedDk, version }` (constant-time comparison of `SHA-256(authToken)`) |
| `POST /api/recovery/rotate` | session | `{ version, salt, authVerifier, wrappedDk }` → `201 { version }` (after printing a new kit). `version` must be current + 1, because the app needs it for the wrapping AAD before it sends; anything else is `409` |
| `POST /api/blobs` | session | body = sealed blob (`application/octet-stream`) → `201 { key }` |
| `GET /api/blobs?after=<key>&limit=<1–200, default 100>` | session | `{ blobs: [{ key, data (base64url) }], more }`, ascending by key; a page also stops at about 4 MiB of blobs. `after` may be any `e/<13 digits>` prefix |
| `POST /api/logout` | none | clears the cookie |

**Listing cursor.** Keys are stamped with the server clock when the upload starts, so an upload that finishes late can land just behind a key a device has already listed. Devices therefore list with `after` set to `e/<last key's ms − 600000>` (ten minutes of overlap) and skip keys they already hold, and run a full compare (no `after`) now and then.

The setup code is a 128-bit random value set as the Worker secret `SETUP_CODE` by the setup script. It works only while `meta/claimed` doesn't exist. After that, registering a new passkey requires a session (an unlocked device).

## Backups

A daily cron trigger lists `DATA` (`meta/`, `cred/`, `recovery/`, `e/`) and copies every object missing from the `BACKUP` bucket (only-if-new), at most 300 per run so one run stays inside the Worker's subrequest limit; any rest goes the next day. `BACKUP` has an R2 bucket lock rule (set by the owner with `wrangler`), so nothing in it can be deleted or overwritten for the retention period, even by the Worker.

## What the server can still do (honest limits)

It can withhold or delay blobs (each device keeps a full copy and notices missing data on the next full compare), learn timing and approximate volume of writes, and, as with any web app, a compromised deployment could serve malicious code. See `SECURITY.md`.
