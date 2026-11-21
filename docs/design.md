# Design system (app/)

For agents building the remaining screens. The approved mockups are the source of truth; this file says how to build them with the pieces that exist. Tokens live in `app/src/styles.css` (`@theme`), components in `app/src/ui/`.

## Rules

1. Bitcoin orange `#F7931A` is the only accent. Amber `#FFB547` only for the gradient end, hover, active nav text and "up" arrows. No other hues. Documentation tiers use orange, cream, tan, grey (see below).
2. Every number is tabular (`font-variant-numeric: tabular-nums` is set globally). Big numbers use `font-display` (Space Grotesk); everything else Inter.
3. Money is cents, BTC is sats, integers only. Format with `lib/format.ts`; show them with `<Money>` and `<Amount>` so hide-amounts works. Never print a raw number that is the user's money.
4. Whole-dollar display rounds toward zero (never overstates a gain).
5. Hide amounts is OFF by default; only the user turns it on (the choice is remembered on that device). Anything showing the user's balances, cost, gain or income must go through `Money`/`Amount` (or `maskDigits`). Market price is public and may be shown plainly.
6. Motion: only CSS (`animate-*` tokens) or `useCountUp`; both honor `prefers-reduced-motion` (CSS has a global override, the hook jumps to the end value). No animation libraries.
7. Touch targets 44px (`min-h-11`); dense list rows at least 24px. Interactive elements never nest (no `Amount` button inside a link: use `interactive={false}`).
8. Plain language, no jargon, no emoji. Estimates are labeled as estimates.
9. CSP is strict (`style-src 'self'`): use classes, not `style=` attributes in markup strings. React `style={{}}` props are fine (set through the DOM, not as attributes). No inline scripts, no remote fonts or images.
10. Keep axe at zero violations (`npm run e2e -w @bitcoin-basis/app`). A visible label must appear inside the accessible name.

## Tokens

| Token (Tailwind) | Value | Use |
|---|---|---|
| `bg-bg` | #0B0B0C | page |
| `bg-surface` | #161514 | cards, inputs |
| `bg-surface-2` | #1F1D1B | tracks, hover |
| `border-line` / `line-soft` | #2A2724 / #1F1D1B | borders / sidebar edge |
| `text-text` | #F5F3EF | main text |
| `text-soft` | #C9C4BC | secondary text, icons |
| `text-muted` | #A39E97 | labels, captions |
| `accent` | #F7931A | primary actions, hero number, gains, documented |
| `amber` | #FFB547 | hover, active, "up" |
| `cream` | #FFE2B8 | reconstructed tier |
| `loss` | #D98578 | losses, errors (muted red, never bright) |
| `tier-estimated` / `tier-unknown` | #A8794A / #5D5750 | estimated / unknown tier |

Radii: cards 20px (`Card`), small tiles 16-18px, buttons 12px, sheets 28px, FAB full round. Hero glow: radial orange at 20% (phone) / 16% (desktop) behind the top (already in `AppShell`).

Type: hero 46px (phone) / 64px (desktop) Space Grotesk 600, tracking -0.03em, `leading-none`. Page title 28px / 36px. Card title 15px/600. Values 20-24px/600. Labels 12-13px muted. Tailwind text sizes have `normal` line height to match the mockups.

## Layout

- Phone (< 1024px): header (brand, hide, lock), scrolling `main` (20px side padding), fixed bottom nav 92px with 4 tabs: Holdings, What if, orange + (opens the Log sheet), Records. Column is max 560px, centered.
- Desktop (>= 1024px): 220px sidebar (Holdings, What if, Tax season, Records, orange Log button), main padded 32/40. The screen draws its own Hide amounts / Lock text buttons in its header.
- Screens choose layout with `useIsWide()` (a media query hook), not by rendering both. Use `useLogSheet().open()` to open the Log sheet.
- Routes: `/` Holdings, `/what-if`, `/records`, `/tax`, `/wallet/:id`, `/loans/:id`, `/log` (opens the sheet), plus full-screen `/welcome`, `/unlock`, `/kit`. Add real screens by replacing the stub in `screens/stubs.tsx` and the element in `App.tsx`.

## Components (`app/src/ui/`)

