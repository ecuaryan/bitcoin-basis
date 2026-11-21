# 0003. Wallet-by-wallet lots (Rev. Proc. 2024-28)

## Context
From 2025 the IRS asks taxpayers to track cost basis wallet by wallet or account by account, not as one universal pool. Brokers must follow a specific-identification rule when you tell them which coins you sold.

## Decision
Lots belong to a wallet, and a disposal can only use lots in its own wallet. A move creates new lots in the destination (`<moveId>:<sourceLotId>`) that keep date, tier, proof and proportional cost; the fee is a small disposal. Every disposal saves its picks. The Sell planner refuses to sell from a self-custody wallet and explains how to move exactly the chosen lots to an exchange first. Plans other than oldest first say that the exchange must be told which coins at the time of sale.

## Consequences
- Moves must be logged, with their fees, to keep the records true.
- Saved picks make past sales stable when an older purchase is added later.
- More structure than a single pool, and more data entry for the user.
- This is the engine's reading of the rules, written in [engine-spec.md](../engine-spec.md). It is not tax advice.
