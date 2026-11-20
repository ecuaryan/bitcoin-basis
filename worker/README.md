# Sync Worker

One Cloudflare Worker that does two things:

- **Hosts the app.** Static files from `../app/dist`, served by Workers static assets (single-page-app fallback). Worker code never runs for them.
- **Runs the sync API** under `/api/*`: passkey sign-in, recovery sign-in, and an append-only store of encrypted blobs in a private R2 bucket. It never sees a key or plaintext, and has no code path that deletes or overwrites anything.

The contract with the app is [`docs/sync-protocol.md`](../docs/sync-protocol.md).

## Code

| File | What |
|---|---|
| `src/index.ts` | Routes and the cron entry point |
| `src/session.ts` | Session cookie, single-use challenge tokens |
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

Set secrets with `npx wrangler secret put SESSION_SECRET` (never in a file that is committed). The `vars` in `wrangler.jsonc` are local-dev defaults; set the real `ORIGIN` and `RP_ID` at deploy time (`--var ORIGIN:… --var RP_ID:…`).

The cron (`17 3 * * *`, daily) copies objects missing from `BACKUP`, only-if-new, at most 300 per run.
