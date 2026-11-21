# Contributing

Thanks for looking. This is a small personal project; issues and pull requests are welcome, answered when there is time.

- **Security problems:** do not open an issue. Use a private advisory (see [SECURITY.md](SECURITY.md)).
- **Synthetic data only.** Never include real balances, wallets, keys or tax documents in an issue, test or screenshot.
- **Before a pull request:** `npm ci --ignore-scripts`, then `npm run check` and, for app changes, `npm run build && npm run build:fake -w @bitcoin-basis/app && npm run e2e:ci -w @bitcoin-basis/app`.
- **Tests with every change.** Engine changes keep 100% coverage. A bug fix comes with a test that fails without it.
- **Dependencies:** few, exact versions, lockfile from npm. A new one needs a reason in the pull request.
- **Tax rules** need a source (IRS revenue procedure, regulation or form instructions) in the spec and the data file.
- **Style:** plain language in the UI, no emoji, no jargon. Follow [docs/design.md](docs/design.md).
- Changing money math, crypto, the protocol or deploy? Read [AGENTS.md](AGENTS.md) (it applies to people too) and the [decisions](docs/decisions/) first.

Not tax advice.
