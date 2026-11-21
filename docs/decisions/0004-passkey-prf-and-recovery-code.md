# 0004. Passkey PRF plus a recovery code, not a seed phrase

## Context
Keys must be strong, easy to use every day, and recoverable when every device is lost, without a password to remember. Bitcoin users know seed phrases, which also means they might confuse a recovery code for one, or store it like one.

## Decision
- Day to day: a passkey on each device. The WebAuthn PRF extension gives a secret that unwraps that passkey's ECDH private key. Setup stops if PRF is missing.
- Recovery: a 128-bit code with a check, written as 30 Crockford base32 characters, labeled "This is NOT a Bitcoin seed phrase". It wraps the data key and derives a separate sign-in token; the server stores only its hash. No slow KDF, because the entropy is already 128 bits.
- A printable emergency kit holds the code and a QR to a URL fragment the server never receives. (Later changed: the QR now opens only the app address and the code is typed, so it never lands in browser history.)

## Consequences
- No password to forget or phish; user verification is required for every unlock.
- A device without PRF can still restore with the recovery code.
- Anyone holding the kit can read the records, so the kit is treated like estate papers.
- Passkey providers that sync make a second device easy; ones that do not mean the code is the way in.
- Without a code and without a passkey there is no reset.
