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

**Token** (Cloudflare dashboard -> My Profile -> API Tokens -> Create Token -> start from the "Edit Cloudflare Workers" template, then trim it). Minimum permissions, all scoped to your one account:

- Account -> Workers Scripts -> Edit
- Account -> Workers R2 Storage -> Edit (needed to attach the buckets)
- Account -> Account Settings -> Read

No zone permissions are needed (no custom domain). If a deploy complains about "memberships" or "user details", add User -> User Details -> Read and Memberships -> Read, which the template includes. Set an expiry you can live with, and rotate it by replacing the secret.

Without `CLOUDFLARE_API_TOKEN` the Deploy workflow succeeds with a notice and does nothing, so forks stay green.

## How a deploy works

`.github/workflows/deploy.yml`:

1. Runs only after the **CI** workflow succeeded for that exact commit on `main` (or a `v*` tag on a commit that is on `main`). It checks out that commit, not "latest main". If a newer commit has landed since, the older run steps aside.
2. Checks `APP_ORIGIN` (`tools/check-origin.mjs`): must be `https://<name>.workers.dev` or an https custom origin, no path or port, never localhost. Otherwise the deploy fails before anything is uploaded.
3. `npm ci --ignore-scripts`, `npm run build` (builds the app, then `tools/sri.mjs` adds Subresource Integrity), `tools/hash-build.mjs` writes `dist-hashes.txt`.
4. `wrangler deploy` with `--var ORIGIN` and `--var RP_ID` set from `APP_ORIGIN`. The localhost defaults in `worker/wrangler.jsonc` are never used in production. Secrets are not touched by a deploy.
5. Smoke test (`tools/smoke-test.mjs`): `/api/status` answers with `{claimed: boolean}` and the security headers are on the app and the API.
6. Verifies the live files against the fresh `dist-hashes.txt` (`tools/verify-deployment.mjs --all`).
7. For `v*` tags, attaches `dist-hashes.txt` to a GitHub Release.

Only one deploy runs at a time and a running deploy is never cancelled. If a run was replaced while waiting and a tag has no release, run the workflow by hand with that tag.

## Releasing

```sh
git tag v1.0.0 && git push origin v1.0.0
```

CI runs on the tag, then Deploy deploys it and publishes the release with `dist-hashes.txt`.

## Rolling back

Actions -> Deploy -> Run workflow -> `ref` = an earlier tag (for example `v0.9.0`). It deploys that tag after checking CI passed for it. Data is never rolled back: the vault is append-only and old versions read the same data. Roll back only the app.

## Verifying a deployment

Anyone can check that a live site matches the published source:

```sh
git clone https://github.com/<owner>/bitcoin-basis && cd bitcoin-basis
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

Builds are reproducible on the same Node version (`.nvmrc`) with the lockfile (`npm ci`). If a hash differs on another machine, build in Node 24 and check the lockfile is the tag's.

### Subresource integrity

After the build, `tools/sri.mjs` adds `integrity="sha384-..."` and `crossorigin` to every script, stylesheet and modulepreload tag in `index.html`, so a tampered file is refused by the browser. Dynamically imported chunks (lazy route code) cannot carry SRI. They are covered by the Content-Security-Policy `script-src 'self'`, which only allows scripts from your own origin, and by `verify-deployment --all`, which hashes them.