- `AppShell`: the frame (`<Outlet/>` inside). Also exports `HideButton`, `LockButton`, `Brand`, `useIsWide`, `useLogSheet`.
- `Sheet({ open, onClose, title })`: slide-up modal (centered panel at >= 640px). Focus moves in, Tab wraps, Esc/backdrop/close button close, focus returns to the opener, `#root` is inert while open. Use for every modal.
- `Button` (`primary` orange, `secondary` bordered, `ghost`) and `buttonClasses()` for links styled as buttons. One primary per screen.
- `Card`, `Stat`: standard surface and label/value pair.
- `Segmented`: radio-group segmented control with arrow keys (Sell/Borrow, ranges).
- `Amount({ sats, showUnit, short, interactive, countUp })`: BTC with 8 decimals grouped `0.0074 2665`; tap cycles BTC, sats, USD (global choice, saved). `short` = 4 decimals for lists.
- `Money({ cents, precision: 'cents'|'dollars', signed, countUp })`: `$1,234.56`.
- `PriceChart`: hand-rolled SVG price line with dashed average-cost line and orange gap fill.
- `useCountUp`, `useMediaQuery` (`motion.ts`); `Toast` (`useToast().show(msg)`, polite live region; just below the header on a phone, bottom right on desktop, never over the brand).
- `PriceProblem.tsx`: when the live price cannot be loaded, `PriceUnavailable` (a card: "Can’t load today’s Bitcoin price.", what this screen needs it for, Retry, "Use a price I enter") or `PriceUnavailableLine` (the Holdings hero). A typed price is session-only, shown as "Using your price $X" wherever it is used (the `ManualPriceBanner` on every screen), and saved only inside an entry the person saves (its note says "your price").
- Hide amounts: `usePrefs()` gives `hidden`, `masked`, `toggleHidden`. Holding any masked amount (pointer or Space/Enter) or the eye button shows everything until release. A hidden amount is always one fixed shape (`$•••••`, `•.•••• ••••`; `maskDigits`), so its length never hints at its size.
- `SectionHeader` (`ui/SectionHeader.tsx`): the one section header. Title left (with its "?" right after the words), a count (`SectionCount`, e.g. `9 entries`) or one action (`SectionLink`, e.g. `All 9 entries`) right. Under a shortened list, `ShowMore` (quiet button, left): `Show all 12 entries`. Empty lists use `EmptyLine`.
- Entry lists: every list of entries (Records' recent and all entries, a wallet's entries) comes from `entryRows` in `lib/entry-list.ts` and renders `EntryRow`; tapping a row opens `EntrySheet` (details, history, `Edit purchase` / `Remove this purchase`). Settings changes are hidden unless filtered for, balance confirmations are never listed (they show as `Confirmed Nov 21` on the wallet), and every count is the number of rows shown. Strikethrough means removed and always comes with a `Removed` badge; `Edited` appears only for the person's own edits.
- Loans (`screens/loans/`): Holdings shows a Loans section only when a loan is open; every figure comes from the engine (`loanSummary`, `loanPurchases`, `suggestLoanPayment`). Estimates carry a quiet `≈` (`Approx`) and the section's "?" says what is estimated. Loan-funded purchases show `LoanBadge` (`HELOC` or `Loan`) wherever a purchase or its coins are listed. Loan records stay out of entry lists unless Kind = Loan.
- Field errors use `ErrorLine` (built into every field): once shown, its line stays reserved after the fix so the form does not jump. One back button style (44px, `rounded-xl`, `ChevronLeftIcon`); in a pair of buttons the cancel comes first and the primary last.

Documentation tiers (`TIER_BG`, `TIER_LABEL` in `screens/holdings-parts.tsx` and `lib/origin.ts`): Documented orange, Reconstructed cream, Estimated tan, Unknown grey. Always show the tier by color plus text.

## Data

- `useLedger()` (`data/ledger-provider.tsx`): `entries`, replayed `state`, `holdings`, `append(entries)`, `isDemo`, `today`. Build screen numbers from engine output (see `lib/holdings-view.ts`), never re-derive money in components.
- `usePrice()` (`data/price-provider.tsx`): `quote` (cents per BTC, null until known; `source: 'manual'` while a typed price is in use), `status` (of the live price), `error`, `refresh()`, `manualCents` / `setManualCents()`. Live from mempool.space through the Worker; the demo book uses a fixed price; the test build's fake server answers `/api/price` and `/api/price/history` with fixed prices (fail them with `window.__bbFake.server.failing.set('/api/price', 503)`).
- Demo book: `demo/demo-data.ts` (`buildDemoBook()`); synthetic only.

## Testing

Component tests: `app/src/**/*.test.tsx` with `// @vitest-environment happy-dom` and helpers in `app/src/test/render.tsx`. E2E: `app/e2e/*.spec.ts` against `vite preview` (phone 390x844 and desktop 1440x1000), axe on every screen. Screenshots: `npm run build && npm run preview` then `npm run screenshots -w @bitcoin-basis/app` (output in `app/e2e/screenshots/`, git-ignored).

### Visual snapshots

`app/e2e/visual.spec.ts` (tests tagged `@visual`) takes full-page pictures of Holdings, the Log sheet, Sell, Borrow, Tax season, Records and Wallet detail at both sizes, using the demo book (fixed price, fixed "today"), animations off and reduced motion on. Baselines live in `app/e2e/visual.spec.ts-snapshots/` and are platform-specific (`*-darwin.png`: fonts render differently per OS), so CI skips them with `--grep-invert @visual` and they run on a Mac only.

- Check: `npm run e2e -w @bitcoin-basis/app -- --grep @visual`
- After an intended design change, review the diff in `app/playwright-report/` or `app/test-results/`, then update: `npm run e2e:visual:update -w @bitcoin-basis/app`, look at the changed PNGs, and commit them with the change.
- Run everything except snapshots (what CI runs): `npm run e2e:ci -w @bitcoin-basis/app`.
- Accessibility sweep: `app/e2e/a11y.spec.ts` runs axe on every route and sheet at both sizes, a keyboard-only walk-through (log a purchase and a sale, Esc, focus return) and a reduced-motion check.
- Screens other than Holdings are code-split with `React.lazy` (see `App.tsx`); keep new routes lazy and Holdings in the main chunk.
