# Changelog

## Unreleased

### Added

- **Retirement purchases**: a retirement wallet can now record purchases (date, BTC, cost with fees), edited and removed like any entry. Its page lists each purchase with its cost, worth now, gain or loss and time held, and the wallet shows its total cost, gain and average cost. A new entry kind, `retirement-buy`, kept apart from lots: it never reaches gains, Form 8949, tax estimates, the planners or loans (a property test checks this).
- **Balance notes check the purchases**: with purchases logged, a retirement wallet's balance is their total; its latest balance note is checked against the purchases up to that date and any difference is shown. Wallets with notes only look as before.
- **All your Bitcoin** on Holdings: Taxable, Retirement and All Bitcoin side by side (BTC, worth, gain where the cost is known), reached from a quiet "with retirement" line under the hero. The taxable figures are unchanged.
- Hide amounts now also hides gain percentages and the cost-per-BTC hint while logging a purchase.
- **Import and export**: rows in the coins spreadsheet whose wallet is one of your retirement wallets become retirement purchases (add the wallet first; leave tier and the loan columns empty on those rows). The spreadsheet export includes them, and the backup file carries them with their history.
- The demo's retirement account has three made-up purchases.

### Fixed

- **Emergency kit**: stays on one letter page with many wallets (a print test checks six wallets, a long name and a code). The yearly test now says to stop at “Records restored” (no passkey, no new code), and the steps match what scanning the square code actually does. A note for the tax preparer appears when there are retirement wallets. Toasts no longer print.
- **Adding a device whose passkey already syncs there**: "Add a passkey on this device" no longer fails when the passkey from your other device is already on this one (Google Password Manager, iCloud Keychain, a password manager). The app uses that passkey instead of making a second one, after checking that it opens these records. If it can't unlock records on this device, the app says so.
- **Make a new recovery code without a passkey on the device**: the sheet now says a passkey is needed first, offers to add one there, then makes the code. Errors show inside the sheet instead of behind it.
- After opening your records from the kit's QR code, the offer to make a new recovery code waits until this device has a passkey.
- "I already use Bitcoin Basis" leads with "Use my passkey"; when no passkey comes up it points to the recovery code field. Passkey errors now say what went wrong.

## v1.0.0

First release. A self-hosted, end-to-end encrypted Bitcoin cost-basis app on a free Cloudflare account.

### Features

- **Engine**: exact integer math (sats and cents, no floats), lot tracking per wallet, cost basis, and a written spec (`docs/engine-spec.md`) the tests are built from.
- **Encrypted sync**: records are sealed on your devices; the Worker and the R2 bucket only ever hold fixed-size ciphertext. Append-only, conflict-free sync between devices, with a daily backup to a second bucket.
- **Passkeys and recovery code**: sign in with a passkey on each device; a 30-character recovery code restores everything on a fresh device and can be rotated (the old code stops working).
- **Loans**: track money borrowed to buy Bitcoin, link purchases, log payments (interest and principal), check against a statement, rate changes, and see break-even with interest paid.
- **Tax season**: realized gains and losses, holding periods and year-end figures.
- **Giving**: gifts and donations with their cost basis and holding period.
- **Import and export**: CSV import with a preview and a full export.
- **Emergency kit**: a one-page printable sheet so someone you trust can get in if you cannot.
- **PWA**: installs on a phone or desktop, works offline, and unlocks with Face ID, Touch ID, fingerprint or screen lock.
- **Open verification**: reproducible builds with Subresource Integrity, `dist-hashes.txt` attached to each release, `tools/verify-deployment.mjs`, and a daily check that the live app still matches its source.

### How it was verified

- 1,081 unit and integration tests in 88 files (`npm run check`: typecheck, lint, tests with coverage) and 286 Playwright end-to-end tests (desktop and phone).
- Mutation testing of the engine: 93% mutation score (Stryker).
- Four security reviews and three accuracy reviews of the engine against the spec, with every finding fixed or recorded.
- A usability test with first-time users, and the fixes that came out of it.
- Live tests against a throwaway Cloudflare deployment: two devices syncing (including a loan), recovery and rotation, an opaque-server check of the bucket, and a backup drill (backup, wipe, restore, sign in again).
