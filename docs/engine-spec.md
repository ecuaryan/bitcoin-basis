# Engine specification

The engine (`engine/`) is pure TypeScript with no runtime dependencies. It turns a list of **entries** into holdings, lots, tax results and plans. It has no UI, storage or network code. Every rule here is a test.

Not tax advice. Estimates are labeled as estimates.

## Principles

- **Integers only.** BTC as whole sats (`number`, always a safe integer). Dollars as whole cents (`number`). Intermediate products (cents × sats) can exceed 2^53, so proportional math goes through one helper, `mulDivRoundHalfUp(a, b, c)`, that uses `BigInt` internally.
- **Splits add back exactly.** Taking `s` sats from a lot that has `S` sats and `C` cents left costs `C` if `s == S`, otherwise `round_half_up(C × s / S)`. "Half-up" everywhere means halves round away from zero, symmetric for negatives (0.5 → 1, −0.5 → −1). The lot keeps the rest. Proceeds split across lots the same way: proportional to sats, half-up, remainder on the last piece.
- **Entries, not balances.** State is computed by replaying entries. Entries are never mutated.
- **Deterministic.** Replay order is the entry's own time (`at`, UTC instant), then `id` (UUIDv7 strings compare in creation order). Same entries in any input order → identical result.
- **Saved coin choices.** Every disposal (sell, spend, move, give, lost, fee) stores exactly which lots and how many sats it used. Replay uses the saved picks; it never re-picks. Adding an older purchase later never changes a past disposal.
- **Pure functions, typed results.** Invalid input is a typed error result (e.g. `{ ok: false, error: { code: 'insufficient-sats', ... } }`), never a thrown exception for user-caused problems. Amounts are range-checked on entry, and a figure that cannot be represented exactly (e.g. an absurd average cost per BTC) comes back as `null` (shown as "—").

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
- **Retirement** wallets hold retirement purchases (`retirement-buy`) and balance snapshots. Neither ever enters tax math, lots, the taxable totals or average cost, the planners or loans; they are shown separately (see Holdings under Outputs). A balance note or purchase dated after the wallet was archived is refused (`wallet-archived`). Taxable entries (`buy`, `receive`, moves, disposals) into or out of a retirement wallet are refused (`retirement-wallet`). Selling or withdrawing inside a retirement account is not tracked yet.
- **Confirm balance:** an entry recording the balance the wallet's own app shows. Matches → "confirmed on date". Otherwise report the difference and the entries since the last confirmation.

## Lots

A lot: `id`, `wallet`, `sats`, `costCents`, `acquiredDate` (local date), `acquiredAt`, `tier` (`documented` | `reconstructed` | `estimated` | `unknown`), `proof` (where the record is), `originEntryId` (the entry version that created it), `tz` (that entry's time zone), `lossBasis` (a gift's dual basis, else null), plus flags (`alwaysLongTerm` for inherited coins).

Lot IDs are stable: a lot created by entry `E` is `E`, where `E` is the root (first version) of the entry's edit chain, so editing or restoring the entry keeps the lot's id and later saved picks keep working with the corrected figures; the piece of lot `L` moved by move `M` becomes lot `M:L` in the destination wallet (coins moved twice: `M2:M1:L`; entry ids cannot contain `:`, so these never collide, and a move may name each lot once, so reordering its picks in an edit changes no ids), keeping `acquiredDate`, `tier`, `proof` and its proportional cost. Moving a whole lot also creates a new lot id in the destination (the source lot reaches zero).

## Entries

