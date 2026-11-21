# Changelog

## Unreleased

### Added

- **Retirement purchases**: a retirement wallet can now record purchases (date, BTC, cost with fees), edited and removed like any entry. Its page lists each purchase with its cost, worth now, gain or loss and time held, and the wallet shows its total cost, gain and average cost. A new entry kind, `retirement-buy`, kept apart from lots: it never reaches gains, Form 8949, tax estimates, the planners or loans (a property test checks this).
- **Balance notes check the purchases**: with purchases logged, a retirement wallet's balance is their total; its latest balance note is checked against the purchases up to that date and any difference is shown. Wallets with notes only look as before.
- **All your Bitcoin** at the top of Holdings: with a retirement wallet that holds coins, the hero is everything you have ("All your Bitcoin is worth", total BTC, and the unrealized gain), with a split card right under it: a thin bar and two rows, Taxable (counts for tax) and Retirement (kept apart from tax), each with its BTC, worth and gain. Taxable jumps to the taxable figures, which follow under a small "Taxable" label exactly as before; Retirement opens the retirement wallet (or the Held apart list when there are several). Without retirement coins Holdings looks as it did. The separate All your Bitcoin card and the "with retirement" line are gone.
- Hide amounts now also hides gain percentages and the cost-per-BTC hint while logging a purchase.
- **Import and export**: rows in the coins spreadsheet whose wallet is one of your retirement wallets become retirement purchases (leave tier and the loan columns empty on those rows; if the wallet is new, the preview asks whether it is a retirement account and never assumes it). The spreadsheet export includes them, and the backup file carries them with their history.
- The demo's retirement account has three made-up purchases.

### Changed

- **A calmer price line**: the red "Price may be out of date" is gone. Holdings shows a small refresh button beside the price (it spins while it loads). When the price shown is more than 5 minutes old, or is a kept price the server sent, its time follows it quietly ("· as of 3:12 PM", amber after 30 minutes); a current price shows no time. Sell shows the same time beside its price. A failed refresh keeps the price it had, and the app tries again after 15 s, 30 s and 60 s, then every minute (it used to back off up to 15 minutes).
- **The live price rides out a flaky source**: the Worker asks mempool once more after a failure, then Coinbase's public spot price (`COINBASE_URL`, `off` to skip it), and keeps the last good price for 6 hours. With all of them down it answers that price marked `stale` with the time it is from, and a 502 only when it has none. `/api/price` now also says when the price is from (`asOf`) and where (`source`). Historical prices still come from mempool alone.
- A purchase logged "now" uses the live price only while it is recent; a kept price from hours ago is no longer taken as the price now, and the note names Coinbase when the price came from there.
- **"Unrealized" instead of "on paper"**: Holdings' gain card is now "Unrealized gain", with a "?" that says what it means (what you would gain if you sold today; no tax is due until you sell), and wallet pages say "unrealized" too.

### Fixed

- **Choosing Idaho (or Single) now saves.** A first choice equal to the built-in default was dropped as "no change" while the screen said Saved; it is now recorded, and Saved only shows when something was written.
- Holdings shows the **average cost of all your Bitcoin** (taxable and retirement) under the total, when every cost is known.
- **Money in and out** says what each number counts, and when imported coins are not counted, says so and links to where to add money put in before.
- Reminder banners on Holdings no longer stretch across wide screens.
- The fingerprint on the Unlock button is a clearer, filled glyph (Material Design, Apache 2.0; see THIRD-PARTY-NOTICES.md).
- **Newest first**: a wallet's coins, a retirement wallet's purchases, a loan's purchases, a year's coins, income on Tax season, and the giving lists now show the latest at the top, like entries and payments already did. The coin picker for a sale keeps oldest first, the order coins are used.
- **Every date shows its year** (Oct 23, 2026), everywhere, and lines with a date wrap instead of cutting it off.
- **Icons where they help**: the desktop Hide amounts and Lock buttons, Records tiles, Settings sections, the entries search, and actions with a clear symbol (add, import, download, print, passkey, edit, remove, check now, forget this device). One style and size throughout; see docs/design.md.
- The desktop sidebar has icons, matching the phone's tabs, so Settings (the gear, at the bottom) is easy to spot.
- Paragraphs stop at about 70 characters, so text stays easy to read on wide screens.
- **First run, import only**: “You're all set” and the empty Holdings screen now offer “Import a spreadsheet or backup” next to adding a wallet, so you can start from a file without creating a wallet by hand. Empty-tier rows explain what to do.
- **Recovery code groups are numbered** on the printed kit, and the check step shows which block is group 4 (the fourth of six) and says to look where you saved it: your password manager or the kit.
- **Recovery code from your password manager**: where the browser supports it (Chrome, Edge, Android), “Fill in from my password manager” puts in the saved recovery code, so you don't type 30 characters. The field still works with ordinary autofill elsewhere.
- **Emergency kit**: stays on one letter page with many wallets (a print test checks six wallets, a long name and a code). The square code now only opens the app (the recovery code is typed), so using the kit no longer puts the code in browser history or asks for a new code and a new kit. The yearly test instructions moved off the paper; the app still reminds you. A note for the tax preparer appears when there are retirement wallets. Toasts no longer print.
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
