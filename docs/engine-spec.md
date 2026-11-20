# Engine specification

The engine (`engine/`) is pure TypeScript with no runtime dependencies. It turns a list of **entries** into holdings, lots, tax results and plans. It has no UI, storage or network code. Every rule here is a test.

Not tax advice. Estimates are labeled as estimates.

## Principles

- **Integers only.** BTC as whole sats (`number`, always a safe integer). Dollars as whole cents (`number`). Intermediate products (cents × sats) can exceed 2^53, so proportional math goes through one helper, `mulDivRoundHalfUp(a, b, c)`, that uses `BigInt` internally.
- **Splits add back exactly.** Taking `s` sats from a lot that has `S` sats and `C` cents left costs `C` if `s == S`, otherwise `round_half_up(C × s / S)`. The lot keeps the rest. Proceeds split across lots the same way: proportional to sats, half-up, remainder on the last piece.
- **Entries, not balances.** State is computed by replaying entries. Entries are never mutated.
- **Deterministic.** Replay order is the entry's own time (`at`, UTC instant), then `id` (UUIDv7 strings compare in creation order). Same entries in any input order → identical result.
- **Saved coin choices.** Every disposal (sell, spend, move, give, lost, fee) stores exactly which lots and how many sats it used. Replay uses the saved picks; it never re-picks. Adding an older purchase later never changes a past disposal.
- **Pure functions, typed results.** Invalid input is a typed error result (e.g. `{ ok: false, error: { code: 'insufficient-sats', ... } }`), never a thrown exception for user-caused problems.

## Time and tax dates

- `at` is an ISO-8601 UTC instant. Each entry also stores `tz` (IANA name, default `America/Boise`).
- The **local date** (`YYYY-MM-DD` in `tz`, via `Intl.DateTimeFormat`) decides the tax year and the holding period.
- **Long-term** if the disposal's local date is after the one-year anniversary of the acquisition's local date. Anniversary of Feb 29 is Feb 28.
  - Bought 2025-01-15 → sold 2026-01-15 is short-term; 2026-01-16 is long-term.
  - Bought 2024-02-29 → sold 2025-02-28 short-term; 2025-03-01 long-term.
- A buy at 23:30 local on Dec 31 belongs to that tax year even though it is Jan 1 in UTC.

## Wallets

`type`: `exchange`, `self-custody` or `retirement`. Wallets can be renamed, archived and marked **frozen**. Each has a default proof location (e.g. "Email receipt").

- Lots are tracked per wallet. A disposal can only use lots in its own wallet (Rev. Proc. 2024-28).
- **Frozen** wallets keep their lots and cost but are excluded from "worth" and from sale choices.
- **Retirement** wallets hold balance snapshots only; they never enter tax math, average cost or worth-with-cost figures (worth is shown separately).
- **Confirm balance:** an entry recording the balance the wallet's own app shows. Matches → "confirmed on date". Otherwise report the difference and the entries since the last confirmation.

## Lots

A lot: `id`, `wallet`, `sats`, `costCents`, `acquiredDate` (local date), `acquiredAt`, `tier` (`documented` | `reconstructed` | `estimated` | `unknown`), `proof` (where the record is), `originEntryId`, plus flags (`alwaysLongTerm` for inherited coins).

Lot IDs are stable: a lot created by entry `E` is `E`; the piece of lot `L` moved by move `M` becomes lot `M:<index>` in the destination wallet, keeping `acquiredDate`, `tier`, `proof` and its proportional cost. Moving a whole lot also creates a new lot id in the destination (the source lot reaches zero).

## Entries

Common fields: `id` (UUIDv7), `at`, `tz`, optional `note`, optional `proof`, optional `replaces` (id of the entry this one edits or deletes) and `reason` (required with `replaces`).