Common fields: `id` (UUIDv7 in practice; any 1-64 letters, digits, `_` or `-`, never `:`), `at`, `tz`, optional `note`, optional `proof`, optional `replaces` (id of the entry this one edits or deletes) and `reason` (required with `replaces`).

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
| `retirement-snapshot` | wallet, sats | the balance the custodian shows (a balance note) |
| `retirement-buy` | wallet, sats, costCents (total paid incl. fees); `at` is when it was bought; `proof` where the record is | a retirement purchase: never a lot, never in tax math. Refused for an unknown wallet, a wallet that is not a retirement wallet (`not-retirement-wallet`) or one archived before its time (`wallet-archived`) |
| `settings` | partial settings patch | see Settings |
| `close-year` / `unlock-year` | year, reason for unlock | |
| `giving-paid` | year, cents | retired (the giving feature was removed): still accepted so old records and backups replay, and ignored |
| `delete` | `replaces` + reason | removes the target from replay |
| `loan`, `loan-update`, `loan-link`, `loan-draw`, `loan-payment`, `loan-statement` | see [loans-spec.md](loans-spec.md) | tracking only: never change lots, cost basis or gains |

`receive.source`:
- `income` (promos, rewards, mining): ordinary income at value received; that value is the lot's cost.
- `gift`: giver's cost and date if known (cost 0 and the receive date if unknown). Not income. Store the value at the time of the gift too; if it is below the giver's cost, the lot carries both bases (Treas. Reg. 1.1015-1(a)): a later disposal uses the giver's cost and date if that gives a gain, the value at the gift (holding period from the gift date) if that gives a loss, and no gain or loss if the proceeds fall in between. Flagged "dual basis: confirm with your CPA".
- `inherited`: cost is the value on the date of death; always long-term.
- `frozen-payout` with `fromWallet`: a payout from a frozen wallet. The coins start a new lot at their value when received. Dated on or before the close-out's `lossDate` it counts toward that wallet's recovered amount; dated after it, it is a recovery gain (below), whenever the close-out entry was logged.
- A receive from your own other wallet is not a receive; it is a `move`.

## Disposals

- **Picks:** `{ lotId, sats }[]`. Valid only if each lot is in the disposal's wallet, has enough sats at that point in replay, and the picks sum to the disposal's sats (for a move: `sats + feeSats`, with the fee taken from the same lots, after the moved sats, in pick order).
- **Oldest first** (default for sales, spending, moves and losses): by `acquiredDate`, then `acquiredAt`, then lot id, within the wallet.
- **Lowest cost first** (default for gifts, `lowestCostOrder` / `lowestCostFirst`): by cost per sat, lowest first (compared exactly, cross-multiplied in BigInt), ties oldest first, within the wallet. The giver keeps the higher-cost coins and the recipient takes over the cost. Lots that cost at or below the gift's value per sat necessarily come before lots that cost more, so a gift uses a lot below cost only when the others cannot cover it, and then the smallest loss per sat first. `satsGivenBelowCost(lots, picks, sats, valueCents)` counts the sats given from lots costing more per sat than the gift is worth per sat (break-even is not below cost), so the app can say so.
- **Lowest tax this year:** Documented lots first, then Reconstructed, Estimated, Unknown. Within a tier, order by estimated tax per sat (lowest first, i.e. biggest losses first; a dual-basis gift uses the basis that applies at the price), using the caller's marginal rates for short- and long-term. The engine exposes the ordering with a rate input; the tax module supplies the rates.
- **Hand-picked:** the user's picks, validated.
- **Gain** per pick = its share of proceeds − its cost, labeled short- or long-term.
- **Fee paid in BTC:** a disposal of `feeSats` at `feeValueCents`, from the same lots as the move.
- **Selling from a self-custody wallet** in the Sell planner is refused with `prepare-sale` guidance: move exactly the chosen lots to an exchange wallet first (logged with picks), then sell there. Logging a `sell` with `spent: true` (paying for something) is allowed from any non-frozen wallet.

## Frozen or failed platforms

- Close-out: **loss = cost of the wallet's lots − everything recovered before close-out**, a capital loss in the tax year of `lossDate`. Allocate recovered dollars across lots by cost (half-up, remainder on the last); each lot's loss keeps its own holding period at `lossDate`. The wallet reaches zero.
- Payout after the loss date: a capital **gain** in the year received, basis $0, split short/long in proportion to the close-out's short- and long-term losses (half-up, remainder on long). The coins start a new lot at their value.
- The Ponzi safe harbor (Rev. Proc. 2009-20) is out of scope.

