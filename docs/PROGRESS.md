# Progress

Build log for Bitcoin Basis. Each step lists what "done" means and how it was verified.

| Step | What | Done when | Status |
|---|---|---|---|
| 1 | Repo, CI, calculation engine (no screens) | All worked examples and property tests pass | In progress |
| 2 | Screens built to the approved designs, on synthetic data | Clicked through on phone and Mac; accessibility checks pass | Not started |
| 3 | Encryption, passkey unlock, sync Worker, emergency kit, deploy | Same data on phone and Mac; a fresh device restores from the recovery code alone; the server holds only ciphertext | Not started |
| 4 | Adversarial security review and `SELF-HOSTING.md` dry run | Findings fixed; a fresh AI agent stands up a working copy from the docs alone | Not started |
| 5 | Import a real cleanup file (in the owner's own deployment) | Totals match the owner's records to the cent | Not started |

## Log

- 2026-11-20: Repo created. MIT license. Engine spec written (`docs/engine-spec.md`).
- 2026-11-20: CI live (typecheck, lint, 100% engine coverage, gitleaks, audit, CodeQL). Ledger and tax modules landed: 279 tests. Tax math cross-checked against an independent reference on 2,800 random cases (exact match). Planner (Sell/Borrow/giving) and app scaffold in progress.
