# Deploying Bitcoin Basis

Self-hosted on a free Cloudflare account: one Worker (`bitcoin-basis`) serves the app and the sync API, two private R2 buckets hold the encrypted data. No custom domain: the app lives at `https://bitcoin-basis.<your-subdomain>.workers.dev`. Cost: $0.

## One-time setup (on your computer)

```sh
npm ci --ignore-scripts
npx wrangler login                    # sign in to Cloudflare in the browser
node tools/setup.mjs --dry-run        # print every command, change nothing
node tools/setup.mjs                  # do it
```

`setup.mjs` is safe to run again. It:

1. checks you are signed in and picks the account,
2. finds your `workers.dev` subdomain (or pass `--subdomain <name>`) to work out `ORIGIN` and `RP_ID`,
3. creates the buckets `bitcoin-basis-data` and `bitcoin-basis-backup` if missing,
4. adds a bucket lock rule to the backup bucket (default 365 days; `--retention-days`). If your wrangler cannot, it prints the dashboard steps,
5. generates `SESSION_SECRET` and `SETUP_CODE` with `crypto.randomBytes` and sets them through `wrangler secret put` on stdin. Nothing secret goes on a command line or to disk. Existing secrets are kept unless you pass `--rotate-secrets` (which signs everyone out),
6. prints the GitHub settings below and a final check.

The **setup code** is printed once. Type it exactly as shown in the app's first-run screen to create the first passkey. After the vault is claimed it does nothing. Lost it before then: run `node tools/setup.mjs --rotate-secrets`.

## GitHub settings (Settings -> Secrets and variables -> Actions)

Create an environment named `production` (Settings -> Environments). Optionally restrict it to the `main` branch and `v*` tags, and add yourself as a required reviewer if you want to approve each deploy.

| Where | Name | Value |
|---|---|---|
| Variable | `CF_ACCOUNT_ID` | your Cloudflare account id (printed by setup) |
| Variable | `APP_ORIGIN` | `https://bitcoin-basis.<subdomain>.workers.dev` (printed by setup) |
| Secret (environment `production` is best) | `CLOUDFLARE_API_TOKEN` | the token below |

**Token** (Cloudflare dashboard -> My Profile -> API Tokens -> Create Token -> start from the "Edit Cloudflare Workers" template, then trim it). Exactly these five permissions, scoped to your one account:

- Account -> Workers Scripts -> Edit
- Account -> Workers R2 Storage -> Edit (needed to attach the buckets)
- Account -> Account Settings -> Read
- User -> User Details -> Read
- User -> Memberships -> Read

No zone permissions are needed (no custom domain). Set an expiry you can live with, and rotate it by replacing the secret.

Without `CLOUDFLARE_API_TOKEN` the Deploy workflow succeeds with a notice and does nothing, so forks stay green.

## How a deploy works

`.github/workflows/deploy.yml` has three jobs, so the Cloudflare token never shares a job with code from npm packages:

1. **plan** (no npm, no secrets): runs only after the **CI** workflow succeeded for that exact commit on `main` (or a `v*` tag, which must point at the tested commit, on a commit that is on `main`). It picks that commit, not "latest main"; if a newer commit has landed, the older run steps aside. It checks `APP_ORIGIN` (`tools/check-origin.mjs`): `https://<name>.workers.dev` or an https custom origin, no path or port, never localhost.
2. **build** (no secrets): `npm ci --ignore-scripts`, `npm run build` (builds the app, then `tools/sri.mjs` adds Subresource Integrity), `tools/hash-build.mjs` writes `dist-hashes.txt`. Uploads the build.
3. **deploy** (environment `production`): installs only the lockfile-pinned wrangler (`--ignore-scripts`), downloads and checks the build, and gives `CLOUDFLARE_API_TOKEN` to the wrangler step alone. `wrangler deploy` sets `--var ORIGIN` and `--var RP_ID` from `APP_ORIGIN` (and `MEMPOOL_URL` if you set that variable; the default is mempool.space). Secrets are not touched. Then a smoke test (`tools/smoke-test.mjs`: `/api/status` answers and the security headers are on the app and the API) and `tools/verify-deployment.mjs --all` (live files and headers against the fresh `dist-hashes.txt`).
4. For `v*` tags, `dist-hashes.txt` is attached to a GitHub Release.