## Edits, conflicts and closed years

- An entry with `replaces: X` hides X from replay. History shows every version.
- If two entries replace the same X (two devices), replay uses neither until resolved and reports a **conflict** listing both versions.
- **Closed years:** an entry whose local date is in a closed year, or that replaces one, is rejected unless the year was unlocked (an `unlock-year` entry with a reason). Opening lots arrive in a closed year; editing or deleting one needs its year unlocked.

## Settings (as entries)

Filing status, wages, state (flat-rate, no-tax or custom rate), losses from past years (unused losses from earlier returns; short and long, cents) with the tax year they are for (`carryforwardYear`; entries without it mean the current year), time zone. Older versions also wrote giving settings (`givingEnabled`, `givingName`, `givingPercentBp`, `givingMode`) and "earlier money in" (`earlierMoneyInCents`); a settings entry carrying them still validates (same checks as before) and replays, and those fields are ignored (`RETIRED_SETTINGS`).

## Outputs

- Holdings: per wallet balance, cost, average cost; totals excluding frozen and retirement; documentation mix by sats.
- Retirement wallets (`holdings().retirement`): purchases count, sats, cost and average cost. **Balance rule:** with any purchase recorded, the balance is the purchases' total; with none, the latest balance note (0 if none), so books with notes only look as before. The latest note is checked against the purchases dated up to its time (`snapshot.differenceSats`, `matches`); a difference is reported, never silently resolved.
- Per retirement purchase (`retirementPurchases(state, wallet, price, today)`): cost, worth now (sats × price, half-up), gain, percent (nearest whole, half away from zero; none for a $0 cost) and whole days held.
- **Worth is piece by piece.** Coins are valued one way everywhere: each lot (or retirement purchase) at sats × price, half-up, then added (`valueOfPieces`, `worthOfPieces`; `retirementWorth` for a retirement wallet: its purchases, or its balance note with no cost). So a list of lots or purchases always adds up to its total exactly, and Holdings, wallets, year rows and loans never differ by a cent.
- All Bitcoin (`allBitcoin(state, holdings, price)`): `taxable` is the taxable totals (`taxableLots`: wallets not frozen or retirement), valued lot by lot; `retirement` is every retirement wallet's balance (`retirementWorth`), with cost and gain over the wallets with purchases (`unknownCostSats` for notes-only wallets: in the worth, not in cost or gain); `total` adds the two. Frozen wallets stay out. No tax figure reads it.
- **Average cost** = total cost ÷ BTC held, in cents per BTC, half-up (null if nothing is held or the figure is too large to represent).
- Per year: disposals with ST/LT gains (sales, spending, fees), close-out losses and recoveries, income received, gifts given (flag total over the annual exclusion per recipient per year; $19,000 in 2026), charity gifts (held > 1 year → value that day; ≤ 1 year → cost; over $5,000 → qualified appraisal flag), the 1040 digital-asset answer (Yes if any disposal, income or fee that year).
- Loans (purchases funded by a HELOC or other loan): interest paid, owed now, value, break-even and payoff figures; see [loans-spec.md](loans-spec.md).
- Exports: Form 8949-style CSV, income list, opening-lots CSV, full entries JSON. Text cells starting with `= + - @`, tab or CR get a leading `'` (OWASP CSV-injection guidance); numeric columns are never changed. Import of the opening-lots CSV (columns `wallet, acquired_utc, btc, sats, cost_usd, cost_per_btc, tier, origin`, optional trailing `tz`; sats are authoritative) and of entries JSON. A CSV row whose wallet is an existing retirement wallet becomes a `retirement-buy` (`origin` → `proof`; its tier must be empty, and a tier or loan columns are a row problem, so an archived taxable wallet of the same name can never lose lots that way); the import never creates wallets of that kind. The CSV export lists retirement purchases after the lots, with an empty tier and no loan cells, so a re-import without the retirement wallet stops at a row problem instead of making taxable lots. Export then import reproduces every number. The opening-lots CSV has an optional `funded_by` column (loan name; [loans-spec.md](loans-spec.md)).