| Kind | Fields | Effect |
|---|---|---|
| `wallet` | wallet id, name, type, default proof | creates a wallet |
| `wallet-update` | rename / archive / unarchive | |
| `wallet-freeze` | wallet | marks frozen |
| `wallet-close-out` | wallet, `lossDate` (default: plan effective date), reason | records the frozen wallet's loss (below) and empties it |
| `opening-lot` | wallet, acquiredAt, sats, costCents, tier, origin | imported lot (arrives in a closed year) |
| `buy` | wallet, sats, costCents (total paid incl. fees), tier | new lot |
| `receive` | wallet, sats, `source` (below), valueCents | new lot |
| `move` | from, to, sats (arriving), feeSats, feeValueCents, picks | moves lots; the fee is a tiny sale |
| `sell` | wallet, sats, proceedsCents, picks, `spent` flag + description for spending | disposal |
| `give` | wallet, sats, valueCents, `to: 'person' \| 'charity'`, recipient label, picks | removes lots, no gain |
| `lost` | wallet, sats, reason (lost keys, wrong address, hack, scam), picks | removes lots, no deduction, flagged for CPA |
| `balance-confirm` | wallet, sats | |
| `retirement-snapshot` | wallet, sats | |
| `settings` | partial settings patch | see Settings |
| `close-year` / `unlock-year` | year, reason for unlock | |
| `giving-paid` | year, cents | |
| `delete` | `replaces` + reason | removes the target from replay |

`receive.source`:
- `income` (promos, rewards, mining): ordinary income at value received; that value is the lot's cost.
- `gift`: giver's cost and date if known (cost 0 and the receive date if unknown). Not income. Store the value at the time of the gift too; if it is below the giver's cost, flag "dual basis: confirm with your CPA".
- `inherited`: cost is the value on the date of death; always long-term.
- `frozen-payout` with `fromWallet`: a payout from a frozen wallet. The coins start a new lot at their value when received. Before close-out it counts toward that wallet's recovered amount; after close-out it is a recovery gain (below).
- A receive from your own other wallet is not a receive; it is a `move`.

## Disposals

- **Picks:** `{ lotId, sats }[]`. Valid only if each lot is in the disposal's wallet, has enough sats at that point in replay, and the picks sum to the disposal's sats (for a move: `sats + feeSats`, with the fee taken from the same lots, after the moved sats, in pick order).
- **Oldest first** (default): by `acquiredDate`, then `acquiredAt`, then lot id, within the wallet.
- **Lowest tax this year:** Documented lots first, then Reconstructed, Estimated, Unknown. Within a tier, order by estimated tax per sat (lowest first, i.e. biggest losses first), using the caller's marginal rates for short- and long-term. The engine exposes the ordering with a rate input; the tax module supplies the rates.
- **Hand-picked:** the user's picks, validated.
- **Gain** per pick = its share of proceeds − its cost, labeled short- or long-term.
- **Fee paid in BTC:** a disposal of `feeSats` at `feeValueCents`, from the same lots as the move.
- **Selling from a self-custody wallet** in the Sell planner is refused with `prepare-sale` guidance: move exactly the chosen lots to an exchange wallet first (logged with picks), then sell there. Logging a `sell` with `spent: true` (paying for something) is allowed from any non-frozen wallet.

## Frozen or failed platforms

- Close-out: **loss = cost of the wallet's lots − everything recovered before close-out**, a capital loss in the tax year of `lossDate`. Allocate recovered dollars across lots by cost (half-up, remainder on the last); each lot's loss keeps its own holding period at `lossDate`. The wallet reaches zero.
- Payout after close-out: a capital **gain** in the year received, basis $0, with the holding period of the loss (long if the closed lots were mostly long-term by cost; record which). The coins start a new lot at their value.
- The Ponzi safe harbor (Rev. Proc. 2009-20) is out of scope.

## Edits, conflicts and closed years

- An entry with `replaces: X` hides X from replay. History shows every version.
- If two entries replace the same X (two devices), replay uses neither until resolved and reports a **conflict** listing both versions.
- **Closed years:** an entry whose local date is in a closed year, or that replaces one, is rejected unless the year was unlocked (an `unlock-year` entry with a reason). Opening lots arrive in a closed year.

