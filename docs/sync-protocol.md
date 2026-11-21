# Keys, storage and sync protocol

The contract between the app (`app/src/vault/`) and the sync Worker (`worker/`). The server is a dumb, encrypted mailbox: it stores ciphertext and wrapped keys, verifies passkeys, and never sees a key or plaintext. Nothing can be overwritten or deleted through it.

Protocol version 2 (data-key epochs). Version 1 was never deployed with a real vault; nothing in v1 format is read.

## Data-key epochs (why the recovery code can be revoked)

Storage is append-only, and the backup bucket is locked, so an old recovery wrapping can never be erased. Rotating the recovery code therefore cannot just re-wrap the same data key: anyone holding the old code and a copy of the server (or a backup) would still open everything. Instead, data keys come in **epochs**:

- Epoch `n` has its own data key `DK_n` (AES-256-GCM, random). Epoch 1 starts at setup.
- **Epoch number = recovery version.** Each recovery-code rotation creates recovery version `n+1` and epoch `n+1` together; `recovery/<n>` wraps `DK_n`.
- New blobs are always sealed under the newest epoch; each blob names its epoch in its header. The server accepts uploads only for the current epoch.
- At rotation the rotating device delivers `DK_{n+1}` to **every registered passkey** (asymmetrically, to each passkey's ECDH public key), wraps it under the new recovery code, and stores the older keys `DK_1..DK_n` sealed under `DK_{n+1}` (the epoch's *history*), so every legitimate key holder still reads old blobs.
- The old code unwraps only `DK_n` (and through `history` of epoch `n`, `DK_1..DK_{n-1}`). Nothing it can reach contains `DK_{n+1}`: the new recovery wrapping needs the new code, each delivery needs a passkey's ECDH private key (which needs that passkey's PRF), and the history of `n+1` is sealed under `DK_{n+1}` itself.

**What rotation does not undo (honest limits).**

- Data written **before** a rotation stays readable to anyone who has the old code **and** a copy of the server or a backup. Append-only storage can't erase it. Rotation protects everything written afterwards.
- A device that is **offline** and still holds the old wrapping opens with the old code until it next comes online (it checks the recovery version before using a local wrapping whenever it can reach the server).
- Rotation does not remove passkeys. A passkey someone registered with the old code before the rotation (a recovery session may add a passkey) receives the new key like any other. There is no passkey removal yet, because nothing is ever deleted.

## Cryptography (WebCrypto only)

