# Progress

Build log for Bitcoin Basis. Each step lists what "done" means and how it was verified.

| Step | What | Done when | Status |
|---|---|---|---|
| 1 | Repo, CI, calculation engine (no screens) | All worked examples and property tests pass | **Done** 2026-11-20 |
| 2 | Screens built to the approved designs, on synthetic data | Clicked through on phone and Mac; accessibility checks pass | **Done** |
| 3 | Encryption, passkey unlock, sync Worker, emergency kit, deploy | Same data on phone and Mac; a fresh device restores from the recovery code alone; the server holds only ciphertext | **Done** |
| 4 | Adversarial security review and `SELF-HOSTING.md` dry run | Findings fixed; a fresh AI agent stands up a working copy from the docs alone | In progress: three security reviews done, self-hosting dry run and UX audit under way |
| 5 | Import a real cleanup file (in the owner's own deployment) | Totals match the owner's records to the cent | Not started |

## Log

- 2026-11-20: Repo created. MIT license. Engine spec written (`docs/engine-spec.md`).
- 2026-11-20: CI live (typecheck, lint, 100% engine coverage, gitleaks, audit, CodeQL). Ledger and tax modules landed: 279 tests. Tax math cross-checked against an independent reference on 2,800 random cases (exact match). Planner (Sell/Borrow/giving) and app scaffold in progress.
- 2026-11-20: **Step 1 done.** Engine: 415 tests, 100% coverage, every worked example exact, fast-check properties (sats/cost balance, no negative wallets, saved sales never change, order independence, export/import round trip, dual-basis invariants). Two independent adversarial reviews: the first found 11 bug groups (e.g. edits orphaning saved sales, CSV formula injection, closed-year gaps), the second 3 more; all fixed with regression tests. 2025–2027 federal tables checked line by line against the IRS revenue procedures. Tax math matches an independent Decimal reference on 2,800 random cases.
- 2026-11-20: Step 2 screens built (Holdings, Log, wallets, What if, Tax season, Records) with Playwright + axe on phone and desktop sizes.
- 2026-11-20: **Step 2 done.** Screens clicked through on real devices: the owner set the app up on an Android phone and a Mac.
- 2026-11-20: **Step 3 done.** Live two-device test (phone and Mac, same data, restore from the recovery code alone) and the owner's real devices; three security review rounds with fixes and regression tests.
- 2026-11-20: Step 4 under way: three security reviews (fixes landed, including a memory-only demo, no financial data in plaintext `localStorage`, honest docs), a self-hosting dry run, and a UX audit with phone and desktop feature parity.
