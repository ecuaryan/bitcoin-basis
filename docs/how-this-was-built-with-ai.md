# How this was built with AI

Bitcoin Basis was built by AI agents working under a human owner. This page says what was delegated, how nothing was taken on trust, which mistakes the AI made that were caught, and what only a person could do. Commit hashes are from this repository's history (`git show <hash>`).

## Who did what

- **One orchestrator session** (Claude Code, Opus) planned the work, split it into steps, checked every result and decided what to accept. It did not take an agent's word that something worked.
- **Subagents** wrote the code, two to four at a time, each with a narrow brief and a rules file: synthetic data only, integer money, no commits, only its own files.
- **Model per task.** Opus for the engine's tax logic, key handling, the sync protocol and every security or correctness review. Sonnet for scaffolding, UI built to approved designs, CI and docs.
- **Inputs.** A written plan with worked examples, verified with an independent Decimal script before any code existed (they became the 23 worked examples in the [engine spec](engine-spec.md)); approved mockups made in Claude Design; synthetic data throughout.

## How it was verified

- The orchestrator re-ran the tests itself and compared screenshots with the mockups.
- **Differential test:** the tax module against an independent reference on 2,800 random cases. Where the reference is exact, they matched exactly; the remaining differences were simplifications in the reference (for example NIIT on short-term gains), where the engine was right.
- **Property tests** (fast-check) for conservation of sats and cost, saved sales never changing, order independence, and export/import round trips. 100% engine coverage is a CI gate.
- **Adversarial reviewers:** separate agents were told to break each step. Engine: two rounds. Security design: four rounds. UX: one full first-time-user audit.
- CI on every push: typecheck, lint, tests, Playwright with axe on phone and desktop, lockfile check, `npm audit`, CodeQL, gitleaks.
- Memory across interruptions: usage limits stopped the build several times; git history and [PROGRESS.md](PROGRESS.md) were enough to resume.

## Real mistakes the AI made, and what caught them

1. **Editing a purchase changed its lot id**, silently dropping later saved sales from the tax year. Engine review, severity high. Fix: a lot's id is the first version of its entry. Tests: [`versions.test.ts`](../engine/test/versions.test.ts), [`properties-edits.test.ts`](../engine/test/properties-edits.test.ts). Commit `123a4eb`.
2. **An entry id like `M:0` could overwrite a moved lot** and delete its basis. High. Fix: a restricted id charset and a duplicate-lot guard. Tests: [`validate.test.ts`](../engine/test/validate.test.ts), [`closed-years.test.ts`](../engine/test/closed-years.test.ts). `123a4eb`.
3. **CSV exports allowed spreadsheet formula injection** (`=`, `+`, `-`, `@`). Fix: neutralize text cells, and round-trip tests, including leading apostrophes (found only in the second review). [`io-safety.test.ts`](../engine/test/io-safety.test.ts). `123a4eb`, `79bdcee`.
4. **Closed tax years could still change** through backdated freezes, wallet edits, conflict re-resolution, and opening lots swept into a close-out. Two review rounds. [`closed-years.test.ts`](../engine/test/closed-years.test.ts). `123a4eb`, `79bdcee`.
5. **Gifts received below the giver's cost ignored the dual-basis rule** (Treas. Reg. 1.1015-1(a)). Fix: the three-region rule. [`edge-cases.test.ts`](../engine/test/edge-cases.test.ts), [`tax-dates.test.ts`](../engine/test/tax-dates.test.ts).
6. **Rotating the recovery code did not revoke the old one** for someone holding the old code plus a server copy. High. Fix: data-key epochs delivered per passkey ([ADR 0005](decisions/0005-data-key-epochs.md)). The re-review then found the old code plus server write access could still plant a passkey binding (high), fixed with per-epoch re-binding. The same review found sessions that could not be revoked, rotation without step-up, anonymous R2 write amplification, half-claimed instances that bricked, and a lock-during-unlock race. Tests: [`security.test.ts`](../app/src/vault/security.test.ts), [`api.test.ts`](../worker/test/api.test.ts). `e67d5b5`, `472f0a6`.
7. **Trusted Types silently broke offline mode**: the service worker could not register under the strict CSP in Chromium, and an `await` ordering bug meant it never registered anyway. Found by a reviewer and by the orchestrator. Test: [`service-worker.spec.ts`](../app/e2e/service-worker.spec.ts). `472f0a6`.
8. **A UI agent hand-edited the npm lockfile to satisfy a check.** The orchestrator reverted it to npm's own output and fixed the check instead ([`check-lockfile.mjs`](../tools/check-lockfile.mjs)).
9. **A private figure nearly leaked.** One worked example in the private plan used a real number. It was caught before the repository existed and replaced with a synthetic one. A private-data scanner (built at run time from the owner's private files, never committed) plus gitleaks gate every push.
10. **A UX audit found 65 issues (8 at the top priority) after all tests passed**: Hide amounts leaked the average cost, an empty state pointed to a demo that real users do not have, and the coin picker showed 25 disabled rows. The owner himself caught a lone wrapped word and a cut-off favicon. `49a17d8`, `d461b5d`, `52534f0`.

Earlier, in the private history cleanup that motivated the app, audits also caught an exchange export with a blank dollar column and a Lightning payment paired with the wrong deposit. No figures are published.

## What the human did

- Owner decisions: Bitcoin only, free tiers, passkey plus a recovery code that is not a seed phrase, amounts shown by default ([ADR 0007](decisions/0007-amounts-shown-by-default.md), `631d4ef`), tax-reading choices for the engine, and approval of every design.
- Real-device checks: setup, unlock, second device and the emergency kit on actual phones and computers. Automated tests use virtual authenticators; they do not replace this.
- Caught what agents and tests missed (item 10).
- Controls the accounts, the Cloudflare token and the deploy; ran the live two-device test against a real deployment ([`two-devices.spec.ts`](../app/e2e-live/two-devices.spec.ts), `f5be3bd`).

## What this does not prove

Tests, reviews and a reference script lower the odds of error; they are not an audit. The security design has had four adversarial review rounds and no outside audit, and the tax figures are not tax advice.
