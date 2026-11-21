# 0006. Deploy only from CI, with release hashes

## Context
End-to-end encryption does not help if the code your browser receives is malicious. The deploy path is the part of a web app that an attacker would target, and it is open to the owner's own mistakes (a deploy from a laptop with uncommitted code).

## Decision
- The Cloudflare token lives only in a GitHub `production` environment. Nobody deploys from a laptop.
- Deploy runs only after CI succeeded for that exact commit, only for commits on `main` (or `v*` tags on `main`), never for a fork's pull request. If a newer commit landed, the older run stands aside.
- The build adds Subresource Integrity, then `tools/hash-build.mjs` writes `dist-hashes.txt`. After deploying, the job smoke-tests the site and compares every live file with those hashes. Tags publish the hashes as a release asset.
- Anyone can rebuild a tag and run `tools/verify-deployment.mjs` against a live site.
- Third-party Actions are pinned by commit SHA; the token has minimal scopes and an expiry; `ORIGIN` and `RP_ID` are always passed explicitly.

## Consequences
- This narrows the web-app trust problem; it does not remove it. Someone who controls your GitHub or Cloudflare account can still ship code ([SECURITY.md](../../SECURITY.md)).
- Slower: every change goes through CI before it is live.
- Rollback is "deploy an earlier tag"; data is never rolled back.
- Forks stay green: with no token the Deploy workflow skips with a notice.