## Tax module

Data files by year (federal brackets for all filing statuses, standard deduction, long-term 0/15/20% thresholds, NIIT 3.8% thresholds, $3,000 loss limit ($1,500 married filing separately), gift annual exclusion; state rates), each with its source link and tests. Missing year → years before the earliest table use the earliest; years after the latest use the latest; the assumptions say which.

- `taxForYear({ year, filingStatus, wages, st, lt, carryforward, state })` → federal (ordinary + LT + NIIT), state, total, and carryforward out by character.
- Netting: ST and LT net within themselves; carryforward joins its own character first; then cross-net; a net loss deducts up to the limit against ordinary income (ST loss used first); the rest carries forward keeping character.
- **Capital tax effect** = tax with the capital items − tax with none (wages only).
- **Incremental tax of a sale** = capital tax effect with the sale − capital tax effect without it (this is "Tax this adds" on the Sell screen, or "Tax this saves" when it is negative).
- Marginal rates for ranking lots.
- State: flat rate on net capital gain included in income (net loss deduction as federal), Idaho 5.3%.

## Planner

- **Sell:** for a wallet and amount: oldest-first vs lowest-tax side by side: coins used, ST/LT gain, after carryforward, incremental federal + state tax, carryforward into next year, portion on Estimated/Unknown cost. Heads-up if tax > $1,000 (estimated payment may be needed). Plans other than oldest first carry `brokerInstructionNeeded` (tell the exchange which coins by the time of sale, Treas. Reg. 1.1012-1(j)(3), or its default applies). The price must be above $0 and the date inside the plan's year.
- **Borrow:** loan, rate, margin-call LTV, liquidation LTV, BTC pledged, price → LTV now, margin-call and liquidation prices, interest per year, if liquidated: BTC sold (loan ÷ liquidation price), oldest first, and the tax that sale would add. The pledging wallet must exist and not be frozen, retirement or archived; the pledged coins come from its lots.

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
| 5 | Gift 0.01 from L2 (lowest cost first picks L2: $22,500 per BTC) | No gain. Recipient's cost $225.00, dated 2023-01-20. Value $750.00 |
| 6 | $10,000 short-term gain | Federal $1,900 + Idaho $530 = **$2,430.00** |
| 7 | $100,000 long-term gain on $300,000 wages | $15,000 + $3,800 NIIT + Idaho $5,300 = **$24,100.00** |
| 8 | $5,000 short gain, $8,000 long loss | **−$519.00** |
| 9 | $2,000 short loss, $10,000 long gain | **$1,459.00** |
| 10 | $10,000 long loss | $3,000 deducted, $7,000 carries forward. **−$519.00** |
| 11 | (Retired: giving on a sale. The giving feature was removed; the number is kept so the others keep theirs.) | |
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
7. Gifts, lowest cost first (`gift-picks.test.ts`): picks cover the amount exactly, stay in the wallet, never exceed a lot or repeat one; no lot below cost is used while lots at or below the value can cover the gift; a saved gift never changes when a cheaper or older purchase is added later.

## Decisions (ledger)

Readings chosen where the spec is silent or ambiguous. Conservative and simple first.

