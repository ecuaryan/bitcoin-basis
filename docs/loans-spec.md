# Funded by a loan: specification

Some purchases are paid with borrowed money, usually a HELOC (home equity line of credit). This part of the engine answers "where do I stand right now?" for those purchases: what was spent, BTC bought and still held, value now, interest paid, what is owed, available credit, break-even price, and how much BTC would be left (or short) after paying the loan off today.

**Tracking only.** Loan records never change lots, cost basis, gains, income or any tax figure. Replay applies them after every coin entry, and they can only read the finished lots (`engine/src/loan-book.ts`). A property test adds and removes loan records from random histories and checks that lots, holdings and every `yearSummary` stay identical.

Not tax advice. Estimates are labeled as estimates.

## How US HELOCs charge interest (research)

| Point | Common case | Engine |
|---|---|---|
| Method | Average daily balance × daily periodic rate × days in the cycle, which equals the sum of each day's balance × daily rate. Simple interest, no compounding within the cycle. [1][2] | Sum over days of end-of-day principal × APR ÷ basis, rounded once per period, half-up |
| Daily rate | APR ÷ 365 for most lenders; some use ÷ 360 [1][3] | `dayCount`: `actual/365` (default) or `actual/360` per loan |
| Rate | Variable: a public index (usually the WSJ prime rate) + a fixed margin; the rate can only move with an index outside the lender's control; the disclosure states how often it can change and any caps [4][1] | Rate history: each rate applies from its effective date (`rateFrom`, inclusive). APR stored in millionths so prime + a margin in eighths (7.875%) is exact |
| Interest on a draw | Charged from the date the advance posts; Reg Z does not require a stated accrual date, and lenders word it "from the date of each advance" [5] | A draw is charged from its own day (it is in that day's end-of-day balance). A principal payment stops interest from its own day |
| Billing | Monthly cycles; interest is billed in arrears on the statement and due about 3-4 weeks later [1] | `statementDay` (cycle closing day, 31 = month end), with a history: a change applies from its own date. A payment's interest covers through the latest closing date on or before it (by the day in force then) unless the payment says otherwise (`interestThrough`) |
| Draw vs repayment period | Draw period: minimum payment is often interest-only (or a % of balance); repayment period: principal + interest (a % of balance or amortized). Disclosures must describe both [4][1] | No schedule is modeled: each payment records its actual interest and principal parts, so both periods work the same way |

Confirmed against the owner's private statements (numbers not in this repo): monthly interest matched daily simple interest, actual/365, on a constant principal, with a variable-rate history; the first month was small because draws came in during the month.

Sources:
1. Navy Federal Credit Union, [Managing your HELOC](https://www.navyfederal.org/loans-cards/equity/resources/managing-your-heloc.html): average daily balance × rate ÷ 365 × days; prime + margin; interest-only draw payment = the interest charge; interest paid in arrears.
2. SoFi, [How is HELOC interest calculated?](https://www.sofi.com/learn/content/how-is-heloc-interest-calculated): average daily balance, daily periodic rate = APR ÷ 365.
3. GOBankingRates, [How is interest calculated on a HELOC?](https://www.gobankingrates.com/loans/home-equity/how-interest-calculated-heloc/): some lenders divide by 360.
4. CFPB, [Regulation Z §1026.40](https://www.consumerfinance.gov/rules-policy/regulations/1026/40/): (d)(5) payment terms for draw and repayment periods; (d)(12) index, margin, frequency of changes and caps; (f)(1) index outside the creditor's control and publicly available.
5. CFPB, [Regulation Z official interpretation of §1026.40](https://www.consumerfinance.gov/rules-policy/regulations/1026/interp-40/); sample HELOC statement terms, e.g. [SCU HELOC statement back](https://scucu.com/content/docs/HELOC_Statement_Back_SCU.pdf) ("computed on advances from the date of each advance").
6. IRS, [Interest on home equity loans often still deductible under new law](https://www.irs.gov/node/55631) and [Publication 936](https://www.irs.gov/publications/p936): home equity interest is deductible as mortgage interest only when the money buys, builds or substantially improves the home; IRS, [About Form 4952](https://www.irs.gov/forms-pubs/about-form-4952): investment interest, limited to net investment income, allocated by use of the loan proceeds (Treas. Reg. §1.163-8T).

## The fewest inputs that keep the figures true

| When | Input | Why |
|---|---|---|
| Once | Loan name, current APR, statement closing day (credit limit optional) | Rate for estimates; which cycle a payment pays |
| Once, when starting mid-stream | "Interest paid so far" as of a date (a payment with only interest) | Interest paid to date |
| Per purchase | "Paid with: HELOC" (a link; draw = the purchase's cost on its date by default) | What was drawn and when |
| Each month | Amount paid and its interest part (pre-filled with the estimate; the user corrects it from the statement) | Interest paid stays exact; principal owed stays exact |
| When the rate changes | New APR and its effective date | Only the estimates use it |
| Optional, any time | Statement principal balance | Checks the records: match, or the difference |
| Rare | Money drawn for something else | So what is owed stays true |

Everything labeled exact comes only from what the user typed. The model is used for three ESTIMATES: interest accrued since the last day paid, the payment pre-fill, and each purchase's share of the interest.

## Records (entry kinds)

All amounts are whole cents; APR is a whole number of millionths (`65_000` = 6.5%, `78_750` = 7.875%, 0 to 1,000,000). Dates are local dates; records dated by `at` use their local date.

| Kind | Fields | Effect |
|---|---|---|
| `loan` | `loan` (id), `name`, `opened`, `aprMillionths`, `dayCount?` (`actual/365`), `creditLimitCents?`, `statementDay?` (1-31) | Creates the loan; its first rate applies from `opened` |
| `loan-update` | `loan`, `name?`, `creditLimitCents?`, `statementDay?`, `closed?`, `aprMillionths?` + `rateFrom?` (default: its own date) | Rename, limit, close/reopen, rate change from `rateFrom`, statement day from its own date. A later rate (or statement day) for the same day replaces the earlier one |
| `loan-link` | `loan`, `lot` (purchase lot id = root id of a `buy` or `opening-lot`), `alsoLots?` (more lots holding the same purchase, from a CSV import that split it across rows), `drawCents?`, `drawDate?` | That purchase was paid from the loan: a draw of its lots' cost on the earliest acquired date unless given. Unlink = `delete` the link |
| `loan-draw` | `loan`, `cents` | Money drawn that did not pay for a tracked purchase |
| `loan-payment` | `loan`, `interestCents`, `principalCents` (total = both; not both 0), `interestThrough?` | A payment. Interest-only: principal 0. "Interest paid so far": a payment with only interest, dated when tracking starts |
| `loan-statement` | `loan`, `balanceCents` | Lender's principal balance on that date, checked against the records |

## Formulas

Let draws be the links and loan-draws dated on or before the as-of date T, and payments those dated on or before T. Each day d has an end-of-day principal P(d) (draws on d added, principal paid on d subtracted) and a rate r(d) (the latest rate with `from` ≤ d; before the first rate, the first rate). B is 365 or 360.

- **Interest for days a..b** (both included) = round_half_up( Σ_{d=a..b} max(0, P(d)) × r(d) ÷ B ), summed exactly (BigInt) and rounded once. This is the payment pre-fill for a cycle, and matched the owner's statements to the cent.
- **Interest paid** = Σ interest parts of payments. Exact.
- **Principal owed** = max(0, Σ draws − Σ principal parts). **Credit** = max(0, Σ principal parts − Σ draws) (overpaid; a later draw uses the credit first). Exact.
- **Interest paid through** S = the latest `interestThrough` among payments with interest (principal-only payments cover no days).
- **Accrued interest (estimate)** = interest for days S+1..T (from the loan's start if nothing is paid yet), billed or not. `accruedBilledThrough` is the latest statement closing date from S+1 through T (by the statement day in force on T), or null: the accrual up to it is billed, not paid; the rest is not billed yet.
- **Unpaid billed interest (estimate)** = max(0, Σ interest for each cycle the payments cover − Σ interest parts of those payments). A cycle runs from the day after the previous distinct `interestThrough` (the loan's start for the first) through the next, each rounded once; only cycles whose `interestThrough` is on or before T count (a cycle paid ahead is not billed yet). It is cumulative, so paying a past-due remainder with the next statement makes up for the earlier cycle. 0 when every cycle was paid in full.
- **Owed now** = principal owed + unpaid billed interest + accrued interest (estimate when either interest part is > 0). The loan page labels the parts: "Includes about $22.00 interest billed but not yet paid and about $40.00 since Feb 1, 2025, not billed yet".
- **Available credit** = limit − (Σ draws − Σ principal parts), if a limit is set (negative: over the limit).
- **Statement check**: recorded = Σ draws − Σ principal parts at the end of the statement date; difference = statement − recorded; matches if 0.
- **Coins**: each linked purchase's coins are traced from its origin lot through every move (`originLotId`: the last part of a moved piece's id `M2:M1:L`). Held = open lots outside frozen wallets; frozen sats are reported separately; gone = sold, spent, fees, given (people and charity), lost, closed out. **Bought** (`boughtSats`) = everything the linked purchases bought = held + frozen + sold + other gone, exactly (a property test checks it); the app shows it as "Bought", and "Still held" with how the rest left when they differ.
- **Value now** = Σ over held lots of round_half_up(lot sats × price ÷ 10^8): each lot valued on its own, exactly as Holdings (its total, year rows and wallets: the engine's `valueOfPieces`) and "worth now" do, so the figures never differ by a cent; the purchase lines add up to the total.
- **Up/down** = value − cost of the coins still held.
- **Interest share per purchase (estimate)**: each payment's interest is split across the draws by what each generated over the days that payment covers (its period runs from the day after the previous `interestThrough` to its own): Σ end-of-day outstanding × r(d). Principal repaid is spread over the draws in proportion to what each still owes (largest remainder). A period with no balance splits by the amounts drawn by its last day; if nothing had been drawn, the interest is `unallocated`. Splits use largest remainder (exact share rounded down, leftover cents to the largest remainders, earlier first on ties): shares + unallocated = interest paid, exactly, never negative.
- **Interest on purchases** = Σ purchase shares. When every draw is a purchase this is exactly the interest paid (less any unallocated); with other draws it is an estimate.
- **Gain including interest** = value − held cost − interest on purchases. Per purchase: up/down − its share.
- **Sold portions** are reported separately (sats, their cost, proceeds); they are not in held cost or value, and their gain belongs to the tax reports. **Recovered** = what a frozen platform paid back for the coins: each closed-out piece's share of the dollars recovered by the loss date, plus its share of later payouts (split across the close-out's pieces by cost, by sats if all cost $0, half-up with the remainder on the last, as the close-out splits them). **Overall result** = value + proceeds (sales and spending) + recovered − cost of every linked purchase − interest on purchases: the whole result of borrowing to buy, counting coins sold, spent, given, lost or closed out.
- **Break-even price** = (held cost + interest on purchases) × 10^8 ÷ held sats, half-up (null with nothing held). All interest is charged to the coins still held.
- **Payoff price** = ceil(owed now × 10^8 ÷ held sats): selling every held coin at this price just pays the loan off.
- **Payoff leftover** = held sats − ceil(owed now × 10^8 ÷ price) (negative: short). `payoffLeftoverPrincipalOnlySats` uses principal owed only, like a spreadsheet that tracks paid interest.
- **Interest by year** = interest parts by the payment's calendar year (cash basis), and the purchases' share. For the Tax season CPA note: possibly investment interest (Form 4952) if traced to the investment; not deductible as home mortgage interest [6]. "Confirm with your CPA."

## Worked examples (synthetic; must match exactly)

Checked by an independent Python `Decimal` script (a plain day-by-day loop, no shared code) kept outside the repo; the engine tests assert the same numbers.

**Example L.** HELOC opened 2025-01-02, 6.50%, actual/365, limit $50,000, statement closing day 31 (month end). Four $5,000.00 buys: P1 2025-01-06 0.05000000 BTC; P2 2025-01-21 0.04807692; P3 2025-02-10 0.05154639; P4 2025-03-03 0.05813953; each linked to the HELOC. Rate 6.25% from 2025-04-15, back to 6.50% from 2025-06-01. 2025-03-20: P3 and P4 moved to cold storage, 2,000-sat fee from P4 ($1.68). 2025-05-15: 0.02 BTC of P1 sold for $2,060.00. Interest-only payments on the 20th of each month for the month before; the 2025-07-20 payment also repays $1,000.00 of principal. Statements: $20,000.00 on 2025-06-30, $19,000.00 on 2025-07-31. As of 2025-08-10, BTC $95,000.00.

| Cycle | Days | Balance | Interest |
|---|---|---|---|
| Jan 2-31 | 30 | $5,000 from Jan 6, $10,000 from Jan 21 | **$32.95** |
| Feb 1-28 | 28 | $10,000, $15,000 from Feb 10 | **$66.78** |
| Mar 1-31 | 31 | $15,000, $20,000 from Mar 3 | **$108.63** |
| Apr 1-30 | 30 | $20,000; 6.50% to Apr 14, 6.25% from Apr 15 | **$104.66** |
| May 1-31 | 31 | $20,000 at 6.25% | **$106.16** |
| Jun 1-30 | 30 | $20,000 at 6.50% | **$106.85** |

| Figure | Expected |
|---|---|
| Interest paid (through 2025-06-30) | **$526.03** |
| Principal owed | $20,000.00 − $1,000.00 = **$19,000.00** |
| Accrued (estimate), Jul 1 - Aug 10 | ($20,000 × 19 + $19,000 × 22) × 6.5% ÷ 365 = **$142.11** |
| Owed now | **$19,142.11** (estimate) |
| Available credit | **$31,000.00** |
| Statements | both match (difference $0.00) |
| Held | 0.18774284 BTC (P1 0.03, P2, P3, P4 less the fee); held cost **$17,998.28** (P4's fee piece cost $1.72; sold piece of P1 $2,000.00) |
| Value now | each coin valued on its own: $2,850.00 + $4,567.31 + $4,896.91 + $5,521.36 = **$17,835.58** |
| Up/down | **−$162.70** |
| Gain including interest | −$162.70 − $526.03 = **−$688.73** |
| Overall result | $17,835.58 + $2,060.00 − $20,000.00 − $526.03 = **−$630.45** |
| Break-even price | ($17,998.28 + $526.03) ÷ 0.18774284 = **$98,668.53** per BTC |
| Payoff price | **$101,959.21** per BTC |
| Payoff leftover | **−1,375,306 sats** short (principal only: −1,225,716) |

| Purchase | Held BTC | Held cost | Value | Up/down | Interest share (est.) | Incl. interest |
|---|---|---|---|---|---|---|
| P1 | 0.03000000 | $3,000.00 | $2,850.00 | −$150.00 | $155.12 | −$305.12 |
| P2 | 0.04807692 | $5,000.00 | $4,567.31 | −$432.69 | $141.75 | −$574.44 |
| P3 | 0.05154639 | $5,000.00 | $4,896.91 | −$103.09 | $123.93 | −$227.02 |
| P4 | 0.05811953 | $4,998.28 | $5,521.36 | $523.08 | $105.23 | $417.85 |
| Total | 0.18774284 | $17,998.28 | $17,835.58 | −$162.70 | $526.03 | −$688.73 |

Exporting Example L to the opening-lots CSV and importing it back gives the same draws, principal, interest, accrued interest, statements and interest shares.

**Example C.** A constant $40,000.00 balance, actual/365: 31 days at 6.25% = **$212.33**; 30 days at 6.25% = **$205.48**; 31 days at 6.50% = **$220.82**; the same at actual/360 = **$223.89**.

**Example P (a cycle paid in parts).** $10,000.00 from 2025-01-01 at 7.30%, statement closing day 31: January's interest is **$62.00**. After a $40.00 interest payment for that cycle, the pre-fill offers the remaining **$22.00** (never below $0.00). Seen on 2025-02-20, owed now is $10,000.00 + **$22.00** billed and unpaid + **$40.00** for Feb 1-20 (not billed yet) = **$10,062.00** (it was $10,040.00 before unpaid billed interest counted). Paying $78.00 for February ($56.00 + the $22.00) leaves nothing unpaid. With nothing paid, seen on 2025-02-20, the accrual from Jan 1 is billed through Jan 31 (`accruedBilledThrough`).

**Example F (frozen platform).** A loan-funded purchase A ($50,000.00, 1 BTC) and an unfunded B ($30,000.00) on a platform that froze, paid out $32,000.00 before the loss date and $8,000.00 after the close-out. A's share by cost: **$20,000.00** recovered, overall result **−$30,000.00**; after the later payout, A's share **$5,000.00** more and overall **−$25,000.00** (0% loan).

## Decisions

1. **Loan records are their own kinds** (the five Log tabs never change; loan actions live on the loan page). They replay after every coin entry in two passes: first `loan` and `loan-update` in timeline order (`at`, then id), so names are checked against the names in force at that moment (rename one loan, then create another with the old name: both exist; reopening into a name now taken is `loan-name-taken`); an update dated before its loan was created applies right after the creation (if no version of that loan is ever created, for example because its name was taken, the update is reported as `unknown-loan`, never dropped silently). Then draws, links, payments and statements by `at`, then id, against the loans as they ended up (so a payment logged with an early date still finds a loan created later).
2. **Unlinking is deleting the link** (no `loan-unlink` kind): one way to do it, versioned like every edit. A purchase belongs to at most one loan (`already-linked`); only buys and opening lots can be linked (`unknown-purchase` otherwise, including a deleted purchase, which leaves the link inert).
3. **Edits.** An edit is judged against the first version of its chain, even through a delete: a loan record only continues a loan chain of the same kind, and a coin entry only a coin chain (`cannot-replace`), so no coin record ever depends on a loan record or the other way round. A loan record that reuses a coin entry's id is ignored and the coin entry stays (`duplicate-id` names the loan record). A loan's id is fixed; a loan that a live record names (the latest version of a chain, not a delete) cannot be deleted (close it).
4. **Closed years do not lock loan records**: they are tracking only and change no tax result; edits stay versioned in history. The interest-by-year note for a closed year can therefore change; it is a CPA prompt, not a filed figure.
5. **Amounts** count toward the ledger's running totals (`out-of-range` past them), after every coin entry, so they cannot make a coin entry fail.
6. **APR units** are millionths, not basis points: HELOC rates are prime + a margin in eighths of a percent (7.875%), which basis points cannot hold.
7. **Rounding.** Interest is summed exactly and rounded once per period, half-up (what lenders' statements showed). Value, interest shares and principal split use largest remainder so pieces add back exactly and are never negative (half-up with the remainder on the last piece can push the last piece below zero when its weight is tiny). Sats needed to pay off and the payoff price round up.
8. **Frozen wallets.** Coins from a loan-funded purchase in a frozen wallet are reported as `frozenSats`, not held, matching Holdings.
9. **Opening-lots CSV.** Optional loan columns `funded_by` (name), `funded_by_id` (loan id), `funded_draw_usd` (this row's part of the purchase's draw: the draw split across the lots still holding its coins by cost, by sats if all cost $0, largest remainder), `funded_draw_date` and `origin_id` (the purchase). Export adds them only when some lot is loan-funded. Import matches `funded_by_id` first (so a closed and an open loan with the same name never swap), else the name (ignoring case and outer spaces, preferring open loans); the loan must be in the ledger or created in the same import preview (passed in `loans`); unknown or ambiguous names and bad amounts or dates are row errors, and loans are never created by an import. Rows with the same loan and `origin_id` become one `loan-link` (the first lot plus `alsoLots`) whose draw is the rows' draws added up (or, without draw columns, the lots' cost from the earliest date). A purchase with no coins left has no row, so export warns that the CSV cannot carry its draw; the entries JSON is lossless.
10. **Coin value** uses the same per-lot computation as Holdings and "worth now" (each lot half-up, then added: `valueOfPieces`), so the loan page and the rest of the app never differ by a cent (an app test checks the demo book).
11. **Payments in parts.** The pre-fill subtracts interest already recorded for the same cycle (same `interestThrough`) and never goes below $0.
12. **Owed now includes interest billed but not paid.** A cycle's interest is known (an estimate from the model, which matched the owner's statements) once its statement closes; when the payments for it fall short, the rest is still owed, so owed now and the payoff figures include it. It is cumulative over the covered cycles so a remainder paid with the next statement (the lender's past-due amount) is not counted twice, and never below $0 (paying more interest than the model is not a principal credit). Caveat: an "interest paid so far" payment for a mid-stream start covers the whole history; if the rates entered do not match the history (for example only today's rate), the model's interest for it can differ from what was paid. Break-even keeps interest paid only.

## Properties (fast-check)

1. Adding or removing loan records (including ones that try to replace a buy or delete the loan) never changes lots, holdings or any year summary.
2. Interest shares + unallocated = interest paid, exactly; purchase interest ≤ interest paid; yearly totals add up.
3. Principal owed and credit are never negative and never both positive; principal owed − credit = drawn − repaid; owed now = principal + unpaid billed + accrued (the day-by-day loop checks unpaid billed too).
4. Link order, link ids and link times do not change any figure.
7. Interest, accrual, owed and the pre-fill equal a plain day-by-day loop written from these formulas (random histories: leap day, actual/360, overpayment, payments before draws, many rates and statement days).
5. Payoff leftover never falls as the price rises.
6. Interest over two adjoining periods equals the whole period's within a cent.

## API (engine)

`loanSummary(state, loanId, priceCents | null, onDate)` (owed now with `unpaidBilledInterestCents`, `accruedInterestCents`, `accruedFrom`, `accruedBilledThrough`), `loanPurchases(...)`, `suggestLoanPayment(state, loanId, payDate)`, `estimateLoanInterest(state, loanId, fromDate, throughDate)`, `loanInterestByYear(state, loanId?)` with `LOAN_INTEREST_CPA_NOTE`, `loanByPurchase(state)` + `originLotId(lot.id)` for "Paid with" badges, `traceCoins(state, ids)`, `parseAprPercent` / `formatAprPercent`, `aprOn`. State: `state.loans` (`Loan`: rates, draws, payments with resolved `interestThrough`, statements).
