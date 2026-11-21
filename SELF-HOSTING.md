# Self-hosting Bitcoin Basis

You will run your own copy on a free Cloudflare account. One Worker serves the app and the sync API; two private R2 buckets hold the encrypted data. GitHub Actions builds and deploys it. Result: `https://bitcoin-basis.<your-subdomain>.workers.dev`.

This guide is written so you can hand it to an AI agent. Steps that need a person (browser sign-in, creating the API token, passkeys) are marked **You**.

## Prerequisites

- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account.
- A GitHub account and the [`gh` CLI](https://cli.github.com), signed in (`gh auth login`).
- Node 24 (`node -v`) and npm.
- A device with a passkey provider that supports the PRF extension (current iOS, macOS, Android, Windows 11, Chrome, Safari; a password manager that stores passkeys also works). Setup stops with an error if the passkey has no PRF.

Do not put real ledger data in the repository. The app keeps your data in encrypted storage on your devices and in your R2 bucket, never in the repo.

## Try it locally first

Optional, five minutes, no Cloudflare account needed. It runs the real Worker and app on your machine with fake secrets:

```sh
npm ci
npm run build
cp worker/.dev.vars.example worker/.dev.vars
cd worker && npx wrangler dev
```

Open <http://localhost:8787>. The setup code is the fake one in `worker/.dev.vars` (`ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234`). Never copy `.dev.vars` anywhere else.

## Steps

**Names are fixed.** The Worker is always `bitcoin-basis` and the buckets `bitcoin-basis-data` and `bitcoin-basis-backup`. Setup and Deploy write to existing ones of the same name in the account you pick, so do not run this on an account that already has resources with those names unless you mean to use them.

### 1. Fork and clone

```sh
gh repo fork ecuaryan/bitcoin-basis --clone
cd bitcoin-basis
gh repo set-default            # choose your fork if asked
```

Forks have GitHub Actions turned off. Open the fork's **Actions** tab and click "I understand my workflows, go ahead and enable them" (or: `gh api -X PUT repos/<you>/bitcoin-basis/actions/permissions -F enabled=true`).

### 2. Install

```sh
npm ci --ignore-scripts
```

### 3. Sign in to Cloudflare (You)

```sh
npx wrangler login
```

A browser window opens. Approve. If you have never used Workers, also pick a free `workers.dev` subdomain: Cloudflare dashboard, Workers & Pages, "Your subdomain".

### 4. Run setup

```sh
npm run setup -- --dry-run     # prints every command, changes nothing
npm run setup
```

Safe to run again. It:

1. checks you are signed in and picks the account (several accounts: add `--account-id <id>`),
2. finds your `workers.dev` subdomain (or pass `--subdomain <name>`) and works out `ORIGIN` and `RP_ID`,
3. creates the private buckets `bitcoin-basis-data` and `bitcoin-basis-backup`,
4. adds a bucket lock to the backup bucket (365 days; `--retention-days <n>`). If your wrangler cannot, it prints the dashboard steps,
5. adds expiry rules (30 days) for spent markers in the data bucket (`used/`, `revoked/`, `backup-progress/`),
6. generates `SESSION_SECRET` and `SETUP_CODE` and stores them as Worker secrets over stdin. Nothing secret goes on a command line or to disk,
7. prints the GitHub settings and the final check.

**The setup code** looks like `ABCD-1234-…` (eight groups of four). It is printed once. **Copy it before the terminal scrolls** (select the line, copy, paste it into a private note or password manager); you type it once to claim the app. If you lose it before claiming, run `npm run setup -- --rotate-secrets`. Do not put it in the repo, a chat with a shared agent, or a ticket. It does nothing after the first passkey is created.

Note the printed `CF_ACCOUNT_ID` and `APP_ORIGIN`.

### 5. Create the Cloudflare API token (You)

Do steps 5 and 6 **before the first push**. If the token or settings are missing when Deploy runs, it skips with a notice and you have to re-run it.

Cloudflare dashboard, My Profile, API Tokens, **Create Token**, "Edit Cloudflare Workers" template, then trim it to exactly:

| Scope | Permission | Access |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | Workers R2 Storage | Edit |
| Account | Account Settings | Read |
| User | User Details | Read |
| User | Memberships | Read |

Under **Account Resources** choose "Include", your one account. No zone permissions. Set an expiry you can live with (for example one year; replace the secret when it expires). Copy the token once. Never paste it into chat or the repo.

### 6. GitHub settings

Create the `production` environment, limited to `main` and `v*` tags:

```sh
REPO=<you>/bitcoin-basis
gh api -X PUT repos/$REPO/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/$REPO/environments/production/deployment-branch-policies -f name=main -f type=branch
gh api -X POST repos/$REPO/environments/production/deployment-branch-policies -f name='v*' -f type=tag
```

(Or in the web UI: Settings, Environments, New environment, "Deployment branches and tags", add `main` and `v*`. Optionally add yourself as a required reviewer to approve each deploy.)

Variables (values printed by setup):

```sh
gh variable set CF_ACCOUNT_ID --repo $REPO --body "<account id>"
gh variable set APP_ORIGIN    --repo $REPO --body "https://bitcoin-basis.<subdomain>.workers.dev"
```

Secret, stored in the environment (**You** paste the token at the prompt):

```sh
gh secret set CLOUDFLARE_API_TOKEN --env production --repo $REPO
```

`APP_ORIGIN` must be `https://`, with no path or port, never localhost; the deploy fails before uploading anything otherwise.

### 7. Deploy

Deploy runs after CI succeeds for a push to `main`. Trigger it:

```sh
git commit --allow-empty -m "Deploy my instance"
git push origin main
```

Watch it: `gh run watch`. Order: **CI** (typecheck, lint, tests, end-to-end), then **Deploy** (build with integrity hashes, `wrangler deploy`, smoke test, verify the live files against the build's hashes). To deploy a specific commit later: Actions, Deploy, Run workflow, `ref`.

### 8. Check

```sh
curl -s https://bitcoin-basis.<subdomain>.workers.dev/api/status
```

Expect `{"claimed":false}`. If you get that, the Worker, the bucket binding and the secrets are working.

First time using R2 on this account? Cloudflare may ask for a payment method to enable R2 (setup fails at the bucket step until you do). The free tier covers a personal vault; see Costs.

### 9. Set up the first device (You)

1. Open the app address on your phone or computer.
2. On the first screen, type the setup code into **Setup code** and press **"Claim and create my passkey"**. Approve the passkey prompt. (If this screen says "These records are already set up.", someone has already claimed it.)
3. The app shows your **recovery code** (`XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`). It is **not** a Bitcoin seed phrase. Write it down or save it, then press **"I've saved it"**.
4. Type group 4 of the code back (the fourth group) and press **"Continue"**.
5. "You're all set". Press **"Add my first wallet"**.

Check that `/api/status` now says `{"claimed":true}`.

### 10. Add a second device

Settings (the gear), Security and devices, "Add another device" shows the address and a QR. On the new device open the address. The first screen says "These records are already set up."; press **"Open my records"**. That opens **"Open your records"**: type the recovery code into its field, or press **"Use a passkey"** if a passkey that syncs to this device exists (iCloud Keychain, Google Password Manager, a password manager). When it asks, add a passkey on this device.

### 11. Print the emergency kit

Right after setup, the app offers the kit (Settings, Emergency kit, or "Print the kit" while the code is on screen). Print it, write your name at the top, keep it with your estate papers. A year later, or when the app reminds you, test it: open a private window, press "Open my records", type the code.

## Updating

Pull from upstream into your fork's `main`. CI and Deploy run again. Data is never changed by a deploy and old versions read the same data. To release with published hashes, push a tag: `git tag v1.0.0 && git push origin v1.0.0`. To roll back the app, run Deploy with an earlier tag. See [docs/deploy.md](docs/deploy.md), which also explains how to verify a live deployment against a release.

## Troubleshooting

| Problem | Fix |
|---|---|
| Setup: "Could not look up a workers.dev subdomain" | Dashboard, Workers & Pages, pick a subdomain. Re-run `npm run setup -- --subdomain <name>` (the part before `.workers.dev`). |
| Setup: "Not signed in" | `npx wrangler login`, then re-run. |
| Deploy ran but did nothing ("CLOUDFLARE_API_TOKEN is not configured") | The secret is missing or in the wrong place. `gh secret set CLOUDFLARE_API_TOKEN --env production`, then re-run Deploy. |
| Deploy: "GitHub variable CF_ACCOUNT_ID is not set" or an origin error | Set `CF_ACCOUNT_ID` and `APP_ORIGIN` as repository variables. `APP_ORIGIN` must be a bare `https://` origin. |
| Deploy waits or is rejected at the environment step | The `production` environment's branch and tag rules do not match, or a reviewer must approve. Check Settings, Environments. |
| Deploy never starts | Actions disabled on the fork, or CI failed. A Deploy run only follows a successful CI run of a push to `main` or a `v*` tag. |
| Wrangler or token errors about "memberships" or "user details" | Add User, User Details, Read and Memberships, Read to the token. |
| `/api/status` gives an error or 500 | Origin check: the Worker refuses to serve unless `ORIGIN` is `https://` and `RP_ID` equals its hostname. Check `APP_ORIGIN`, redeploy. Also confirm setup finished (secrets exist). |
| "Origin" errors in the app (403) | You opened the app on a different address than `APP_ORIGIN` (another hostname, `http://`). Use the exact address. |
| Setup code lost, vault still unclaimed | `npm run setup -- --rotate-secrets` makes a new code (and signs everyone out). If the vault is already claimed you do not need it. |
| Passkey step says PRF is not supported | Use a passkey provider that supports it (current Chrome, Safari 18+, iOS 18+, a password manager with passkeys). You can still restore with the recovery code. |
| Setup failed halfway (`meta/claimed` exists but no passkey) | See "Half-written states" in [docs/sync-protocol.md](docs/sync-protocol.md). |
| The data bucket was emptied or lost, but `/api/status` used to say `claimed` | Restore from the backup bucket: see "Restoring from the backup" below. |
| Rate limited (429) | Wait a minute; sign-in is limited to 30 a minute per IP. |

### Starting over

Only if you want an empty instance. This deletes your data from the live bucket:

1. Delete all objects in the `bitcoin-basis-data` bucket (dashboard, R2, bucket, select all; or `npx wrangler r2 object delete bitcoin-basis-data/<key> --remote` per key).
2. `npm run setup -- --rotate-secrets` for a new setup code.
3. Open the app and claim it again.

Backups are not deleted. They live under `vault/<id>/` in `bitcoin-basis-backup`, are locked for the retention period, and stay encrypted: they open only with that vault's passkeys or recovery code. To restore, see below. Also clear site data in your browsers (the old local copy would otherwise reconnect).

### Restoring from the backup

If the data bucket is emptied or damaged (the app's `/api/status` says `{"claimed":false}` although you had set up), restore it from `bitcoin-basis-backup`. The Worker and its secrets are not involved, so do not run setup again.

```sh
npx wrangler login
node tools/restore-backup.mjs --account-id <your CF_ACCOUNT_ID>             # dry run: lists what would be copied
node tools/restore-backup.mjs --account-id <your CF_ACCOUNT_ID> --apply     # copies it
```

It copies `vault/<id>/<key>` to `<key>` in `bitcoin-basis-data` and never overwrites an object that is already there. `--apply` refuses if the data bucket still holds a vault (any `meta/`, `cred/`, `recovery/` or `epoch/` object), because copying an older vault next to it would let the older vault's recovery code and passkeys in; empty the bucket first. `--force` overrides that, only to finish a restore of the same vault that stopped partway. If the backup holds more than one vault (you claimed the instance again after a wipe), it lists their ids and you pick the one you want with `--vault <id>`. Then clear site data in your browsers and open the app: your recovery code (or a passkey already registered) opens it. Anything logged after the last daily backup (03:17 UTC) and not yet synced from a device is still on that device and syncs up again. Use `--data-bucket` / `--backup-bucket` if you renamed the buckets.

## Costs

$0 on the free tiers, for a personal vault. Limits at the time of writing (check [Cloudflare's pricing](https://developers.cloudflare.com/workers/platform/pricing/) for current numbers):

- Workers: 100,000 requests a day. Static files are free and do not count against CPU. A personal vault uses a few hundred.
- R2: 10 GB storage, 1 million writes and 10 million reads a month. The vault is kilobytes to a few megabytes.
- Rate limiting binding: included on the free plan.
- GitHub Actions: free for public repositories (a private fork uses the free minutes).
- No custom domain is needed. If you use one, set `APP_ORIGIN` to it; passkeys are tied to the hostname.

R2 may ask for a payment method to enable the service even though the free tier covers you. Adding one is your decision; the app does not need it beyond that.
