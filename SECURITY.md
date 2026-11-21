# Security

Bitcoin Basis holds records, not coins: purchase dates, costs and notes. It never holds keys that move Bitcoin. Those records are still private financial data, so the design assumes the server and the network are not trusted.

The full protocol is in [docs/sync-protocol.md](docs/sync-protocol.md). This page is the threat model.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: the repository's **Security** tab, then **Report a vulnerability**. Please do not open a public issue or post details. Include steps to reproduce and the version or commit. Do not include real financial data; the project uses synthetic data only.

This is a personal open-source project. Reports are read and answered on a best-effort basis.

## What is protected

- Entries (wallets, purchases, sales, notes, settings) and the keys that seal them.
- Not hidden: that a vault exists, when blobs were written, and roughly how many (see "Compromised server").

## Threat model

### Lost or stolen phone

- The app is locked until a passkey is used (fingerprint, face or screen lock; user verification is required). Keys exist only in memory while unlocked and are dropped on lock.
- Auto-lock after a number of idle minutes (setting, default 5) and when the page has been hidden that long. Locking also ends the server session.
- Data at rest on the device (IndexedDB) is ciphertext.
- If a phone is lost: make a new recovery code from another device, and remove the passkey from the lost phone's OS or password manager. The app cannot remove passkeys yet (see limits below).
- Limit: someone who gets past the phone's own lock while the app is unlocked sees the records. That is inherent.

### Compromised or leaked server

The server (Cloudflare Worker and R2) holds only:

- sealed blobs (AES-256-GCM), padded to 1, 4, 16 or 64 KiB so sizes leak little,
- passkey public keys, each passkey's wrapped private key, wrapped data keys, and a hash of the recovery auth token,
- tiny single-use markers.

It never has a key or plaintext. A copy of the whole bucket, or of the daily backup, shows ciphertext.

What a malicious or compromised server can still do:

- **Withhold or delay** blobs, or refuse a rotation. Each device keeps a full copy and notices missing data on the next full compare.
- **Learn metadata:** when you write and about how much.
- **Serve malicious code** (the next section is the real risk here).
- Someone with direct write access to storage could add a passkey record. Without the current data key its binding fails, rotations refuse to deliver to it, and it shows in the list. See [docs/sync-protocol.md](docs/sync-protocol.md).

The Worker has no code path to delete or overwrite (a test scans the source). The backup bucket has a lock rule (365 days by default), so even a hijacked Worker cannot erase it.

### Hostile network

- HTTPS only. HSTS (one year), `upgrade-insecure-requests`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive Permissions-Policy, COOP and CORP `same-origin`.
- Strict Content-Security-Policy: scripts, styles, fonts and images from your own origin only; the only outside connection allowed is `https://mempool.space` (price). No inline scripts or styles, `frame-ancestors 'none'`.
- Trusted Types are required (`require-trusted-types-for 'script'`, one policy, for the service worker).
- Sessions are an HMAC-signed cookie (`HttpOnly`, `Secure`, `SameSite=Strict`), 2 hours, revocable, ended on lock. Challenges are single-use and expire in 5 minutes. State-changing requests must carry the exact `Origin` header. Sign-in and registration are rate limited.
- The recovery code in a QR link lives in the URL fragment, which browsers never send, and the app removes it from the address bar on load.

### Malicious dependency

- Few dependencies: the engine has none; the app ships React, React Router, a QR generator and font files; the Worker uses one library (`@simplewebauthn/server`).
- Exact versions only (`save-exact`), a committed lockfile, and `tools/check-lockfile.mjs` in CI (registry URLs, integrity hashes). CI installs with `--ignore-scripts`.
- GitHub Actions are pinned by commit SHA. Dependabot skips major versions, which are adopted deliberately.
- `npm audit` (high for production dependencies, critical for all), CodeQL on every push and weekly, gitleaks on every push.
- Subresource Integrity (sha384) on every script and stylesheet in `index.html`. Lazy-loaded chunks cannot carry SRI; the CSP and `verify-deployment` cover them.

### The web-app trust problem

Stated plainly: **whoever controls the code your browser is served can read your records while the app is unlocked.** End-to-end encryption does not change that for any web app. If someone took over your Cloudflare account or your GitHub repository and shipped a modified app, it could steal keys the next time you unlock.