| Item | Algorithm | Notes |
|---|---|---|
| Data key `DK_e` | AES-256-GCM, random | One per epoch. Seals blobs, histories and bindings. Lives only in memory, non-extractable, while unlocked. |
| Credential key | ECDH P-256 | One key pair per passkey, made on the registering device. The public key is stored in clear (65 bytes, uncompressed). The private key (PKCS#8) is wrapped with `wrapKey`/`unwrapKey`, so its bytes never reach JavaScript. |
| Passkey KEK | HKDF-SHA-256 over the passkey PRF output | PRF evaluated on the constant `PRF_INPUT` (below). `salt` = `prfSalt` (32 random bytes stored with the credential), `info` = `bitcoin-basis/kek/passkey/v2`. Wraps only that passkey's ECDH private key: AES-GCM, 12-byte IV, AAD = `bitcoin-basis/credkey/v2|<vaultId>|<credentialId>`. `wrappedPrivateKey` = `iv || ciphertext+tag`. |
| Delivery | ECDH + HKDF-SHA-256 + AES-256-GCM | The sender makes a fresh ephemeral P-256 key pair. `shared = ECDH(ephemeral private, credential public)` (32 bytes); KEK = HKDF(`ikm` = shared, `salt` = SHA-256(ephemeral public ‖ credential public), `info` = `bitcoin-basis/kek/delivery/v2`). The raw DK is wrapped with AAD = `bitcoin-basis/wrap/v2|<vaultId>|epoch:<e>|passkey:<credentialId>`. The recipient computes the same KEK from its private key and the ephemeral public key. |
| Recovery KEK | HKDF-SHA-256 over the 128-bit recovery secret | `salt` = the version's 32-byte recovery salt, `info` = `bitcoin-basis/kek/recovery/v1`. Wraps `DK_v` with AAD = `bitcoin-basis/wrap/v2|<vaultId>|recovery:<v>`. |
| Recovery auth token | HKDF-SHA-256, same input and salt | `info` = `bitcoin-basis/auth/recovery/v1`, 32 bytes. The server stores only `SHA-256(token)`. |
| History of epoch `e` | AES-256-GCM under `DK_e` | Plaintext = raw `DK_1 ‖ … ‖ DK_{e-1}` (32 bytes each, in order). AAD = `bitcoin-basis/history/v2|<vaultId>|<e>`. `iv || ciphertext+tag` = `12 + 32·(e−1) + 16` bytes. None for epoch 1. |
| Credential binding | AES-256-GCM tag under `DK_e` | Encrypt an empty message with AAD = UTF-8 `bitcoin-basis/credbind/v2|<vaultId>|<credentialId>|<e>|` followed by the 65-byte public key, where `e` is the epoch the passkey was registered in. `binding` = `iv (12) || tag (16)`. Before a rotation delivers a new key, the device checks every passkey's binding, so a public key planted in storage by someone without a data key gets nothing. |
| Wrapped DK (any kind) | AES-256-GCM `encrypt` of the raw DK | `iv (12) || ciphertext+tag (48)` = 60 bytes. |
| Blob sealing | AES-256-GCM under `DK_e` | 12-byte random IV per blob, AAD = `bitcoin-basis/blob/v2|<vaultId>|<e>`. |

`<vaultId>` is the base64url vault id, `<credentialId>` the credential id in unpadded base64url (the WebAuthn `id`), and epochs/versions are plain decimal integers (`recovery:1`, not the 6-digit storage key).

**Encoding.** Every binary value in JSON is unpadded base64url. Exact sizes, checked by the server: `vaultId` 16 bytes; `salt` / `prfSalt` / `authVerifier` / `authToken` 32; `wrappedDk` 60; ECDH public keys 65 (first byte `0x04`); `binding` 28; `wrappedPrivateKey` 92–284; `history` `12 + 32·(e−1) + 16`; credential ids 16–512 bytes.

**PRF.** Registration options ask for the `prf` extension (`prf: {}`). The app adds the `eval` input itself before calling WebAuthn: always `eval.first = PRF_INPUT = SHA-256("bitcoin-basis/prf/v1")` (32 bytes, hex `a47c720225990a579313aa61a5339189f172aa3305c50e82600db23fc835ee16`), the same constant for every credential, on `create` and on every `get`. Because the input doesn't depend on which passkey answers, one prompt always returns both the assertion and the PRF output, including a discoverable prompt on a fresh device with a synced passkey. The per-credential `prfSalt` is applied afterwards, as the HKDF salt. The server never sees PRF output: the response JSON the app sends carries at most `prf.enabled`. PRF output and every raw key byte are wiped (`fill(0)`) as soon as they are used, on success and error paths alike. <!-- gitleaks:allow (public constant) -->

**PRF is required to set up and to add a passkey.** A passkey without PRF can't unwrap its ECDH key, so the app checks for PRF before claiming the server (or registering another passkey) and stops with an error if there is none. A device without PRF can still restore and unlock the vault with the recovery code.

No slow KDF is used for the recovery code: it carries 128 bits of entropy, so brute force is already infeasible.

### Recovery code

- 128 random bits, plus a 22-bit check (the first 22 bits of `SHA-256(secret)`), = 150 bits.
- Written as 30 characters in six groups of five, `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`, in Crockford base32: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32 symbols). The letters `I L O U` are not in the alphabet, so no two symbols look alike.
- Input is forgiving: case-insensitive, spaces and dashes ignored, `O` read as `0` and `I`/`L` read as `1`. A failed check means a typo, reported before any network call.
- Labeled everywhere: **This is NOT a Bitcoin seed phrase.**
- QR form: `https://<app>/#recover=<code>`. The code lives in the URL fragment, which browsers never send to the server. `takeRecoveryCodeFromUrl()` runs in `main.tsx` before the first render: it returns the code and synchronously removes the whole fragment from the address bar and the history entry (`history.replaceState`), even a malformed one.