## Settings (as entries)

Filing status, wages, state (flat-rate, no-tax or custom rate), loss carryforward into the current year (short and long, cents), giving on/off, name ("Giving" by default), percent, before/after tax, earlier money in (cents), time zone.

## Outputs

- Holdings: per wallet balance, cost, average cost; totals excluding frozen and retirement; documentation mix by sats.
- **Average cost** = total cost ÷ BTC held, in cents per BTC, half-up.
- Money put in = sum of buy costs + earlier money in. Never touches tax math.
- Per year: disposals with ST/LT gains (sales, spending, fees), close-out losses and recoveries, income received, gifts given (flag total over the annual exclusion per recipient per year; $19,000 in 2026), charity gifts (held > 1 year → value that day; ≤ 1 year → cost; over $5,000 → qualified appraisal flag), the 1040 digital-asset answer (Yes if any disposal, income or fee that year).
- Exports: Form 8949-style CSV, income list, opening-lots CSV, full entries JSON. Import of the opening-lots CSV (columns `wallet, acquired_utc, btc, sats, cost_usd, cost_per_btc, tier, origin`; sats are authoritative) and of entries JSON. Export then import reproduces every number.

## Tax module

Data files by year (federal brackets for all filing statuses, standard deduction, long-term 0/15/20% thresholds, NIIT 3.8% thresholds, $3,000 loss limit ($1,500 married filing separately), gift annual exclusion; state rates), each with its source link and tests. Missing year → use the latest table and say so.

- `taxForYear({ year, filingStatus, wages, st, lt, carryforward, state })` → federal (ordinary + LT + NIIT), state, total, and carryforward out by character.
- Netting: ST and LT net within themselves; carryforward joins its own character first; then cross-net; a net loss deducts up to the limit against ordinary income (ST loss used first); the rest carries forward keeping character.
- **Capital tax effect** = tax with the capital items − tax with none (wages only).
- **Incremental tax of a sale** = capital tax effect with the sale − capital tax effect without it (this is "Tax this adds" on the Sell screen).
- Marginal rates for ranking lots.
- State: flat rate on net capital gain included in income (net loss deduction as federal), Idaho 5.3%.

## Planner

- **Sell:** for a wallet and amount: oldest-first vs lowest-tax side by side: coins used, ST/LT gain, after carryforward, incremental federal + state tax, carryforward into next year, portion on Estimated/Unknown cost, giving on the sale. Heads-up if tax > $1,000 (estimated payment may be needed).
- **Borrow:** loan, rate, margin-call LTV, liquidation LTV, BTC pledged, price → LTV now, margin-call and liquidation prices, interest per year, if liquidated: BTC sold (loan ÷ liquidation price), oldest first, and the tax that sale would add.
- **Giving on a sale** = percent × max(0, net gain of the coins sold); after-tax mode subtracts that sale's estimated tax first.

## Worked examples (must match exactly)

Married filing jointly, 2026 tables, standard deduction $32,200, wages $130,000, Idaho 5.3%, BTC $75,000, today 2026-11-15. Test book, one exchange wallet:

| Lot | Bought | BTC | Cost |
|---|---|---|---|
| L1 | 2021-03-15 | 0.50000000 | $28,000.00 |
| L2 | 2023-01-20 | 0.40000000 | $9,000.00 |
| L3 | 2025-02-10 | 0.20000000 | $19,500.00 |
| L4 | 2025-12-20 | 0.10000000 | $8,800.00 |

