# Changelog

## Unreleased

### Changed (Holdings order and the demo link)

- Holdings runs most looked-at first on phone and desktop: worth and gain, anything to do, recent purchases, loans, the taxable and retirement split, the taxable figures, wallets, then the stack by year, the average-cost chart, retirement and documentation. The separate "Taxable" heading is gone; the Taxable row now jumps to the taxable figures card.
- `/demo` is a link to share: it opens straight into the made-up demo (in the browser's memory only, never sent to the server). To show someone the demo on your own phone, the lock screen has "Show the demo", and `/demo` with records open locks them first. Exit demo goes back to the lock screen; the demo never sits beside open records.
- The demo is smaller and simpler: 2.1 BTC in all (1.85 taxable in Cold storage and Strike, 0.25 in a retirement account), about 50 purchases instead of 186, no frozen platform (Harbor Earn) and no River wallet. Same loan, gift in and out, spend, past losses and 94% documented.
- Loan page purchases use the Recent purchases table: Date · Paid · Bitcoin (@ cost per BTC) · Now (gain, %), then the wallet on its own line and a line with the purchase's share of the interest and its gain after interest. A long wallet name is cut short and a long interest line wraps, so the figures never run off the card. On a card 56rem and wider, Interest and After interest are columns. The Total row is still the big number at the top.
- For my CPA opens in the same tab (Back to Tax season returns). In a new tab it started locked, so from the demo it asked you to sign in and then showed your own records.
- Your stack, by year bought shows each year's worth now and its gain or loss with percent, so you don't have to open each year. Phone: the year and its BTC on the left, the bar, then the worth over the gain. Desktop: under each year's column. Worth and gain are in whole dollars that add up to the hero's.
- Loan card: the ≈ in "Left over after paying ≈ $…" stays with its amount, so hiding amounts no longer rewraps the line.

### Added

- **"I bought it to give"** on the Gave tab: for the buy-then-send routine (a birthday, a holiday). Switch it on and the purchase fields (amount, wallet, total paid with fees, when, defaulting to now) sit above the gift (who it's for, an optional note). One review shows both, under Purchase and Gift, and one Save logs a purchase and, a second later, a gift of exactly that purchase's lot: all of it by default (give less under More details and the rest stays in the wallet), worth what was paid unless you change it, so the gift is never below cost by default. Each entry is its own row ("Bought", "Gave to Mom") and can be edited or removed as usual. The switch starts on when your last gift was logged this way.

- **Retirement purchases**: a retirement wallet can now record purchases (date, BTC, cost with fees), edited and removed like any entry. Its page lists each purchase with its cost, worth now, gain or loss and time held, and the wallet shows its total cost, gain and average cost. A new entry kind, `retirement-buy`, kept apart from lots: it never reaches gains, Form 8949, tax estimates, the planners or loans (a property test checks this).
- **Balance notes check the purchases**: with purchases logged, a retirement wallet's balance is their total; its latest balance note is checked against the purchases up to that date and any difference is shown. Wallets with notes only look as before.
- **All your Bitcoin** at the top of Holdings: with a retirement wallet that holds coins, the hero is everything you have ("All your Bitcoin is worth", total BTC, and the unrealized gain), with a split card right under it: a thin bar and two rows, Taxable (counts for tax) and Retirement (kept apart from tax), each with its BTC, worth and gain. Taxable jumps to the taxable figures, which follow under a small "Taxable" label exactly as before; Retirement opens the retirement wallet (or the Held apart list when there are several). Without retirement coins Holdings looks as it did. The separate All your Bitcoin card and the "with retirement" line are gone.
- Hide amounts now also hides gain percentages and the cost-per-BTC hint while logging a purchase.
- **Import and export**: rows in the coins spreadsheet whose wallet is one of your retirement wallets become retirement purchases (leave tier and the loan columns empty on those rows; if the wallet is new, the preview asks whether it is a retirement account and never assumes it). The spreadsheet export includes them, and the backup file carries them with their history.
- The demo's retirement account has three made-up purchases.

### Changed (colors)

- **Gains are green.** Every gain, "left over" and price-above-your-average figure (and the 24-hour "up" arrow) is now a soft green instead of orange, so gains and losses are easy to tell apart at a glance. Orange stays the app's accent.
- **Losses are a true red** instead of a pinkish one, also used for errors.

### Added (Holdings)

- **Recent purchases** on Holdings, under the chart and your retirement accounts: your latest five purchases, newest first, in the same table as a wallet's lots (Date, Paid, Bitcoin with the cost per BTC, Now with the gain or loss and its percent), with the wallet on each row. It counts logged purchases, retirement purchases (tagged Retirement) and imported lots that cost something, dated when they were bought. "Show 10 more" adds rows; tap one to open it. On desktop it spans the page, one line per purchase.

### Changed (loan page)

- **The loan page opens with the loan card's top half**: "Gain or loss after interest" with its math (worth − cost − interest), the break-even gauge with today's price, and the four figures (Owed, Bitcoin it bought, Interest paid, If paid off today), each "?" beside what it explains. Once coins have been sold or paid back, a line under the math gives the whole result.
- **Details** replaces the long list of rows: three short groups. The loan (owed now with interest and what it includes, borrowed in all and where it went, less what was paid back, the rate with "(variable)" and its history, and when the statement closes), Interest (interest paid and through when; how much of it is charged to the purchases, and what the rest was on: money drawn for other things, or days before any purchase), and The Bitcoin (bought, still held and where the rest went, sold or spent for, paid back by a frozen platform, the whole result). "Rate changed" sits under the rate; the separate Rate card is gone.
- **Purchases is a table**: each purchase's coins still held, what they cost, what they are worth now, the gain or loss before and after its share of the interest, and a Total row that is exactly the result at the top. On a phone: Cost, Now and After interest (with the interest under it), plus one line that adds it up.
- **The result after interest shows cents**, on the Holdings card and the loan page alike, so the two and the purchases' Total always agree.

### Changed (entry lists)

- **Entries read as a table on desktop.** Records' recent and all entries, and a wallet's Entries, line up in columns on a wide card: Date (month and day over the year), What (title and tags over a muted note), Wallet (not on a wallet's own page), Bitcoin (all 8 decimals, signed in or out, a move's network fee under it) and Dollars (with what they were: paid, received, worth then; "—" when there are none). On a phone the rows stay compact and now show the full 8-decimal Bitcoin and say what the dollars were ("$680.00 paid", "$920.00 worth then").
- **A move on a wallet's page shows what left that wallet.** "Moved to Cold card" shows the coins plus the network fee (−0.0500 1840), with "0.0500 0000 arrived · fee 0.0000 1840" under the title, so the rows add up to the wallet's balance; on the wallet the coins reached it reads "Moved from Strike" (+ what arrived). A payout out of a frozen wallet shows unsigned on that wallet's page ("Paid out to …"), since it does not change that wallet's coins.
- Retirement purchases in entry lists read "Bought" with the Retirement tag.

### Changed (Sell)

- **Sell: plan cards you can read straight across.** Every plan card (Oldest first, Lowest tax, Lots you picked) shows the same rows in the same places, lined up across cards: the tax as the big number ("Tax this adds", or "Tax this saves" in green) with "Federal $X + state $Y" under it, what you keep after tax with its math ("$23,703.10 sale − $0.00 tax"), short-term, long-term, losses left for next year, the share on Estimated or Unknown cost, and the lots used. Empty figures ($0.00, 0%) are muted. The plan the planner prefers gets a small pill ("Least tax", "Saves the most", or "Keeps more losses" when the tax is the same). Under the cards, "Lots used in …" lists the chosen plan's lots (bought, term, Bitcoin, cost, sold for, gain or loss) with a Total row that matches the card's short-term + long-term. A third plan (after picking lots) sits full width under the two on a phone. Federal and state tax now always add up to the total to the cent (the engine splits the total by largest remainder).

### Changed (Holdings, taxable)

- **Wallets are one aligned table** on phone and desktop: Wallet (name over type), Bitcoin (all 8 decimals, its worth now under it), and Gain or loss (with the percent under it), so the figures line up down the page. The balance check ("Confirmed Nov 2, 2026", "Needs a check" in amber) gets its own column on a wide card and a line across the row on a phone. A Total row adds up the counted wallets, in whole dollars that match the unrealized gain; frozen wallets follow it, marked "Not counted". On desktop the Wallets card is two thirds of the row, beside "How well it is documented".
- **The taxable figures say exactly what they are.** One card leads with "Unrealized gain on taxable Bitcoin" (or loss) to the cent, with its percent and its math (worth − cost). Under it: Taxable Bitcoin (in how many wallets, of how much in all), Taxable average cost per BTC (cost ÷ BTC, beside the average of all your Bitcoin, so the two never look like a contradiction), and Losses from past years (short-term and long-term, or a reminder when only an earlier year's are saved). Without retirement coins the labels drop "taxable".

### Changed (Tax season)

- **One "Your 2026 result" card** replaces the two plain row cards. It leads with the net gain or loss after losses from past years, with the math under it (this year − losses from past years), then says what it means in words: "No tax on Bitcoin gains for 2026" with how much lowers your other income and how much carries into next year, or "Taxed on $X of gains" split into short-term (taxed like wages) and long-term (lower rate), as Schedule D nets them. Four labeled figures follow (Short-term, Long-term, Used against other income with the yearly limit for your filing status, Losses left for next year), then "What happened in 2026" with plain counts ("1 purchase paid in Bitcoin", "12 tiny sales"). "How it nets out, for Schedule D" opens the short-term and long-term after past losses.

### Changed (loan card)

- **The loan card on Holdings is redesigned.** Its big number is now named "Gain or loss after interest" (on the loan page too) and shows its math underneath: worth − cost − interest. A small gauge shows today's price against your break-even (red below, green above, with how far off it is), and four labeled figures replace the lines of text: Owed (with a bar for how much of the credit line is used and what's available), Bitcoin it bought, Interest paid (with about how much is not paid yet), and If paid off today (how much Bitcoin would be left over or short, and the total owed with interest). The rate shows beside the loan's name. Phone shows the figures two by two; desktop puts the number beside the gauge and the four figures in a row. Hide amounts hides the gauge's dot along with every figure.

### Changed (wallet page)

- **Lots are a table**: Date, Paid, Bitcoin (with the cost per BTC under it), and Now (with the gain or loss and its percent under it). Short-term lots come first with the day each turns long-term, then long-term lots, each newest first. A Total row adds up every lot in the wallet (what you paid, BTC at your average cost, worth now, gain and percent). Loan and tier tags show only where they apply ("Documented" is no longer repeated on every row). Tap a row for where it came from, the exact cost per BTC and the receipt. On desktop the table spans the page, one line per lot, with Cost per BTC, Gain or loss and Term as their own columns.

### Changed (Holdings)

- **Holdings reads top to bottom as "all of it", then "taxable"**: the price chart, your retirement accounts and loans now sit with the whole picture, above the Taxable label; under it are only the figures that count for tax (average cost, unrealized gain, losses from past years), your wallets and how well it is documented. Same order on phone and desktop.
- **The chart's average-cost line has a switch**: All (the average of all your Bitcoin, the default), Taxable or Retirement. The line under the chart says which average it is. Shown when you have retirement coins with their cost logged.
- **"Held apart" is now "Retirement"**: one card for your retirement accounts (worth, cost and gain each). Frozen wallets moved into Wallets, listed last with their amount muted and "Frozen, not counted".

### Fixed (independent review)

- **Loans:**
  - Paying a loan off in the middle of a statement cycle no longer leaves made-up interest owed.
  - Managing a loan's purchases no longer breaks a purchase that a spreadsheet import split across rows.
  - Removing a purchase paid with a loan no longer lowers what you owe; the removal says which loan and draw paid for it.
  - Interest paid before you started tracking a loan no longer shows as unpaid, and Tax season lists it on its own instead of in one year.
  - The statement check matches correctly after you overpay.
  - The payment pre-fill no longer asks again after a statement-day change.
  - Changing a loan's day count no longer fails when another loan has its old name.
  - The "Including interest" figure rounds down, so a loss is never shown smaller than it is.
- **Tax and gifts:**
  - Gifts before 2025 are checked against that year's own per-person limit (for example $18,000 in 2024), not 2025's $19,000.
  - Selling coins from a gift worth less than the giver's cost now shows "confirm with your CPA" in the year you sell.
  - Tax season and the CPA summary list each charity gift with its date, value, deduction and holding period.
  - Gift notes say when coins were inherited (always long-term).
  - On a phone, Tax season no longer shows a back arrow to Records.
- **Import and screens:**
  - Importing a spreadsheet again after a failed or interrupted import no longer adds the same lots twice; rows already in your records are skipped and counted.
  - After you change a purchase's date, its coins are offered for sales from the new date.
  - A save that fails (for example because your records locked) now says why instead of doing nothing.
  - Long entry titles wrap instead of being cut off on phones.
  - Phones show when saved changes haven't been uploaded yet, as desktop does.
  - Records › Closed years lists the newest year first.

### Security

- **Lock locks every window**: pressing Lock in the installed app now also locks a browser tab open on the same device, and the other way round (before, the other window kept showing your records until its own auto-lock). Idle and background locks still stay in their own window.
- **Past-price lookups send the hour only**: the app rounds the time down to the hour before asking for a past price, so the exact time of an entry never leaves the device.
- A recovery-code version number from the server that jumps far beyond any real rotation can no longer stall the app or bloat its local record.

### Changed

- **Gifts use your lowest-cost lots first** (within the sending wallet), instead of oldest first: you keep your higher-cost Bitcoin, so a later sale is taxed less, and the person you give to takes on your cost. The Gave tab says so in one line beside the choice. Lots that cost less than they are worth that day always come first, so a gift only uses a lot below cost when the others cannot cover it, and then it says so ("Nobody can claim the loss on that part"). Pick lots is still there; ticked lots are used lowest cost first too. Sales, moves and losses keep oldest first. Engine: `lowestCostOrder`, `lowestCostFirst`, `satsGivenBelowCost`. Editing a gift without changing its amount or lots keeps its saved split exactly.
- **Gift rows read naturally**: "Gave to Mom" with "Strike · Nov 21, 2026" under it (was "Gave" with "Strike · to Mom").

- **A price chart with every day in it**: the Holdings chart now draws one point per day for the last three years (it had about 13 quarterly points, so peaks went missing), and marks the highest price with a dot and its date ("High $126,073 · Oct 6, 2025"; Hide amounts masks the dollars). The line is gently smoothed at phone width without hiding the high; scrubbing steps day by day (Page Up/Down jump about a month). The history comes from a new Worker route, `GET /api/price/series?days=`, which asks mempool once for its whole history, keeps each day's last and highest price in integer cents, and caches the result an hour; the app keeps a copy for the hour (`bb.price-series.v1`). With an older server, the chart falls back to the quarterly lookups. The demo and the test build have a made-up daily series.
- **A calmer price line**: the red "Price may be out of date" is gone. Holdings shows a small refresh button beside the price (it spins while it loads). When the price shown is more than 5 minutes old, or is a kept price the server sent, its time follows it quietly ("· as of 3:12 PM", amber after 30 minutes); a current price shows no time. Sell shows the same time beside its price. A failed refresh keeps the price it had, and the app tries again after 15 s, 30 s and 60 s, then every minute (it used to back off up to 15 minutes).
- **The live price rides out a flaky source**: the Worker asks mempool once more after a failure, then Coinbase's public spot price (`COINBASE_URL`, `off` to skip it), and keeps the last good price for 6 hours. With all of them down it answers that price marked `stale` with the time it is from, and a 502 only when it has none. `/api/price` now also says when the price is from (`asOf`) and where (`source`). Historical prices still come from mempool alone.
- A purchase logged "now" uses the live price only while it is recent; a kept price from hours ago is no longer taken as the price now, and the note names Coinbase when the price came from there.
- **"Unrealized" instead of "on paper"**: Holdings' gain card is now "Unrealized gain", with a "?" that says what it means (what you would gain if you sold today; no tax is due until you sell), and wallet pages say "unrealized" too.

- **"Lots" instead of "coins"** wherever a row is Bitcoin acquired at one time for one cost: the wallet page ("Lots, newest first"), the year sheet ("2023 lots"), the sale picker ("Pick lots", "Tick the lots to sell. The last one is trimmed to fit.", "184 lots ticked"), Sell ("Lots used", "Lots you picked"), the Log forms ("Which lots", "Pick lots"), Review, entry details and the import preview ("5 lots", "1 lot paid with a loan"). One "?" says what a lot is where lots first appear: "A lot is Bitcoin you got at one time for one cost, usually one purchase. Taxes are worked out lot by lot."
- **Loan page: Bought and Still held.** "Bought" is now everything the loan's purchases bought (new `loanSummary().boughtSats`); when some has left or is frozen, "Still held" follows with a note saying how the rest left ("0.0037 6981 BTC later given away, sold, spent or paid as network fees", only the ways that apply). The break-even and "If you paid it off today" "?" say they use the Bitcoin still held, and what interest is in them.
- **Back goes back.** The back button on a wallet, a loan and a Records view now goes back in history when the app brought you there, so you return to the page you came from at the place you left it (as the browser's and phone's back already did); opened directly, it still goes to Holdings (or Records).
- **Your stack, by year bought is all your Bitcoin.** Each year's bar and BTC total now include that year's retirement purchases (by purchase date), as their own segment in the Retirement colour with a "Retirement" legend entry, so the years add up to the BTC at the top. A retirement wallet with balance notes only has no purchase dates; it is named in one line under the years ("Not in a year: 0.1200 BTC in retirement, because no purchases are logged for Old IRA.") instead of being left out. The year sheet ("2024 lots") lists retirement purchases with the lots, newest first, marked "Retirement", with worth and gain, and cost and receipt when opened (no tax tier). The card moved above the "Taxable" label on phone and desktop. Its documented share stays about the taxable lots and says so ("Taxable: 94% documented."); the legend no longer repeats the tier percentages on phones (the documentation card has them), so phone and desktop show the same. "How well it is documented" says "Taxable Bitcoin only." when a retirement wallet holds coins.
- **Retirement has its own colour**, a soft slate blue (`--color-retire`, #8FB3D9), in the split card's bar and swatch, the stack and the year sheet. It used cream, which already means the Reconstructed tier.

### Removed

- **Money in and out** is gone from Holdings, and with it the Settings field "Dollars you put in before using this app". The time zone stays under Your records.
- **Giving** is gone: the Settings group, the Records tile and page, and the "Giving on this sale" line on Sell. Logging Bitcoin you gave away (the Gave tab) is unchanged. Records written by older versions (giving settings, giving payments, dollars put in before) still restore from a backup and replay without errors; they are kept, ignored and not listed. The engine no longer has `givingDue`, `givingOnSale`, `SalePlan.givingCents`, `holdings().moneyPutInCents`, `yearSummary().givingPaidCents` or `LedgerState.buyCostCents`/`givingPaid`.

### Fixed

- **"If paid off today" is never shown better than it is.** A shortfall now rounds up and a leftover down at 4 decimals (it rounded to the nearest, so a shortfall could look up to 0.00005 BTC smaller and a leftover that much bigger). In dollars it rounds the same way to the cent; in sats it is exact. A shortfall of a few sats shows 0.0001 BTC; a leftover too small for 4 decimals keeps all 8.
Accuracy fixes from an independent audit: every number accurate and labeled exactly.

- **Owed now counts interest billed but not paid.** When a statement's interest was paid only in part, "Owed now" left out the rest. It now adds what is left of the cycles your payments cover (their interest less what you paid for them; paying a past-due remainder with the next statement makes up for it) to the interest since. A $10,000.00 line at 7.30% with January's $62.00 interest and $40.00 paid, seen on Feb 20, 2025: $10,040.00 before, now $10,062.00, "Includes about $22.00 interest billed but not yet paid and about $40.00 since Feb 1, 2025, not billed yet". Interest since the last payment says "not paid yet" when a statement has closed on it. A history paid in full is unchanged. Engine: `LoanSummary.unpaidBilledInterestCents`, `accruedBilledThrough`.
- **Tax estimates say when they assume $0 income.** Until wages and other income have been saved once, the "Set your … for tax estimates" prompt asks for it, the income box starts empty, and Tax season, Sell, Borrow and the Log review say "Assumes $0 other income. Set your income in Settings." A saved $0 is an answer: no prompt, no note.
- **For my CPA lists everything.** The summary's gains table and Form 8949 detail now include frozen-platform close-outs and payouts after them (as Tax season and the 8949 CSV do), "Used against other income" shows so the losses left add up, and the Term column follows the lots' holding periods (a $0 gain on long-term coins says long, not short).
- **Frozen coins are not valued.** Lots in a frozen wallet show "Frozen · not counted in what your Bitcoin is worth" instead of a worth and gain, matching the wallet header. A purchase whose coins are in a frozen wallet says how much is frozen (and its cost), not "None of these coins are left"; coins closed out on a frozen platform say so.
- **Parts add up to their totals.** Coins are valued one way everywhere: each lot (and each retirement purchase) on its own, half-up, then added. Holdings' total is now the year rows, wallets and loan purchases added up to the cent (the demo: $319,206.94, was $319,206.90). Engine: `allBitcoin(state, h, price)`, `valueOfPieces`, `worthOfPieces`, `retirementWorth`, `taxableLots`. The Taxable and Retirement rows under the total now add up to it in whole dollars (largest remainder: the dollar they fall short goes to the part closest to its next dollar; the demo shows $319,207 + $33,184 = $352,391, was $319,206 + $33,184), worth to worth and gain to gain; the taxable Unrealized gain shows the same figure as the Taxable row, and Held apart's retirement wallets add up to the Retirement row. The Holdings loan lines show cents like the loan page (Owed plus Available is the credit limit exactly).
- **Risk shares round up.** "Part of the sale uses Estimated or Unknown cost (up to N%)" and the plan's share round up (19.99% is 20%, 0.5% is 1%, never "<1%"); only all of it is 100%.
- **Never "100% documented" unless it is.** Documentation shares on Holdings and in the import preview use largest remainder (they add up to 100%), show 99% when one sat is not documented, and "under 1%" instead of 0% for a sliver.
- **Hide amounts** now also masks the percent in "Price is N% above/below break-even" (Holdings and the loan page).
- **Borrow past the lender's limits**: when the price is already past the sell line it says "The lender would already sell at this price" (was "Price could fall 0%"), and "Already past the margin call" when that is due. Room under 1% says "under 1%".
- **Savings are called savings.** Sell's plan cards say "Tax this saves $519.00" instead of "Tax this adds −$519.00" (Borrow: "Tax that sale would save"), as the Log review already did. When both choices lower this year's tax, the summary compares the savings ("Lowest tax saves $173.00 more this year than oldest first") before the losses left.
- **One average cost label each**: the hero line under all your Bitcoin reads "Average cost of all your Bitcoin: $X per BTC"; the card under Taxable stays "Your average cost".
- **Same figure, same precision**: the break-even price on Holdings shows cents like the loan page; a retirement purchase's cost per BTC shows cents like the wallet's average.
- **Small amounts are never zero**: a gain or loss under $1 shows its cents ("+$0.40", never "+$0" or "down $0"), and a few sats in a 4-decimal list show all 8 decimals ("0.0000 4999") instead of 0.0000.
- **The price change is the past 24 hours**, labeled "in 24h" (was "today"); it rounds half away from zero the same for a fall as a rise, and a change that rounds to 0.0% is plain, with no arrow or color.
- The 1099-DA list uses each entry's local date for its year (a purchase at 11:30 PM on Dec 31 counts in that year). Holdings' "Losses from past years" asks you to update them when only an earlier year's are saved, as Sell and Tax season do. An archived wallet that still holds coins shows their worth and gain. Time held counts days until two whole months ("Held 60 days", then "Held 2 months"; it used to go from "59 days" to "1 month").
- Cost per BTC on a lot, and the hero's average cost, show "—" instead of failing when a figure is too large to represent; a dollar amount typed at an absurd price is refused instead of failing.

- **Percentages round to the nearest whole percent** (19.9% shows as 20%, not 19%). They used to drop the fraction, so a gain could look smaller than it is.
- **Phone shows what desktop shows on Holdings**: the chart's title, its 3-year span and the average cost on the dashed line, the stack's documentation hint, and the How well it is documented card.
- The Taxable and Retirement rows show their gain percent on phones too; with Hide amounts the percent's digits are masked instead of removed, so nothing moves.
- **Import from a spreadsheet** is short and scannable: one line, two buttons (Download the template, Choose your spreadsheet), and a column-by-column table instead of a paragraph.
- **Choosing Idaho (or Single) now saves.** A first choice equal to the built-in default was dropped as "no change" while the screen said Saved; it is now recorded, and Saved only shows when something was written.
- Holdings shows the **average cost of all your Bitcoin** (taxable and retirement) under the total, when every cost is known.
- Reminder banners on Holdings no longer stretch across wide screens.
- The fingerprint on the Unlock button is a clearer, filled glyph (Material Design, Apache 2.0; see THIRD-PARTY-NOTICES.md).
- **Newest first**: a wallet's coins, a retirement wallet's purchases, a loan's purchases, a year's coins, and income on Tax season now show the latest at the top, like entries and payments already did. The coin picker for a sale keeps oldest first, the order coins are used.
- **Every date shows its year** (Oct 23, 2026), everywhere, and lines with a date wrap instead of cutting it off.
- **Icons where they help**: the desktop Hide amounts and Lock buttons, Records tiles, Settings sections, the entries search, and actions with a clear symbol (add, import, download, print, passkey, edit, remove, check now, forget this device). One style and size throughout; see docs/design.md.
- The desktop sidebar has icons, matching the phone's tabs, so Settings (the gear, at the bottom) is easy to spot.
- Paragraphs stop at about 70 characters, so text stays easy to read on wide screens.
- **First run, import only**: “You're all set” and the empty Holdings screen now offer “Import a spreadsheet or backup” next to adding a wallet, so you can start from a file without creating a wallet by hand. Empty-tier rows explain what to do.
- **Recovery code groups are numbered** on the printed kit, and the check step shows which block is group 4 (the fourth of six) and says to look where you saved it: your password manager or the kit.
- **Recovery code from your password manager**: where the browser supports it (Chrome, Edge, Android), “Fill in from my password manager” puts in the saved recovery code, so you don't type 30 characters. The field still works with ordinary autofill elsewhere.
- **Emergency kit**: stays on one letter page with many wallets (a print test checks six wallets, a long name and a code). The square code now only opens the app (the recovery code is typed), so using the kit no longer puts the code in browser history or asks for a new code and a new kit. The yearly test instructions moved off the paper; the app still reminds you. A note for the tax preparer appears when there are retirement wallets. Toasts no longer print.
- **Adding a device whose passkey already syncs there**: "Add a passkey on this device" no longer fails when the passkey from your other device is already on this one (Google Password Manager, iCloud Keychain, a password manager). The app uses that passkey instead of making a second one, after checking that it opens these records. If it can't unlock records on this device, the app says so.
- **Make a new recovery code without a passkey on the device**: the sheet now says a passkey is needed first, offers to add one there, then makes the code. Errors show inside the sheet instead of behind it.
- After opening your records from the kit's QR code, the offer to make a new recovery code waits until this device has a passkey.
- "I already use Bitcoin Basis" leads with "Use my passkey"; when no passkey comes up it points to the recovery code field. Passkey errors now say what went wrong.

## v1.0.0

First release. A self-hosted, end-to-end encrypted Bitcoin cost-basis app on a free Cloudflare account.

### Features

- **Engine**: exact integer math (sats and cents, no floats), lot tracking per wallet, cost basis, and a written spec (`docs/engine-spec.md`) the tests are built from.
- **Encrypted sync**: records are sealed on your devices; the Worker and the R2 bucket only ever hold fixed-size ciphertext. Append-only, conflict-free sync between devices, with a daily backup to a second bucket.
- **Passkeys and recovery code**: sign in with a passkey on each device; a 30-character recovery code restores everything on a fresh device and can be rotated (the old code stops working).
- **Loans**: track money borrowed to buy Bitcoin, link purchases, log payments (interest and principal), check against a statement, rate changes, and see break-even with interest paid.
- **Tax season**: realized gains and losses, holding periods and year-end figures.
- **Giving**: gifts and donations with their cost basis and holding period.
- **Import and export**: CSV import with a preview and a full export.
- **Emergency kit**: a one-page printable sheet so someone you trust can get in if you cannot.
- **PWA**: installs on a phone or desktop, works offline, and unlocks with Face ID, Touch ID, fingerprint or screen lock.
- **Open verification**: reproducible builds with Subresource Integrity, `dist-hashes.txt` attached to each release, `tools/verify-deployment.mjs`, and a daily check that the live app still matches its source.

### How it was verified

- 1,081 unit and integration tests in 88 files (`npm run check`: typecheck, lint, tests with coverage) and 286 Playwright end-to-end tests (desktop and phone).
- Mutation testing of the engine: 93% mutation score (Stryker).
- Four security reviews and three accuracy reviews of the engine against the spec, with every finding fixed or recorded.
- A usability test with first-time users, and the fixes that came out of it.
- Live tests against a throwaway Cloudflare deployment: two devices syncing (including a loan), recovery and rotation, an opaque-server check of the bucket, and a backup drill (backup, wipe, restore, sign in again).