1. **Field names and ids.** Entry ids (and `replaces`) are 1-64 letters, digits, `_` or `-` (UUIDv7 in practice); `:` is not allowed, so derived lot ids (`<id>:<n>`) never collide, and a lot id already in use is refused anyway (`duplicate-lot`). The edit reason is the common `reason`; close-out and unlock-year require it. A lost entry's reason is `cause` (`lost-keys`, `wrong-address`, `hack`, `scam`). Picks are typed `LotPick` (TypeScript already has `Pick`).
2. **Unknown fields are rejected** on every entry, so a typo can't silently drop data. Instants must be `YYYY-MM-DDTHH:MM:SS(.sss)Z`, from 1970 on. One entry carries at most 21,000,000 BTC of sats and $1 trillion of cents (settings amounts too).
3. **Wallet creations replay first**, whatever their `at`, so a wallet added today can hold coins bought years ago. Everything else replays by `at`, then `id`.
4. **Frozen wallets** accept no new coins and allow no disposals or moves out (close-out is the way to empty them). Archived wallets have no restrictions. A `sell` with `spent: false` may still be logged from a self-custody wallet (a private sale); only the Sell planner refuses it (`canSellFrom`).
5. **Receive tiers** default to `documented`, except a gift with unknown giver cost, which is `unknown`. A gift's giver date is an instant (`giverAcquiredAt`) so the lot keeps a consistent `acquiredAt`; unknown → the receive time. Inherited coins are dated when received and always long-term. **Dual basis:** a gift worth less than the giver's cost stores both bases on the lot (`lossBasis`: the value at the gift and the gift's local date); every split (partial sale, move, fee) divides both proportionally. Sales, spending, fees, close-outs and the planner apply the three-region rule per lot piece; the piece reports the basis, date and term actually used (cost = proceeds in the no-gain/no-loss region). Gifts given and lost coins report the giver's cost.
6. **Close-out:** `lossDate` defaults to the entry's local date and may not be before the wallet's earliest coins (`invalid-loss-date`). The recovered amount is every frozen payout dated on or before `lossDate`, whenever it was logged; payouts dated after it are recoveries, even if logged before the close-out (settled after replay). Recovered dollars are allocated across the lots proportionally by cost (half-up, remainder on the last lot, lots taken oldest first). If every lot cost $0, recovered dollars split by sats. Recovered more than cost gives a gain, reported as is. A close-out needs a frozen wallet that still holds coins, once only. A recovery splits short/long in proportion to the close-out's net short- and long-term losses (half-up, remainder on long); if the close-out had no loss, by the closed sats of each term. (Deprecated `recoveryTerm`/`term` fields name the larger share, long on a tie.)
7. **Charity:** short-term picks count the lesser of cost and value (IRC §170(e)); long-term picks count value. The qualified-appraisal flag applies to every charity gift in a tax year whose charity gifts total more than $5,000 in value (similar items are aggregated for the year).
8. **1040 digital-asset answer** is Yes for any sale, spending, fee, gift, charity gift, close-out, recovery or income in the year. Moves without fees, buys and lost coins alone are No.
9. **Edits and conflicts:** with two or more versions of one entry, none applies and the original stays as it was. A conflict is resolved by deleting all but one version (a `delete` whose target is a version, not the original). Deleting every version leaves the original. Deleting the newest version of a chain removes the item; replacing a `delete` restores it. Edits of missing entries and cycles are rejected. Two different entries with one id are both rejected; identical copies are fine.
10. **Closed years** are judged in creation order (`id`, UUIDv7): an entry is rejected if, when it was created, the year was closed by the latest `close-year`/`unlock-year` for it. The rule covers buys, receives, moves, sales, gifts, losses, wallet freezes and close-outs (their own local date, a close-out's `lossDate`, and the dates of every version in the edit chain of any entry they edit or delete, root included: deleting one side of a conflict, or replacing a delete, can bring any version back into replay). A new opening lot is exempt (they arrive in closed years) unless its wallet has a freeze or close-out dated on or after the lot's date in a closed year (a close-out sweeps up the wallet's lots); then it needs that year unlocked. Editing or deleting an opening lot needs its year (`at` and acquired date) unlocked. Wallets, settings, balance checks, retirement snapshots, retirement purchases and giving-paid entries are exempt, with two wallet locks that hold in every year: a wallet's id and type never change (an edit of a wallet entry may only change its name and default proof), and a wallet that any entry names cannot be deleted (archive it). Year closings cannot be edited or deleted. The lock guards against mistakes, not against a hostile writer: ids are made by the client, so an entry given an id that sorts before the close is treated as written before it. It also locks only entries dated in the closed year: editing a purchase from an earlier, open year still changes a closed year's sale of those coins, so close years in order.
11. **Balance checks** list the entries since the last *matching* confirmation.
12. **Opening-lots CSV:** wallet names must match an existing wallet (ignoring case and outer spaces), preferring non-archived wallets; unknown or ambiguous names are row errors. Wallet names are unique among non-archived wallets: creating, renaming or unarchiving into a name in use is `wallet-name-taken`. Wallet creations replay first, so a new wallet cannot take an archived wallet's name; rename the old one first. Each opening lot's `at` is its `acquiredAt`, exported with milliseconds when it has them. Export adds a trailing `tz` column (the lot's time zone, which decides its acquired date); import reads it when present and uses the import's time zone when the column or cell is empty. `btc` disagreeing with `sats` is a warning (sats win); `cost_per_btc` is ignored on import and left empty on export when too large to represent. The CSV cannot carry "always long-term" (inherited) or a gift's dual basis, so export warns for those lots. The full entries JSON is the lossless format.
13. **Form 8949-style CSV:** one row per lot piece; dates `MM/DD/YYYY`, or `INHERITED` as the date acquired for inherited coins; close-out rows use the recovered share as proceeds; a recovery gives one row per term with a nonzero share, `VARIOUS` as acquired, $0 cost. **CSV safety:** in every export, text cells starting with `=`, `+`, `-`, `@`, tab or CR, possibly after apostrophes, are prefixed with `'` (so `'=x` exports as `''=x` and round-trips exactly); money, sats and BTC columns are never altered. The opening-lots import strips that prefix again.
14. **Gift exclusion totals** group recipients by label, ignoring case and outer spaces; the caller supplies the year's exclusion amount from the tax tables.
15. **Settings units.** A custom state rate is a whole number of 1/10000ths (530 = 5.3%), 0 to 10000. The retired giving percent (`givingPercentBp`, still validated in old entries) is whole basis points 0 to 10000. A flat state must be a code in the state table. Filing status has one type (`FilingStatus`, including `qualifying-surviving-spouse`) shared by the ledger and the tax module. `stateChoiceFromSettings` maps settings to the tax module's `StateChoice`.
16. **Planner.** Sale plans use the settings passed in plus the year's already-realized gains from the ledger (sales, spending, fees, close-outs, recoveries) as the base. Lowest-tax ordering uses `marginalRates` at that base. Lowest tax stays tier-first on purpose (estimated costs should not be leaned on to cut tax); when oldest first comes out cheaper, the lowest-tax plan carries a plain-language `note` saying so. Plans other than oldest first set `brokerInstructionNeeded` (only exchange wallets reach the planner; their default is taken to be oldest first). Sale requests need a price above $0, a date inside the plan's year, and proceeds up to $1 trillion (`invalid-input`). Borrow: the pledging wallet is checked (`unknown-wallet`, `wallet-frozen`, `retirement-wallet`, `wallet-archived`) and must hold the pledged sats; loan and price up to $1 trillion, LTVs 0.01%-100% with the margin call at or below liquidation; any figure that would not be a safe integer is refused (`invalid-input`), never rounded. LTV and prices are half-up; BTC sold at liquidation is rounded up to whole sats (capped at the pledged coins). Heads-up when a sale adds more than $1,000 of tax.
17. **Lot identity = root of the version chain.** A lot created by an entry keeps the id of that entry's first version through edits, conflict resolution and delete-then-restore; move pieces stay `<moveRootId>:<sourceLotId>`. `originEntryId` names the version actually applied. A later sale's saved picks keep working and use the corrected cost.
18. **No throws from user input.** Besides the per-entry limits (Decision 2), replay keeps running totals of sats acquired and of cents entered (costs, values, giver costs, proceeds, gift values, fee values). An entry that would push either past 2^52 is an `out-of-range` error and skipped, so every sum the engine reports stays an exact safe integer with room to spare. Derived figures that still cannot be represented (an average cost per BTC from one sat bought for $1,000,000) are `null`.
19. **Tax tables:** a year before the earliest table uses the earliest; a year after the latest uses the latest; `fellBack` is set and the note names the table used and whether it is the earliest or latest.
20. **Rounding** is half away from zero, symmetric for negatives (−0.5 → −1), everywhere "half-up" appears (`divRoundHalfUp`, `mulDivRoundHalfUp`, `splitProportional`). Kept deliberately: it treats gains and losses alike, and splits still add back exactly because the remainder goes on the last piece.
21. **Losses from past years are kept per tax year.** `carryforwardByYear` (`"2026": { st, lt }`) holds each year's figure; a settings patch writes only the years it names, so saving next year's figure (closing a year) never changes an earlier or closed year's carry-in, and `carryforwardFor(settings, year)` reads that year only (zero if none). The single-year fields still work: a patch with `carryforwardStCents`/`carryforwardLtCents`/`carryforwardYear` writes the amounts into its year (the patch's year, else the one already saved, else the entry's own tax year: entries written before the year field existed apply to the year they were saved in, the same for Tax season and the planners). The single-year fields keep the latest figure saved. Saving the amounts in Settings stamps the current year. Closing a tax year offers the losses it leaves for the next year and saves them with `carryforwardYear: year + 1`. Tax season and Sell show a one-line prompt when the saved year is earlier than the year shown. The user-facing name is "losses from past years"; the field names keep the code word.
22. **Loans are tracking only** ([loans-spec.md](loans-spec.md)). Loan records replay after every coin entry and read the finished lots without changing them; they cannot replace coin entries (or be replaced by them), are exempt from closed years, and a property test checks that adding or removing them leaves lots, holdings and every year summary unchanged. Coins are traced from their origin lot (`originLotId`: the last part of a moved piece's id).
23. **Retirement purchases are their own entry kind** (`retirement-buy`, state `retirementBuys`), so nothing that reads lots can see them. A retirement purchase only replaces a retirement purchase (and a taxable entry never replaces one): `cannot-replace`. They keep their own running range totals, so they can never push a taxable entry out of range. A retirement purchase sharing an id with a taxable entry is dropped (`duplicate-id`) and the taxable entry stays, as with loan records. Exempt from closed years (no tax effect). Retirement purchases and balance notes are refused after the wallet is archived (`wallet-archived`), judged at the purchase's time in replay order (an archived wallet keeps its earlier purchases). Open question: sales and withdrawals inside a retirement account.
24. **Gifts default to lowest cost first.** A gift is not a sale, so the giver's choice of lots never changes this year's tax; it decides which cost the giver keeps. Giving the lowest-cost lots keeps the higher-cost ones for a later sale (less tax then), and the recipient takes over the giver's cost and dates (IRC §1015). A gift of a lot worth less than its cost loses that loss: the giver cannot deduct it (a gift is not a sale) and the recipient's basis for a loss is the value at the gift (Treas. Reg. 1.1015-1(a), the dual-basis rule already used for gifts received). Lowest cost first puts every lot at or below the gift's value ahead of every lot above it, so the default never gives below cost when lots at a gain or break-even can cover it; when they cannot, the rest comes from the smallest loss per sat and the app says so in one line. No documentation-tier preference (unlike lowest tax, where it stops estimated costs being leaned on to cut tax): a gift cuts no tax now, and the lot goes to the recipient with its tier as it is. Picks are saved with the gift as for every disposal, so the order only ever affects new gifts; the Gave tab's "I bought it to give" saves a `buy` and then, one second later, a `give` whose single pick is that purchase's lot (no strategy involved), with the value defaulting to what was paid for the part given. Sales, spending, moves and losses keep oldest first. Wallet by wallet (Rev. Proc. 2024-28) as for every disposal.