Mitigations, not a cure:

- Deploys happen only from GitHub Actions, only after CI passes for that exact commit, only for commits on `main`. A protected `production` environment holds the Cloudflare token.
- Every release publishes `dist-hashes.txt` (a hash of every file). Anyone can rebuild a tag and compare, and check a live site with `node tools/verify-deployment.mjs <url> --all`. The deploy job runs the same check on itself. See [docs/deploy.md](docs/deploy.md).
- The Cloudflare token is minimal (Workers Scripts, R2, account read; one account) with an expiry.
- Protect your GitHub and Cloudflare accounts with passkeys or hardware keys. That is where this risk lives.
- Verification is something you do (or schedule); the app cannot check itself.

### Shoulder surfing

"Hide amounts" masks balances, costs, gains and income. It is the user's choice and off by default. Holding a masked value, or the eye button, shows everything until release. The BTC price is public and is not masked.

### The owner's death or incapacity

The emergency kit is a printable page with the recovery code, a QR, steps, and a list of wallet names and types. It opens the records, not the Bitcoin; no keys or passwords are printed. Keep it with estate papers. The app reminds you to test it (30 days after first use, then yearly). Anyone holding the kit can read your records.

### Lost recovery code

Passkeys keep working. Make a new recovery code (Records, Security) and print a new kit. If you lose both the code and every passkey, the records cannot be opened; there is no reset, by design.

## Recovery-code rotation: what it does and does not do

Rotation starts a new data-key epoch. The new key is delivered to every registered passkey and wrapped under the new code. The old code can no longer sign in, its sessions end, and it cannot read anything written afterwards.

It does not undo the past:

- Data written **before** the rotation stays readable to someone who has the old code **and** a copy of the server or a backup. Storage is append-only, so it cannot be erased.
- An offline device that still holds the old wrapping accepts the old code until it next reaches the server.
- Rotation does not remove passkeys (nothing is ever deleted). A passkey added while the leaked code was current gets the new key too. Letting you choose which passkeys receive it is planned.
- Someone holding an old key and direct write access to storage can plant a blob under the old key. Devices refuse it when it is stamped more than ten minutes after they first heard of the newer epoch. A writer who back-dates it is not caught.

So if a recovery code leaks, rotate, and treat what was written before as exposed to whoever also gets a server or backup copy. Full list: [docs/sync-protocol.md](docs/sync-protocol.md).

## Cryptography summary

| Purpose | Algorithm |
|---|---|
| Sealing entries | AES-256-GCM, random 12-byte IV per blob, data key per epoch, AAD binds vault and epoch |
| Padding | `0x80` then zeros to 1, 4, 16 or 64 KiB |
| Unlock with a passkey | WebAuthn PRF output, then HKDF-SHA-256 to a key that unwraps that passkey's ECDH P-256 private key |
| Delivering data keys to passkeys | Ephemeral ECDH P-256, HKDF-SHA-256, AES-256-GCM |
| Recovery code | 128 random bits plus a 22-bit check, 30 characters of Crockford base32. HKDF-SHA-256 to a wrapping key and, separately, an auth token; the server stores only the token's SHA-256 |
| Session and challenge tokens | HMAC-SHA-256, constant-time verification |
| Key handling | WebCrypto only; keys non-extractable where possible; key material zeroed after use; no hand-written cryptography |

No slow password KDF is used: the recovery code has 128 bits of entropy. The code is labeled everywhere as **not** a Bitcoin seed phrase.

## Out of scope

- A compromised device or browser (malware, malicious extensions, a keylogger).
- Someone who has your unlocked, unattended device.
- Compromise of your Cloudflare or GitHub account (see the trust problem; mitigations only).
- Hiding that a vault exists, or its write timing and rough volume.
- Denial of service (the server can always be made unavailable; your device copy keeps working).
- The accuracy of tax figures. That is a correctness matter, not a security one; see "Not tax advice" in the README.

## Review status

The security design has had two adversarial review rounds with fixes and regression tests ([how this was built with AI](docs/how-this-was-built-with-ai.md)). It has not had a paid outside audit.