| # | Scenario | Expected |
|---|---|---|
| 1 | Sell 0.25, oldest first | L1 only. Cost $14,000.00, long-term gain $4,750.00. Federal $547.50 + Idaho $251.75 = **$799.25** |
| 2 | Sell 0.25, lowest tax | All of L3 (−$4,500.00 long) and 0.05 of L4 (−$650.00 short). $3,000 deducted, $2,150.00 carries forward. **−$519.00** |
| 3 | Difference 1 − 2 | **$1,318.25** |
| 4 | Move 0.6 with a 2,000-sat fee, oldest first | Moved: L1 whole and 0.1 of L2 ($2,250.00). Fee: cost $0.45, value $1.50, gain $1.05. L2 left: 0.29998000 at $6,749.55 |
| 5 | Gift 0.01 from L2 | No gain. Recipient's cost $225.00, dated 2023-01-20. Value $750.00 |
| 6 | $10,000 short-term gain | Federal $1,900 + Idaho $530 = **$2,430.00** |
| 7 | $100,000 long-term gain on $300,000 wages | $15,000 + $3,800 NIIT + Idaho $5,300 = **$24,100.00** |
| 8 | $5,000 short gain, $8,000 long loss | **−$519.00** |
| 9 | $2,000 short loss, $10,000 long gain | **$1,459.00** |
| 10 | $10,000 long loss | $3,000 deducted, $7,000 carries forward. **−$519.00** |
| 11 | Giving: a lot that cost $41,250.00 sold for $50,000.00 at 10% before taxes | 10% × $8,750.00 = **$875.00** |
| 12 | Average cost of the test book | $65,300 / 1.2 BTC = **$54,416.67** per BTC |
| 13 | Borrow $25,000 against 1 BTC, liquidation at 80% | LTV 33.33%. Liquidation at **$31,250.00** |
| 14 | Add a forgotten 2020 purchase after example 1 was saved | Example 1's sale is unchanged |
| 15 | Received $25 of promo sats | Income $25.00, lot cost $25.00 |
| 16 | $4,750 long gain with a $6,000 long carryforward | Capital tax effect **−$216.25**; nothing carries forward |
| 17 | Buy at 23:30 Dec 31 local | Belongs to that tax year |
| 18 | Sell from a self-custody wallet in the planner | Refused, with prepare-sale guidance |
| 19 | Two entries replace the same entry | Conflict showing both |
| 20 | Frozen wallet: 1 BTC cost $40,000, payout worth $12,000 | Payout lot costs $12,000; close-out loss −$28,000.00 long-term; wallet zero. Later payout $1,500 → $1,500.00 long-term gain that year, new $1,500 lot |
| 21 | Lost 0.1 BTC that cost $3,000 | Holdings −0.1 BTC, no loss recorded, flagged for CPA |
| 22 | Inherited 0.5 BTC worth $40,000 at death, sold 3 weeks later for $41,000 | Long-term gain $1,000.00 |
| 23 | Gave 0.1 BTC held > 1 year (cost $2,000, worth $9,000) to a church | No gain; CPA note $9,000 and qualified-appraisal flag |
| R | 1 BTC, $100.00 lot sold in thirds (33,333,333 / 33,333,333 / 33,333,334 sats) | $33.33, $33.33, $33.34 |
| S | Sell-screen demo: $24,800 carryforward, oldest-first gain $12,953.10 vs lowest-tax loss −$3,746.90, $3,000 against wages either way | Carryforward into next year $8,846.90 vs $25,546.90 |

## Property tests (thousands of random histories, fast-check)

1. Sats and cost always balance: sats in = sats held + sats out; cost in = cost held + cost disposed.
2. No wallet ever goes negative; invalid picks are rejected.
3. Saved disposals never change when unrelated earlier entries are added.
4. Replay from scratch equals incremental replay; input order doesn't matter.
5. Export then import reproduces every number.
6. Splits add back exactly.

## Decisions (ledger)

Readings chosen where the spec is silent or ambiguous. Conservative and simple first.