### Padding

Plaintext blob = UTF-8 JSON `{"v":1,"entries":[…]}`, then one `0x80` byte, then zero bytes up to the smallest bucket that fits: **1 KiB, 4 KiB, 16 KiB, 64 KiB**. Larger batches are split across several blobs. The server rejects any blob whose size isn't exactly `bucket + 1 (version) + 4 (epoch) + 12 (IV) + 16 (tag)`.

Blob wire format (v2): `version (1 byte = 2) || epoch (4 bytes, big-endian uint32, ≥ 1) || iv (12) || ciphertext+tag`. The epoch is authenticated through the AAD.

## On the device

IndexedDB database `bitcoin-basis` (all values are ciphertext or public metadata):

- `vault`: one record, `format: 2`:
  - `vaultId`, `origin`, `cursor` (the highest server key held);
  - `credentials`: passkeys with PRF that unlock this device, each `{ id, prfSalt, wrappedPrivateKey, publicKey, delivery: { epoch, ephemeralPublicKey, wrappedDk } }` (its newest delivery);
  - `histories`: epoch → history, as on the server;
  - `epoch`: the newest epoch this device has heard of;
  - `recovery`: `{ version, salt, wrappedDk }` or `null`. `null` on a device first unlocked with a synced passkey, and after the code was rotated elsewhere (an outdated recovery wrapping is deleted the moment the device learns of a newer version);
  - `recoveryChanged`: the code was rotated elsewhere and this device dropped its old wrapping (the UI shows "your recovery code changed"; `status.recoveryCodeChanged`);
  - `logoutPending`: a lock happened offline; the logout is sent before anything else the next time the app is online.
- `blobs`: server key → sealed bytes (everything ever synced: the device keeps a full copy)
- `outbox`: local id → sealed bytes not yet uploaded

**Unlock with a passkey** = PRF → passkey KEK → ECDH private key → that passkey's newest delivery → `DK_e` → history of `e` → `DK_1..DK_{e-1}`; then decrypt all blobs into memory, each with the key of its epoch, and replay. Online, the delivery and history come with the login response; offline, from the record.
**Unlock with the recovery code** = online, first `GET /api/recovery/params`: if the server's version is newer than the local wrapping, the wrapping is deleted and the old code is refused (`wrong-recovery-code`). Otherwise recovery KEK → `DK_v` → history of `v`.
**Lock** = drop every key and all plaintext and end the server session (below). Auto-lock after N idle minutes (setting, default 5) and when the page is hidden for longer than that. A lock issued while an unlock is still in flight wins: the unlock fails with `locked` and leaves nothing unlocked (a lock generation counter, taken when the unlock is called).