Only one deploy runs at a time and a running deploy is never cancelled. If a run was replaced while waiting and a tag has no release, run the workflow by hand with that tag.

## Releasing

```sh
git tag v1.0.0 && git push origin v1.0.0
```

CI runs on the tag, then Deploy deploys it and publishes the release with `dist-hashes.txt`.

## Rolling back

Actions -> Deploy -> Run workflow -> `ref` = an earlier tag (for example `v0.9.0`). It deploys that tag after checking CI passed for it. Data is never rolled back: the vault is append-only and old versions read the same data. Roll back only the app.

## Restoring from the backup

The daily cron copies everything to `bitcoin-basis-backup` under `vault/<vaultId>/` (see [sync-protocol.md](sync-protocol.md), Backups). To restore after the data bucket was emptied:

```sh
node tools/restore-backup.mjs --account-id <CF_ACCOUNT_ID>            # dry run, lists what is missing
node tools/restore-backup.mjs --account-id <CF_ACCOUNT_ID> --apply    # only-if-new copy into bitcoin-basis-data
```

It uses your `wrangler login` through the Cloudflare API (never printing the token), takes `--vault <id>` when the backup bucket holds several vaults, and `--data-bucket` / `--backup-bucket` for other names. After it runs, `/api/status` says `claimed` again and every passkey and the recovery code work as before.

**Practising it (staging only).** `app/e2e-live/restore-drill.spec.ts` runs the whole drill (set up, backup cron, wipe, restore, fresh device, passkey device) against a throwaway staging Worker and buckets (`*-staging-*`, no bucket lock so they can be deleted). The cron cannot be called from outside, so the staging config uses a tiny wrapper entry file that re-exports the Worker and adds `POST /__cron` guarded by a `CRON_KEY` secret. Keep that wrapper and its config out of the repo and never use it on `bitcoin-basis`. Environment: `BB_LIVE_URL`, `BB_LIVE_SETUP_CODE`, `BB_LIVE_CRON_KEY`, `BB_LIVE_CF_ACCOUNT`, `BB_LIVE_DATA_BUCKET`, `BB_LIVE_BACKUP_BUCKET`; run `npx playwright test -c playwright.live.config.ts restore-drill` in `app/`.

## Verifying a deployment

Anyone can check that a live site matches the published source:

```sh
git clone https://github.com/ecuaryan/bitcoin-basis && cd bitcoin-basis
git checkout v1.0.0
npm ci --ignore-scripts
npm run build                          # also runs tools/sri.mjs
node tools/hash-build.mjs              # writes dist-hashes.txt
# compare with the release asset (the combined line should be identical):
gh release download v1.0.0 -p dist-hashes.txt -O released-hashes.txt
diff dist-hashes.txt released-hashes.txt && echo "build matches the release"
# compare a live site against your own build:
node tools/verify-deployment.mjs https://bitcoin-basis.<subdomain>.workers.dev --all
```

`verify-deployment` fetches the live `index.html` and every file it references (`--all`: every file in the hashes file) and compares sha256s. It also fails if the live page references a file that is not in the hashes file. `dist-hashes.txt` is `sha256sum` compatible, and its first comment line holds one combined hash of the whole build.

Settings › App › Version shows the version, the commit the build came from (`build 047e565`, a link to it on GitHub) and that commit's date. They come from `git` at build time (the commit date, never the current time), so the same commit always builds the same bytes; build from a git clone, because a source archive without `.git` says `build dev` and hashes differently.

Builds are reproducible on the same Node version (`.nvmrc`) with the lockfile (`npm ci`). If a hash differs on another machine, build in Node 24 and check the lockfile is the tag's.

### Subresource integrity

After the build, `tools/sri.mjs` adds `integrity="sha384-..."` and `crossorigin` to every script, stylesheet and modulepreload tag in `index.html`, so a tampered file is refused by the browser. Dynamically imported chunks (lazy route code) cannot carry SRI. They are covered by the Content-Security-Policy `script-src 'self'`, which only allows scripts from your own origin, and by `verify-deployment --all`, which hashes them.