1. **Field names.** The edit reason is the common `reason`; close-out and unlock-year require it. A lost entry's reason is `cause` (`lost-keys`, `wrong-address`, `hack`, `scam`). Picks are typed `LotPick` (TypeScript already has `Pick`).
2. **Unknown fields are rejected** on every entry, so a typo can't silently drop data. Instants must be `YYYY-MM-DDTHH:MM:SS(.sss)Z`, from 1970 on.
3. **Wallet creations replay first**, whatever their `at`, so a wallet added today can hold coins bought years ago. Everything else replays by `at`, then `id`.
4. **Frozen wallets** accept no new coins and allow no disposals or moves out (close-out is the way to empty them). Archived wallets have no restrictions. A `sell` with `spent: false` may still be logged from a self-custody wallet (a private sale); only the Sell planner refuses it (`canSellFrom`).
5. **Receive tiers** default to `documented`, except a gift with unknown giver cost, which is `unknown`. A gift's giver date is an instant (`giverAcquiredAt`) so the lot keeps a consistent `acquiredAt`; unknown → the receive time. Inherited coins are dated when received and always long-term.
6. **Close-out:** `lossDate` defaults to the entry's local date. Recovered dollars are allocated across the lots proportionally by cost (half-up, remainder on the last lot, lots taken oldest first). If every lot cost $0, recovered dollars split by sats. Recovered more than cost gives a gain, reported as is. A close-out needs a frozen wallet that still holds coins, once only. "Mostly long-term by cost" means long-term cost strictly greater than short-term; a tie is short-term.
7. **Charity:** short-term picks count the lesser of cost and value (IRC §170(e)); long-term picks count value. The qualified-appraisal flag applies to every charity gift in a tax year whose charity gifts total more than $5,000 in value (similar items are aggregated for the year).
8. **1040 digital-asset answer** is Yes for any sale, spending, fee, gift, charity gift, close-out, recovery or income in the year. Moves without fees, buys and lost coins alone are No.
9. **Edits and conflicts:** with two or more versions of one entry, none applies and the original stays as it was. A conflict is resolved by deleting all but one version (a `delete` whose target is a version, not the original). Deleting every version leaves the original. Deleting the newest version of a chain removes the item; replacing a `delete` restores it. Edits of missing entries and cycles are rejected. Two different entries with one id are both rejected; identical copies are fine.
10. **Closed years** are judged in creation order (`id`, UUIDv7): an entry is rejected if, when it was created, the year was closed by the latest `close-year`/`unlock-year` for it. The rule covers buys, receives, moves, sales, gifts, losses and close-outs (their own local date, a close-out's `lossDate`, and the date of any entry they edit or delete). Opening lots, wallets, settings, balance checks, retirement snapshots and giving-paid entries are exempt. Year closings cannot be edited or deleted.
11. **Balance checks** list the entries since the last *matching* confirmation.
12. **Opening-lots CSV:** wallet names must match an existing wallet (ignoring case and outer spaces); unknown or ambiguous names are row errors. Each opening lot's `at` is its `acquiredAt`. `btc` disagreeing with `sats` is a warning (sats win); `cost_per_btc` is ignored on import. The CSV cannot carry "always long-term" (inherited), so export warns for those lots. The full entries JSON is the lossless format.
13. **Form 8949-style CSV:** one row per lot piece; dates `MM/DD/YYYY`; close-out rows use the recovered share as proceeds; recovery rows show `VARIOUS` as acquired with $0 cost.
14. **Gift exclusion totals** group recipients by label, ignoring case and outer spaces; the caller supplies the year's exclusion amount from the tax tables.
15. **Settings units.** A custom state rate is a whole number of 1/10000ths (530 = 5.3%), 0 to 10000. A flat state must be a code in the state table. Filing status has one type (`FilingStatus`, including `qualifying-surviving-spouse`) shared by the ledger and the tax module. `stateChoiceFromSettings` maps settings to the tax module's `StateChoice`.
16. **Planner.** Sale plans use the settings passed in plus the year's already-realized gains from the ledger (sales, spending, fees, close-outs, recoveries) as the base. Lowest-tax ordering uses `marginalRates` at that base. Giving due counts logged `sell` disposals only (not spending or fees); income received is listed separately and never tithed; after-tax mode uses each sale's incremental tax in replay order. Borrow: LTV and prices are half-up; BTC sold at liquidation is rounded up to whole sats (capped at the pledged coins). Heads-up when a sale adds more than $1,000 of tax.
