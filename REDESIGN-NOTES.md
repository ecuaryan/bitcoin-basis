# Redesign notes: loan page ("Where it stands") + payoff rounding

For the integrator: move the text below into CHANGELOG.md and docs/design.md, then delete this file.

## Proposed CHANGELOG entry (under Unreleased)

### Changed (loan page)

- **The loan page opens with the loan card's top half**: "Gain or loss after interest" with its math (worth − cost − interest), the break-even gauge with today's price, and the four figures (Owed, Bitcoin it bought, Interest paid, If paid off today), each "?" beside what it explains. Once coins have been sold or paid back, a line under the math gives the whole result.
- **Details** replaces the long list of rows: three short groups. The loan (owed now with interest and what it includes, borrowed in all and where it went, less what was paid back, the rate with "(variable)" and its history, and when the statement closes), Interest (interest paid and through when; how much of it is charged to the purchases, and what the rest was on: money drawn for other things, or days before any purchase), and The Bitcoin (bought, still held and where the rest went, sold or spent for, paid back by a frozen platform, the whole result). "Rate changed" sits under the rate; the separate Rate card is gone.
- **Purchases is a table**: each purchase's coins still held, what they cost, what they are worth now, the gain or loss before and after its share of the interest, and a Total row that is exactly the result at the top. On a phone: Cost, Now and After interest (with the interest under it), plus one line that adds it up.
- **The result after interest shows cents**, on the Holdings card and the loan page alike, so the two and the purchases' Total always agree.

### Fixed

- **"If paid off today" is never shown better than it is.** A shortfall now rounds up and a leftover down at 4 decimals (it rounded to the nearest, so a shortfall could look up to 0.00005 BTC smaller and a leftover that much bigger). In dollars it rounds the same way to the cent; in sats it is exact. A shortfall of a few sats shows 0.0001 BTC; a leftover too small for 4 decimals keeps all 8.

## Proposed docs/design.md text

Replace the **Loan card** bullet's hero sentence ("whole dollars rounded down (`floorDollars`)") with: "the hero in cents (`HeroMoney`: signed, gain or loss color, the cents a size smaller), the same figure as the loan page and its purchases' Total". Replace "If paid off today (BTC left over in green or short in red …)" with "If paid off today (`PayoffSats`: BTC left over in green, rounded down, or short in red, rounded up; `Amount round`) …". `floorDollars` and `IncludingInterest` are gone; the card's top half is `LoanTop`.

Add after the Loan card bullet:

- **Loan page** (`screens/loans/LoanPage.tsx`): header (back, name, "Loan · tracking only"), then "Where it stands": a container card with `LoanTop` (the card's top half) plus its "?"s (≈, break-even, paying it off today; panels open under the part they explain) and, once coins were sold or paid back, "Counts the X BTC still held. With what already left, the whole result is …". Then **Details** (`loan-details.tsx`): one card, `h2` "Details", three small uppercase `h3` groups, each a `dl` labeled The loan / Interest / The Bitcoin; a fact is a label left, value right, and an optional muted line under both. Every sub-line adds up from engine figures (Borrowed in all: for purchases + for other things, less paid back = owed or paid in advance; Charged to the purchases: the rest is `interestNotOnPurchasesCents`, worded for draws for other things and for `unallocatedInterestCents`). The rate's history comes from `loan.rates` (`rateHistory`). Then **Purchases** (`loan-purchases.tsx`): the lots-table pattern (one grid, subgrid rows, visual-only header, screen-reader words in each cell, each row a button that opens the purchase). Wide (38rem of card): Purchase (date, held BTC "held of" bought, wallet) · Cost (held cost, "of" full cost) · Now · Gain or loss · Interest (≈ its share) · After interest. Narrow: the purchase on its own line over Cost · Now · After interest (≈ interest under it), and a line "± before interest, less interest = ± after interest". The Total row is the engine's summary (held cost, value, up/down, interest on purchases, gain after interest), which the rows add up to exactly; it is the hero's figure. Five rows, then "Show all N purchases" (the Total then says "All N purchases"). Phone order: Where it stands, Details, Purchases, Payments, Statement check, Settings. Desktop: Where it stands full width, then two columns (2:3): Details, Statement check, Settings | Purchases, Payments.
- In rule 4, add: "A short BTC figure that must not look better than it is rounds one way (`Amount round="up"` for a shortfall, `"down"` for a leftover; USD to the cent the same way; sats exact)."

## Choices

- **Rounding of the hero: cents on both** the Holdings card and the loan page (not whole dollars). The purchases table's Total must tie to the hero exactly, and whole-dollar rows would not add up to a whole-dollar total. The holdings visual baselines were refreshed for this.
- Engine: added `LoanSummary.interestNotOnPurchasesCents` (= interest paid − interest on purchases; other draws' shares plus unallocated), with tests and a line in docs/loans-spec.md, so the page does not subtract money itself.
- Per-purchase interest shares carry ≈ (they are split by time borrowed); the Total's interest carries ≈ only when the engine says the purchases' interest is estimated.

## Unrelated problems noticed (not fixed)

- `purchaseWorth` in `lib/loans-view.ts` is no longer used by the app (only its own test).
- The card's "Interest paid" tile still computes "not paid yet" as owed now − principal in the component (it equals `unpaidBilledInterestCents + accruedInterestCents`; an engine field would be cleaner).
- The statement closing day now appears in Details and in Settings (Settings keeps its history line).