**Every sync** first sends any queued logout, then reads `GET /api/recovery/params`. If the version is newer than what the device knows: it drops an outdated recovery wrapping (and sets `recoveryChanged`); and, if it is unlocked with a passkey (it holds that passkey's ECDH private key, non-extractable, in memory), it fetches the new delivery with `GET /api/keys`, adds the new key, and seals from then on under the new epoch. Outbox blobs from an older epoch are re-sealed under the current one before upload. A `409` on upload (the server moved on mid-sync) triggers one immediate re-check. A device unlocked with the old recovery code can't follow: its session is dead (below) and it shows "sign in" until the new code or a passkey is used.

## Server storage (R2, private bucket `DATA`)

All writes use `put(key, body, { onlyIf: { etagDoesNotMatch: '*' } })` ("only if new"); a `null` result means the key exists → `409`. The Worker has no code path that deletes or overwrites (a test scans the source for it).

| Key | Body |
|---|---|
| `meta/claimed` | `{ vaultId, claimedAt }`, written at the first passkey registration |
| `cred/<credentialId>` | `{ publicKey (WebAuthn COSE key), transports, createdAt, prfSalt, credentialKey: { publicKey, wrappedPrivateKey, epoch, binding } }` |
| `recovery/<version, 6 digits>` | `{ salt, authVerifier, wrappedDk, createdAt }`; the highest version is current, and is the current epoch |
| `epoch/<epoch, 6 digits>/cred/<credentialId>` | a delivery: `{ ephemeralPublicKey, wrappedDk, createdAt }` |
| `epoch/<epoch, 6 digits>/history` | the history of that epoch (base64url text); none for epoch 1 |
| `e/<13-digit server ms>-<16 hex random>` | a sealed blob |
| `used/<challenge>` | empty; marks a WebAuthn challenge as spent (not backed up; expires after 30 days) |
| `revoked/<session id>` | empty; marks a session as ended (not backed up; expires after 30 days) |
| `backup-progress/<inverted ms>-<uuid>` | `{ last }`: how far the backup copied `e/` (not backed up; expires after 30 days) |

**Write order.** The first registration validates everything (all shapes, the challenge token, the attestation, and that the attested credential id equals the validated `response.id`) before writing `meta/claimed` (the lock: of two racing setups only one gets past it), then `recovery/000001`, `epoch/000001/cred/<id>`, and `cred/<id>` last. A later registration writes the delivery, then `cred/<id>`. A rotation writes `epoch/<n+1>/history` first (the lock: of two racing rotations only one gets past it), then every delivery, then `recovery/<n+1>` last: the new epoch becomes current only once all its keys are in place.

**Expiry.** The Worker never deletes. `npm run setup` adds R2 lifecycle rules on `DATA` that expire `used/`, `revoked/` and `backup-progress/` after 30 days (`wrangler r2 bucket lifecycle add`); if that command fails it prints the dashboard steps (R2 → bucket → Settings → Object lifecycle rules). Without the rules these tiny objects only accumulate.

**Half-written states (manual recovery).** A write can fail between two objects (an R2 outage mid-request). Nothing in the protocol can repair that, because nothing can be deleted through it; the owner fixes it once by hand:

- `meta/claimed` exists but no `cred/` object: setup failed after the lock. Delete `meta/claimed`, `recovery/000001` and any `epoch/000001/…` objects in `DATA` (dashboard, or `npx wrangler r2 object delete bitcoin-basis-data/<key> --remote`), run `npm run setup -- --rotate-secrets` for a new setup code, and set up again. No data existed yet.
- `epoch/<n+1>/history` exists but `recovery/<n+1>` doesn't: a rotation failed midway; every later rotation gets `409`. Delete the `epoch/<n+1>/` objects and rotate again. The vault keeps working at epoch `n` meanwhile.

**Known race.** A passkey registered at the same moment as a rotation on another device may receive only the old epoch's key (registration checks the epoch before writing). It still unlocks and reads everything up to that epoch; rotating again delivers the newest key to it.

Passkey sign counters are not enforced (synced passkeys report 0, and the store is append-only).

## Sessions and requests

- Session = `__Secure-bb_session` cookie, `HttpOnly; Secure; SameSite=Strict; Path=/api`, holding an HMAC-SHA-256-signed `{ typ: 'session', sid, kind: 'passkey' | 'recovery', cid?, rv?, exp }`, **2 h**. `sid` is 16 random bytes; `cid` is the passkey that signed in; `rv` is the recovery version a recovery session matched. Secret: Worker secret `SESSION_SECRET`. Token format: `base64url(JSON) "." base64url(HMAC)`, verified with `crypto.subtle.verify` (constant time).
- **Revocation.** Every authenticated request checks that `revoked/<sid>` does not exist, and, for a recovery session, that `rv` is still the current version (so a rotation ends every old-code session at once). `POST /api/logout` writes `revoked/<sid>` for a validly signed session (a request without one writes nothing). The app logs out on every lock; offline, it queues the logout and sends it before any other request the next time it is online (and before signing in again, so it can't end the newer session).
- **What each session may do.** Passkey sessions: everything below. Recovery sessions: read and upload blobs, and register a passkey (with the recovery auth token as the step-up proof); nothing else (no step-up challenges, no credential list or keys, no rotation).
- **Step-up.** Registering a passkey with a session, and rotating the recovery code, need a fresh proof bound to that action: a WebAuthn assertion (user verification required) by a registered passkey over a challenge from `POST /api/stepup/options`, whose token is signed for exactly that purpose (`register` or `rotate`) and that session id, and expires after 5 minutes. For registration only, the current recovery auth token is accepted instead. (A device unlocked with the recovery code keeps that token in memory, never stored, until it locks, so adding a passkey there needs no extra prompt.)
- **Challenges** are stateless to issue: HMAC-signed, 5-minute tokens bound to their purpose (`register`, `login`, `stepup`). They are single-use: after the assertion or attestation (and everything else in the request) has verified, the Worker writes `used/<challenge>` only-if-new, so of two racing requests only one passes, and a replay gets `401`. A failed verification writes nothing (no anonymous writes). A registration token records whether it was issued for the setup code.
- **Rate limits.** Workers Rate Limiting binding `AUTH_LIMITER` (free plan): 30 requests per minute per client IP (`CF-Connecting-IP`), counted separately for registration (`register/options`, `register/verify`), passkey sign-in (`login/verify`) and recovery sign-in (`recovery/login`). Over the limit: `429`. If a deployment can't use the binding, a dashboard rate-limiting rule on `/api/login/verify`, `/api/recovery/login` and `/api/register/*` does the same job.
- **Deployment check.** The Worker refuses to serve the API (`500`) unless `ORIGIN` is a bare `https://` origin whose hostname equals `RP_ID` and `SESSION_SECRET` has 32+ characters. Plain `http://` is accepted only with `DEV_ALLOW_HTTP=1`, which lives in `worker/.dev.vars` for `wrangler dev` and nowhere else.
- Every non-GET request must have `Origin` equal to the configured `ORIGIN` and `Content-Type: application/json` (or `application/octet-stream` for blob upload). Responses carry no CORS headers (same origin only).
- Limits: JSON bodies ≤ 32 KiB (`413` above), blob bodies ≤ 64 KiB + 33 bytes.
- Errors are always `{ "error": "<code>" }`, never internals: `400 bad_request`, `401 unauthorized`, `403 forbidden` (Origin), `404 not_found`, `405 method_not_allowed`, `409 conflict`, `413 payload_too_large`, `415 unsupported_media_type`, `429 rate_limited`, `500 server_error`.
- Every response carries the security headers (CSP including `require-trusted-types-for 'script'`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP/CORP `same-origin`). API responses get them from the Worker plus `Cache-Control: no-store`; static files get the same set from `app/public/_headers`, because Worker code runs only for `/api/*`.
- RP ID = the app's hostname. `workers.dev` is on the Public Suffix List, so each instance is its own passkey scope.

## API

`delivery` below is `{ epoch, ephemeralPublicKey, wrappedDk }`; `credentialKey` is `{ publicKey, wrappedPrivateKey, epoch, binding }`; a passkey `stepUp` is `{ response, challengeToken }` (an assertion over a step-up challenge).

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/status` | none | `{ claimed }` |
| `POST /api/register/options` | session (any kind), **or** `{ setupCode }` while unclaimed | `{ options, challengeToken }`: WebAuthn creation options (PRF requested, resident key, user verification required, existing credentials excluded). Rate-limited |
| `POST /api/register/verify` | as above, plus `stepUp` after the claim | `{ response, challengeToken, prfSalt, credentialKey, delivery, claim?: { vaultId, recovery: { salt, authVerifier, wrappedDk } }, stepUp?: { response, challengeToken } \| { authToken } }` → `201 { credentialId }` + passkey session cookie. `claim` is required on the first registration and refused (`409`) after it. `credentialKey.epoch` and `delivery.epoch` must be the current epoch (1 at the claim), else `409`. An existing credential id is `409`. Missing or invalid step-up: `401`. Rate-limited |
| `POST /api/login/options` | none | `{ options, challengeToken }` (discoverable credentials, user verification required) |
| `POST /api/login/verify` | none | `{ response, challengeToken }` → passkey session cookie + `{ vaultId, credential: { prfSalt, …credentialKey }, keys: { epoch, delivery, history } }`: the current epoch, that passkey's newest delivery and that delivery's epoch history (`null` for epoch 1). Rate-limited |
| `POST /api/stepup/options` | passkey session | `{ purpose: 'register' \| 'rotate' }` → `{ options, challengeToken }` (token bound to the purpose and this session, 5 minutes) |
| `GET /api/credentials` | passkey session | `{ credentials: [{ id, publicKey, epoch, binding }] }`: every passkey's ECDH public key, for a rotation |
| `GET /api/keys?credential=<id>` | passkey session | `{ epoch, delivery \| null, history \| null }`: the current epoch and that passkey's newest delivery |
| `GET /api/recovery/params` | none | `{ vaultId, version, salt }`; `version` is also the current epoch |
| `POST /api/recovery/login` | none | `{ authToken }` → recovery session cookie + `{ wrappedDk, version, history }` (constant-time comparison of `SHA-256(authToken)` with the current version only). Rate-limited |
| `POST /api/recovery/rotate` | passkey session + `rotate` step-up | `{ version, salt, authVerifier, wrappedDk, history, deliveries: { <credentialId>: { ephemeralPublicKey, wrappedDk } }, stepUp }` → `201 { version }`. `version` must be current + 1 (`409` otherwise); `deliveries` must cover exactly the registered passkeys (`409` otherwise); `history` must have the size for `version` |
| `POST /api/blobs` | session | body = sealed blob (`application/octet-stream`) → `201 { key }`. A blob for any epoch but the current one is `409` |
| `GET /api/blobs?after=<key>&limit=<1–200, default 100>` | session | `{ blobs: [{ key, data (base64url) }], more }`, ascending by key; a page also stops at about 4 MiB of blobs. `after` may be any `e/<13 digits>` prefix |
| `POST /api/logout` | none | revokes the session in the cookie, if validly signed, and clears the cookie |

**Rotation, step by step (app).** Needs a passkey on the device: (1) a passkey session (a sign-in prompt first if the session came from the recovery code); (2) sync the epoch; (3) `rotate` step-up (one prompt); (4) `GET /api/credentials` and check every binding with the key of its epoch; (5) make `DK_{n+1}`, the history (`DK_1..DK_n` under it), a delivery per passkey and the new recovery code's wrapping; (6) `POST /api/recovery/rotate`; (7) store the new wrapping, history and the deliveries for this device's passkeys. Shows the new code once.

**Listing cursor.** Keys are stamped with the server clock when the upload starts, so an upload that finishes late can land just behind a key a device has already listed. Devices therefore list with `after` set to `e/<last key's ms − 600000>` (ten minutes of overlap) and skip keys they already hold, and run a full compare (no `after`) now and then (the app does one on the first sync after each unlock, after new keys arrive, and every six hours, and reports blobs the server no longer lists). A full compare re-downloads every blob, because listings carry the data; a keys-only listing is a possible future optimization.

The setup code is a 128-bit random value set as the Worker secret `SETUP_CODE` by the setup script. It works only while `meta/claimed` doesn't exist. After that, registering a new passkey requires a session and a step-up proof.

## Backups

A daily cron trigger copies objects missing from the `BACKUP` bucket (only-if-new), at most 300 per run so one run stays inside the Worker's subrequest limit; any rest goes the next day. The small prefixes (`meta/`, `cred/`, `recovery/`, `epoch/`) are compared in full. `e/` is not re-listed from the start: each run leaves an append-only marker `backup-progress/<9999999999999 − ms>-<uuid>` (so the newest lists first) holding the last `e/` key it reached, and the next run lists `e/` from ten minutes before it (at most five pages of 1000 keys per run), checking `BACKUP` only for keys inside that overlap. `used/`, `revoked/` and `backup-progress/` are never copied. The cron logs only a count. `BACKUP` has an R2 bucket lock rule (set by the owner with `wrangler`), so nothing in it can be deleted or overwritten for the retention period, even by the Worker.

## What the server can still do (honest limits)

It can withhold or delay blobs (each device keeps a full copy and notices missing data on the next full compare), learn timing and approximate volume of writes, refuse a rotation, and, as with any web app, a compromised deployment could serve malicious code. Someone who can write to storage directly (not through the Worker) could add a passkey record; without a data key its binding fails and rotations refuse to deliver to it, but it would be listed. See also "What rotation does not undo" above, and `SECURITY.md`.
