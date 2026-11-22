# Guide for AI agents

You are changing Bitcoin Basis, a local-first, end-to-end encrypted Bitcoin cost-basis app. Read this first, then the spec for the area you touch. Keep changes small and tested.

## Layout

| Path | What |
|---|---|
| `engine/` | Pure TypeScript: entries to lots, gains, tax, planner, CSV. No I/O, no runtime dependencies. 100% coverage gate |
| `app/` | React PWA. `src/vault/` is crypto, passkeys, sync client. `src/screens/`, `src/ui/`, `src/data/`, `src/lib/`. `e2e/` Playwright, `e2e-live/` live two-device test |
| `worker/` | Cloudflare Worker: static assets plus `/api`, R2 access, backup cron |
| `tools/` | `setup.mjs`, `sri.mjs`, `hash-build.mjs`, `verify-deployment.mjs`, `smoke-test.mjs`, `check-origin.mjs`, `check-lockfile.mjs` |
| `docs/` | Specs, decisions, progress |
| `.github/workflows/` | `ci.yml`, `codeql.yml`, `deploy.yml` |

## Commands

```sh
npm ci --ignore-scripts
npm run dev                  # app dev server (demo works without a server)
npm run typecheck && npm run lint
npm test                     # vitest, all packages
npm run check                # typecheck + lint + tests with the engine coverage gate (what CI runs)
npm run build                # app build + SRI
npm run build:fake -w @bitcoin-basis/app          # test-only build with a fake server and authenticator
npm run e2e:ci -w @bitcoin-basis/app              # Playwright without visual snapshots (what CI runs)
npm run e2e -w @bitcoin-basis/app -- --grep @visual   # visual baselines (macOS only)
npm run e2e:visual:update -w @bitcoin-basis/app   # after an intended design change
```

Do not run `npm install` to change dependencies unless asked. Versions are exact; the lockfile must be npm's own output (`node tools/check-lockfile.mjs`). Never hand-edit `package-lock.json`.

## Invariants that must never break

1. **Integer money.** BTC is whole sats, dollars are whole cents. No floats for money anywhere. Proportional math goes through `mulDivRoundHalfUp` (BigInt). No `Math.random`; use `crypto.getRandomValues`.
2. **Saved picks.** Every disposal stores exactly which lots and how many sats it used. Replay never re-picks. Adding an older entry must not change a past sale. Lot ids are stable across edits (the root of the entry's version chain).
3. **Entries are append-only.** An edit or delete is a new entry with `replaces`. Closed years reject changes unless unlocked.
4. **The server is append-only.** The Worker writes only-if-new and has no delete or overwrite path (a test scans the source). Do not add one.
5. **No plaintext at rest, no keys on the server.** Entries are sealed on the device. Plaintext and keys live in memory only while unlocked and are wiped on lock. Do not log, store or send amounts, notes or keys. Do not weaken the sizes, AAD or epoch rules in [docs/sync-protocol.md](docs/sync-protocol.md).
6. **CSP and Trusted Types stay strict.** `script-src 'self'`, `style-src 'self'`, `require-trusted-types-for 'script'`. No inline scripts or `style=` attributes in markup strings, no remote fonts or images, no new origins in `connect-src`. `app/public/_headers` and `worker/src/headers.ts` must match (a test checks).
7. **No fake code in production.** The fake server and authenticator exist only in `--mode fake`; `app/e2e/prod-bundle.spec.ts` checks the production bundle.
8. **Synthetic data only.** Never add real balances, dates, wallet names, keys or personal data to the repo, tests, screenshots or docs. Use the numbers in [docs/engine-spec.md](docs/engine-spec.md) and `app/src/demo/`. Gitleaks runs on every push.
9. **Money shown through `<Money>` and `<Amount>`** so Hide amounts works. Whole-dollar display rounds toward zero (under $1 keeps its cents). Coins are valued lot by lot (`valueOfPieces`), so parts add up to totals.
10. **No tax claims without a source.** Tax tables carry their source and tests. Label estimates as estimates.

## How to verify

Nothing is done because it compiles. Before you report:

1. `npm run check` passes. Engine changes keep 100% coverage and add a test that fails without the fix.
2. `npm run build`, then `npm run build:fake -w @bitcoin-basis/app`, then `npm run e2e:ci -w @bitcoin-basis/app`. This includes axe checks (zero violations) and the production-bundle check.
3. UI changes: check phone (390 px) and desktop (1440 px). On macOS run the `@visual` tests. Baselines are `*-darwin.png`; CI skips them. If you change a screen on purpose, update the baselines, look at the PNGs, and say so.
4. Protocol, auth or deploy changes: also run the live two-device test against a real deployment of your own (see the header of `app/e2e-live/two-devices.spec.ts` for the `BB_LIVE_*` variables). Not run in CI.
5. Tell the truth about what you could not run.

## Yearly tax-table update

A reminder issue opens every January 2 (`.github/workflows/tax-tables-reminder.yml`) with the checklist. In short:

- **Where:** federal tables in `engine/src/tax/tables/federal-<year>.ts` (register in `tables/index.ts`); state rates in `engine/src/tax/tables/state.ts` (each rate carries its `year` and `source`).
- **Sources:** the IRS Rev. Proc. with the year's inflation adjustments (rate brackets, standard deduction, 0%/15% capital gain thresholds, gift annual exclusion), then each flat state's statute, tax agency page or the Tax Foundation table. No figure without a source link.
- **Tests:** add the new year to the engine tax tests (a worked example per filing status, and the table lookup), keep engine coverage at 100%. Until it lands, the app shows "Using <year> tax rates; <year+1> rates aren't in the app yet." on Sell, Borrow and Tax season.
- **Docs:** update the tax section of `docs/engine-spec.md` and the years listed in `README.md`.

## Where the specs live

- Tax and ledger rules, worked examples, decisions ledger: [docs/engine-spec.md](docs/engine-spec.md)
- Keys, storage, sessions, API, backups: [docs/sync-protocol.md](docs/sync-protocol.md)
- Deploy, tokens, verification, rollback: [docs/deploy.md](docs/deploy.md), [SELF-HOSTING.md](SELF-HOSTING.md)
- Design tokens, components, visual tests: [docs/design.md](docs/design.md)
- Why things are the way they are: [docs/decisions/](docs/decisions/)
- Threat model: [SECURITY.md](SECURITY.md)
- Worker bindings: [worker/README.md](worker/README.md)

Change the spec in the same change as the behavior. Do not commit unless asked.
