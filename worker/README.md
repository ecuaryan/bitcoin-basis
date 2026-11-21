# Sync Worker

One Cloudflare Worker that does two things:

- **Hosts the app.** Static files from `../app/dist`, served by Workers static assets (single-page-app fallback). Worker code runs only for `/assets/*`, so a missing build file is a 404 instead of `index.html`.
- **Relays the public BTC price** (`GET /api/price`, `GET /api/price/history?ts=`): fetched from mempool.space server-side and cached, so the browser never contacts a third party.
- **Runs the sync API** under `/api/*`: passkey sign-in, recovery sign-in, and an append-only store of encrypted blobs in a private R2 bucket. It never sees a key or plaintext, and has no code path that deletes or overwrites anything.

The contract with the app is [`docs/sync-protocol.md`](../docs/sync-protocol.md).

## Code

| File | What |
|---|---|
| `src/index.ts` | Routes and the cron entry point |
| `src/session.ts` | Revocable session cookie, single-use challenge and step-up tokens |
| `src/config.ts` | Refuses to serve the API unless `ORIGIN` is https and `RP_ID` is its hostname; checks `MEMPOOL_URL` |
| `src/price.ts` | Public price relay: same-origin only, rate limited, timestamps rounded down to the hour, Cache API |
| `src/webauthn.ts` | Passkey options and verification (`@simplewebauthn/server`) |
| `src/store.ts` | R2 access (only-if-new writes) and the backup copy |
| `src/http.ts`, `src/validate.ts`, `src/crypto.ts` | Request guards, input checks, WebCrypto helpers |
| `src/headers.ts` | Security headers for API responses; `app/public/_headers` holds the same set for static files |

## Local development

```sh
npm run build                         # builds app/dist
cp worker/.dev.vars.example worker/.dev.vars
cd worker && npx wrangler dev         # http://localhost:8787, local R2 in .wrangler/
```

Tests run the real Worker in `workerd` with local R2 (`npm test -w worker`, also part of `npm run check`).

## Bindings and settings

| Name | Kind | What |
|---|---|---|
| `DATA` | R2 bucket | The vault (`bitcoin-basis-data`; rename in `wrangler.jsonc`) |
| `BACKUP` | R2 bucket | Daily copy of `DATA` (`bitcoin-basis-backup`); give it a bucket lock rule |
| `ORIGIN` | var | Exact app origin, e.g. `https://bitcoin-basis.<you>.workers.dev` |
| `RP_ID` | var | Passkey scope: the app's hostname |
| `RP_NAME` | var | Name shown in passkey prompts |
| `SESSION_SECRET` | secret | 32+ random characters; signs sessions and challenges. Changing it signs everyone out |
| `SETUP_CODE` | secret | 16+ characters; lets the first passkey register. Useless once the vault is claimed |
| `MEMPOOL_URL` | var | Where the price comes from (default `https://mempool.space`). Set it to your own mempool instance if you run one; https only |
| `ASSETS` | static assets | The built app (`../app/dist`) |
| `PRICE_LIMITER` | rate limit | 120 price requests a minute per IP |
| `AUTH_LIMITER` | rate limit | Workers Rate Limiting (free): 30 requests a minute per IP on sign-in, recovery sign-in and registration |
| `DEV_ALLOW_HTTP` | `.dev.vars` only | `1` lets the API run on `wrangler dev`'s `http://localhost` origin. Never set it anywhere else |

Secrets are set once by `npm run setup` (`tools/setup.mjs`), which generates them and pipes them to `wrangler secret put`; they are never in a file. The `vars` in `wrangler.jsonc` are local-dev defaults; the deploy workflow passes the real `ORIGIN` and `RP_ID` with `--var` and refuses to deploy if `APP_ORIGIN` is not an https origin. See [`docs/deploy.md`](../docs/deploy.md).

The cron (`17 3 * * *`, daily) copies objects missing from `BACKUP` under `vault/<vaultId>/<key>` (skipped while unclaimed), only-if-new, at most 300 per run. It resumes `e/` from an append-only progress marker (`backup-progress/<vaultId>/`) instead of re-listing everything, and logs only a count.

`tools/setup.mjs` also adds R2 lifecycle rules to `DATA` that expire `used/` (spent challenges), `revoked/` (ended sessions) and `backup-progress/` after 30 days. The Worker itself never deletes. If the rules can't be added from the command line, add them in the dashboard (R2 -> bucket -> Settings -> Object lifecycle rules); without them those tiny objects simply accumulate.

To restore, copy `vault/<id>/*` from `BACKUP` back into `DATA` without the `vault/<id>/` prefix.
