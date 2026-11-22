import { averageCostPerBtc, type Lot, type Tier, type Worth } from '@bitcoin-basis/engine';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { dayChangeTenthsPercent } from '../data/price.ts';
import { cx } from '../lib/cx.ts';
import { countOf, formatMoney, shortDate } from '../lib/format.ts';
import { type HoldingsView, type StackRetirementPurchase, type StackYear, type WalletCard } from '../lib/holdings-view.ts';
import { describeOrigin, TIER_HELP, TIER_LABEL } from '../lib/origin.ts';
import { useLedger } from '../data/ledger-provider.tsx';
import { Amount, Money } from '../ui/Amount.tsx';
import { PlainMoney } from '../ui/plain-money.tsx';
import { Card } from '../ui/Card.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useHelp, useLotHelp } from '../ui/Help.tsx';
import { ChevronRightIcon } from '../ui/icons.tsx';
import { usePrice } from '../data/price-provider.tsx';
import { PriceUnavailableLine, yourPriceText } from '../ui/PriceProblem.tsx';
import { PriceAge, PriceRefreshButton } from '../ui/PriceFreshness.tsx';
import { walletKindLabel } from '../lib/wallet-label.ts';
import { sumWorth, worthNow } from '../lib/worth-now.ts';
import { GainWords, WorthLine } from '../ui/WorthLine.tsx';
import { loanTagFor } from '../lib/loans-view.ts';
import { LoanBadge } from './loans/loan-parts.tsx';

export const TIER_BG: Record<Tier, string> = {
  documented: 'bg-accent',
  reconstructed: 'bg-cream',
  estimated: 'bg-tier-estimated',
  unknown: 'bg-tier-unknown',
};
const TIER_ORDER: Tier[] = ['documented', 'reconstructed', 'estimated', 'unknown'];

// ---- Hero ------------------------------------------------------------------------------

/** The 24-hour change: an arrow and color by its sign; one that rounds to 0.0% is plain (`0.0% in 24h`). */
export function DayChange({ tenths, className }: { tenths: number; className?: string | undefined }) {
  const text = `${(Math.abs(tenths) / 10).toFixed(1)}% in 24h`;
  if (tenths === 0) return <span className={cx('text-muted', className)}>{text}</span>;
  return (
    <span className={cx(tenths > 0 ? 'text-amber' : 'text-loss', className)}>
      <span aria-hidden="true">{tenths > 0 ? '▲' : '▼'} </span>
      <span className="sr-only">{tenths > 0 ? 'Up ' : 'Down '}</span>
      {text}
    </span>
  );
}

/**
 * The price under the Holdings hero: `at $95,000.00`, the change over the past 24 hours, and a small refresh button. A
 * price that is not current says when it is from (`· as of 3:12 PM`); a failed refresh keeps the price it had.
 */
export function PriceLine({ className }: { className?: string }) {
  const { quote, status } = usePrice();
  if (quote === null) {
    return status === 'error' ? <PriceUnavailableLine className={className} /> : <span className={cx('text-muted', className)}>Getting the price…</span>;
  }
  if (quote.source === 'manual') return <span className={cx('text-amber', className)}>{yourPriceText(quote.usdCents)}</span>;
  const tenths = dayChangeTenthsPercent(quote);
  return (
    <>
      <span className={cx('text-muted', className)}>
        at {formatMoney(quote.usdCents)}
        <PriceAge quote={quote} />
      </span>
      {tenths === null ? (
        <PriceRefreshButton />
      ) : (
        // The change and the button wrap together, so the button never sits alone on a line.
        <span className="inline-flex items-baseline gap-x-2.5 whitespace-nowrap">
          <DayChange tenths={tenths} className={className} />
          <PriceRefreshButton />
        </span>
      )}
    </>
  );
}

/** A gain or loss with its sign and color. Whole dollars by default; `precision="cents"` where it sits beside parts in cents. */
export function GainText({ cents, precision = 'dollars', className }: { cents: number | null; precision?: 'cents' | 'dollars'; className?: string }) {
  if (cents === null) return <span className={className}>—</span>;
  return <Money cents={cents} precision={precision} signed className={cx(cents < 0 && 'text-loss', cents >= 0 && 'text-accent', className)} />;
}

// ---- Stack -----------------------------------------------------------------------------

/** Retirement's own colour, wherever retirement Bitcoin is colour-coded (never cream: that is the Reconstructed tier). */
export const RETIRE_BG = 'bg-retire';

/** Largest year fills this share of the bar track (matches the design). */
const MAX_BAR_PERCENT = 83;

/** A year's segments in bar order: the taxable tiers, then retirement. Shares of the year's BTC. */
function segments(row: StackYear): { key: string; bg: string; sats: number }[] {
  return [...TIER_ORDER.map((t) => ({ key: t, bg: TIER_BG[t], sats: row.byTier[t] })), { key: 'retirement', bg: RETIRE_BG, sats: row.retirementSats }].filter((s) => s.sats > 0);
}

export function StackRows({ stack, onPick }: { stack: StackYear[]; onPick(year: number): void }) {
  const max = Math.max(1, ...stack.map((r) => r.sats));
  return (
    <ul className="-my-1 flex list-none flex-col gap-px p-0">
      {stack.map((row) => (
        <li key={row.year}>
          <button
            type="button"
            onClick={() => onPick(row.year)}
            className="press-soft flex min-h-6 w-full items-center gap-2.5 rounded-lg bg-transparent p-0 text-left text-text hover:bg-surface-2/60 active:bg-surface-2/60"
          >
            <span className="w-9 text-xs text-muted">{row.year}</span>
            <span className="flex h-3.5 flex-1 overflow-hidden rounded-[7px] bg-surface-2" aria-hidden="true">
              <span className="flex h-full origin-left animate-grow" style={{ width: `${(row.sats / max) * MAX_BAR_PERCENT}%` }}>
                {segments(row).map((s) => (
                  <span key={s.key} className={cx('h-full', s.bg)} style={{ width: `${(s.sats / row.sats) * 100}%` }} />
                ))}
              </span>
            </span>
            <span className="w-16 text-right text-xs">
              <ShortBtc sats={row.sats} />
            </span>
            <span className="sr-only">Show the {row.year} lots and where each came from.</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ShortBtc({ sats }: { sats: number }) {
  return <Amount sats={sats} interactive={false} short />;
}

export function StackColumns({ stack, onPick }: { stack: StackYear[]; onPick(year: number): void }) {
  const max = Math.max(1, ...stack.map((r) => r.sats));
  const BAR = 120; // px for the tallest year
  return (
    <ul className="m-0 grid h-40 list-none items-end gap-3.5 p-0" style={{ gridTemplateColumns: `repeat(${Math.max(1, stack.length)}, minmax(0, 1fr))` }}>
      {stack.map((row) => (
        <li key={row.year} className="h-full">
          <button
            type="button"
            onClick={() => onPick(row.year)}
            className="press-soft flex h-full w-full flex-col items-center justify-end gap-2 rounded-xl bg-transparent p-0 text-text hover:bg-surface-2/50"
          >
            <span className="text-xs font-semibold">
              <ShortBtc sats={row.sats} />
            </span>
            <span className="flex w-[70%] flex-col overflow-hidden rounded-t-[10px] rounded-b-[4px]" style={{ height: (row.sats / max) * BAR }} aria-hidden="true">
              {/* Top to bottom: retirement, then the tiers with Documented at the base. */}
              {segments(row)
                .reverse()
                .map((s) => (
                  <span key={s.key} className={cx('w-full', s.bg)} style={{ height: `${(s.sats / row.sats) * 100}%` }} />
                ))}
            </span>
            <span className="text-xs text-muted">{row.year}</span>
            <span className="sr-only">Show the {row.year} lots and where each came from.</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What the colors mean: the documentation tiers given, then Retirement when `retirement`. */
export function TierLegend({ tiers, retirement = false, className }: { tiers: Tier[]; retirement?: boolean; className?: string }) {
  return (
    <div className={cx('flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted lg:text-xs lg:gap-x-4', className)}>
      {tiers.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className={cx('size-2.5 rounded-[3px]', TIER_BG[t])} aria-hidden="true" />
          {TIER_LABEL[t]}
        </span>
      ))}
      {retirement ? (
        <span className="flex items-center gap-1.5">
          <span className={cx('size-2.5 rounded-[3px]', RETIRE_BG)} aria-hidden="true" />
          Retirement
        </span>
      ) : null}
    </div>
  );
}

/** What the four colors mean, for a "?" next to a legend. */
export const TIER_COLORS_HELP = 'The colour says how sure the cost is. Documented: a receipt or export backs it up. Reconstructed: rebuilt from statements. Estimated: a best guess. Unknown: no cost yet.';

/** The stack's "?" when retirement is in it. */
export const STACK_COLORS_HELP = `${TIER_COLORS_HELP} Retirement (blue): bought in a retirement account, kept apart from tax.`;

/** Tiers that actually have coins, documented first. */
export function tiersPresent(mix: Record<Tier, number>): Tier[] {
  const present = TIER_ORDER.filter((t) => mix[t] > 0);
  return present.length > 0 ? present : ['documented', 'reconstructed'];
}

/** `Fidelity IRA`, `Fidelity IRA and Old 401k`, `A, B and C`. */
function namesList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
}

/**
 * "Your stack, by year bought": all your Bitcoin (taxable lots and retirement purchases) by the year it was bought.
 * Phone: a row per year; desktop: a column per year. The documented share under it is the taxable lots' only.
 */
export function StackCard({ view, wide, onPick }: { view: HoldingsView; wide: boolean; onPick(year: number): void }) {
  const retirement = view.stack.some((r) => r.retirementSats > 0);
  const help = useHelp('What do the colors mean?', retirement ? STACK_COLORS_HELP : TIER_COLORS_HELP);
  const legend = (
    <div className={cx('flex items-center gap-1', !wide && 'mt-0.5')}>
      <TierLegend tiers={tiersPresent(view.mix)} retirement={retirement} />
      {help.button}
    </div>
  );
  const undated = view.stackUndated;
  return (
    <Card as="section" aria-label="Your coins by year bought" className={cx('flex flex-col', wide ? 'gap-3.5' : 'gap-2.5')}>
      {wide ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[15px] font-semibold">Your stack, by year bought</h2>
          {legend}
        </div>
      ) : (
        <h2 className="m-0 text-[15px] font-semibold">Your stack, by year bought</h2>
      )}
      {wide ? <StackColumns stack={view.stack} onPick={onPick} /> : <StackRows stack={view.stack} onPick={onPick} />}
      {wide ? null : legend}
      {help.panel}
      {undated ? (
        <p className="m-0 flex items-baseline gap-1.5 text-xs text-muted">
          <span className={cx('size-2.5 flex-none self-center rounded-[3px]', RETIRE_BG)} aria-hidden="true" />
          <span>
            Not in a year: <Amount sats={undated.sats} short showUnit alwaysBtc interactive={false} className="text-soft" /> in retirement, because no purchases are logged for {namesList(undated.wallets)}.
          </span>
        </p>
      ) : null}
      <span className="text-xs text-muted">
        {view.all === null ? '' : 'Taxable: '}
        {view.tierShares.documented} documented. Pick a year to see each lot and where it came from.
      </span>
    </Card>
  );
}

// ---- Coins of one year, with their origin ----------------------------------------------

function CoinRow({ lot, priceCents }: { lot: Lot; priceCents: number | null }) {
  const { entries, state } = useLedger();
  const [open, setOpen] = useState(false);
  const origin = entries.find((e) => e.id === lot.originEntryId);
  const wallets = new Map(state.wallets.map((w) => [w.id, w]));
  const wallet = wallets.get(lot.wallet);
  // Null (shown as —) when nothing is held or the figure is too large to represent, never a crash.
  const perBtc = averageCostPerBtc(lot.costCents, lot.sats);
  const loan = loanTagFor(state, lot.id);
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-14 w-full items-center gap-3 bg-transparent py-2 text-left text-text">
        <span className={cx('h-8 w-1.5 flex-none rounded-full', TIER_BG[lot.tier])} aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Amount sats={lot.sats} interactive={false} />
            {loan ? <LoanBadge tag={loan.tag} /> : null}
          </span>
          <span className="text-xs text-muted [overflow-wrap:anywhere]">
            {shortDate(lot.acquiredDate)} · {wallet?.name ?? 'Unknown wallet'}
          </span>
          <WorthLine worth={worthNow(lot.sats, lot.costCents, priceCents)} className="truncate text-xs" />
        </span>
        <span className="text-xs text-muted">{TIER_LABEL[lot.tier]}</span>
        <ChevronRightIcon size={16} className={cx('flex-none text-muted transition-transform duration-150', open && 'rotate-90')} />
      </button>
      {open && (
        <dl className="mb-3 ml-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-bg px-3 py-2.5 text-xs">
          <dt className="text-muted">Came from</dt>
          <dd>{describeOrigin(lot, origin, wallets)}</dd>
          <dt className="text-muted">Cost</dt>
          <dd>
            <Money cents={lot.costCents} />
            {perBtc !== null && (
              <span className="text-muted">
                {' '}
                · <Money cents={perBtc} /> per BTC
              </span>
            )}
          </dd>
          <dt className="text-muted">Receipt</dt>
          <dd>{lot.proof || 'None yet'}</dd>
          <dt className="text-muted">How sure</dt>
          <dd>
            {TIER_LABEL[lot.tier]}. {TIER_HELP[lot.tier]}
          </dd>
        </dl>
      )}
    </li>
  );
}

/** A retirement purchase in a year's lots: its own colour and "Retirement" where a lot shows its tier (no tax tier). */
function RetirementPurchaseRow({ purchase: p }: { purchase: StackRetirementPurchase }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-14 w-full items-center gap-3 bg-transparent py-2 text-left text-text">
        <span className={cx('h-8 w-1.5 flex-none rounded-full', RETIRE_BG)} aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">
            <Amount sats={p.sats} interactive={false} />
          </span>
          <span className="text-xs text-muted [overflow-wrap:anywhere]">
            {shortDate(p.date)} · {p.walletName}
          </span>
          <WorthLine worth={p} className="truncate text-xs" />
        </span>
        <span className="text-xs text-muted">Retirement</span>
        <ChevronRightIcon size={16} className={cx('flex-none text-muted transition-transform duration-150', open && 'rotate-90')} />
      </button>
      {open && (
        <dl className="mb-3 ml-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-bg px-3 py-2.5 text-xs">
          <dt className="text-muted">Came from</dt>
          <dd>Retirement purchase in {p.walletName}. Kept apart from tax.</dd>
          <dt className="text-muted">Cost</dt>
          <dd>
            <Money cents={p.costCents} />
            {p.averageCostCentsPerBtc !== null && (
              <span className="text-muted">
                {' '}
                · <Money cents={p.averageCostCentsPerBtc} /> per BTC
              </span>
            )}
          </dd>
          <dt className="text-muted">Receipt</dt>
          <dd>{p.proof || 'None yet'}</dd>
        </dl>
      )}
    </li>
  );
}

export function YearSheet({ row, onClose }: { row: StackYear | null; onClose(): void }) {
  const { quote } = usePrice();
  const priceCents = quote?.usdCents ?? null;
  const lotHelp = useLotHelp();
  return (
    <Sheet open={row !== null} onClose={onClose} title={row ? `${row.year} lots` : ''}>
      {row && (
        <>
          <p className="mb-2 flex items-baseline gap-1 text-sm text-muted">
            <span>
              {countOf(row.pieces.length, 'lot')}, newest first. Tap one to see where it came from.
            </span>
            {lotHelp.button}
          </p>
          {lotHelp.panel ? <div className="mb-2">{lotHelp.panel}</div> : null}
          <TierLegend tiers={row.lots.length > 0 ? tiersPresent(row.byTier) : []} retirement={row.retirementSats > 0} className="mb-2" />
          <YearTotal row={row} priceCents={priceCents} />
          <ul className="m-0 list-none p-0">
            {row.pieces.map((piece) =>
              piece.kind === 'lot' ? <CoinRow key={piece.lot.id} lot={piece.lot} priceCents={priceCents} /> : <RetirementPurchaseRow key={piece.purchase.id} purchase={piece.purchase} />,
            )}
          </ul>
        </>
      )}
    </Sheet>
  );
}

/** What everything bought that year is worth now, taxable and retirement, each piece valued on its own. */
function YearTotal({ row, priceCents }: { row: StackYear; priceCents: number | null }) {
  const w = sumWorth([...row.lots, ...row.retirement], priceCents);
  return (
    <p className="mb-2 mt-0 text-sm" aria-label={`${row.year} total`}>
      <span className="text-soft">All {row.year} lots now </span>
      {w.valueCents === null ? '—' : <Money cents={w.valueCents} />}
      <span className="text-soft"> · </span>
      <GainWords worth={w} className="font-semibold" />
    </p>
  );
}

// ---- Wallets ---------------------------------------------------------------------------

export function WalletLinkCard({ w }: { w: WalletCard }) {
  return (
    <Link to={`/wallet/${w.id}`} className="press-soft flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-line bg-surface py-3 pl-3.5 pr-2.5 text-text no-underline hover:bg-surface-2 hover:text-text active:bg-surface-2">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{w.name}</span>
        <span className={cx('text-xs normal-nums', w.needsAttention ? 'text-amber' : 'text-muted')}>
          {w.typeLabel} · {w.needsAttention ? 'Needs a check' : w.confirmedLabel}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <Amount sats={w.sats} interactive={false} />
        <ChevronRightIcon size={16} className="flex-none text-muted" />
      </span>
    </Link>
  );
}

/** The desktop card is narrow, so the check status sits under the amount instead of after the type. */
export function WalletRow({ w }: { w: WalletCard }) {
  return (
    <Link to={`/wallet/${w.id}`} className="group -mx-2 flex min-h-14 items-center justify-between gap-3 rounded-xl border-b border-line px-2 text-text no-underline transition-colors last:border-b-0 hover:bg-surface-2 hover:text-text">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold">{w.name}</span>
        <span className="text-xs normal-nums text-muted">{w.typeLabel}</span>
      </span>
      <span className="flex flex-col items-end gap-0.5 text-right">
        <span className="text-sm font-semibold">
          <Amount sats={w.sats} interactive={false} />
        </span>
        <span className={cx('text-xs', w.needsAttention ? 'text-amber' : 'text-muted')}>{w.needsAttention ? 'Needs a check' : w.confirmedLabel}</span>
      </span>
      <ChevronRightIcon size={16} className="-ml-1 flex-none text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// ---- Extra cards (below the design's first screen) -------------------------------------

/** Targets for the split rows under the hero. */
const HELD_APART_ID = 'held-apart';
const TAXABLE_ID = 'taxable';

export function DocumentationCard({ view }: { view: HoldingsView }) {
  const total = Math.max(1, view.totalSats);
  const tiers = TIER_ORDER.filter((t) => view.mix[t] > 0);
  const share = view.tierShares;
  return (
    <Card as="section" aria-label={view.all === null ? 'How well your coins are documented' : 'How well your taxable coins are documented'} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-[15px] font-semibold">How well it is documented</h2>
          <span className="text-xs text-muted">{share.documented}</span>
        </div>
        {/* Only taxable lots carry a documentation tier; say so when retirement is in the total at the top. */}
        {view.all === null ? null : <p className="m-0 text-xs text-muted">Taxable Bitcoin only. Retirement is kept apart from tax.</p>}
      </div>
      <div className="flex h-3.5 overflow-hidden rounded-[7px] bg-surface-2" role="img" aria-label={tiers.map((t) => `${TIER_LABEL[t]} ${share[t].replace('%', ' percent')}`).join(', ')}>
        {tiers.map((t) => (
          <span key={t} className={cx('h-full', TIER_BG[t])} style={{ width: `${(view.mix[t] * 100) / total}%` }} />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-xs">
        {tiers.map((t) => (
          <li key={t} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted">
              <span className={cx('size-2.5 rounded-[3px]', TIER_BG[t])} aria-hidden="true" />
              {TIER_LABEL[t]}
            </span>
            <span>
              <Amount sats={view.mix[t]} interactive={false} /> · {share[t]}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One wallet held apart: name and BTC on the first line, then full-width detail lines (so none of them wrap early). */
function HeldApartRow({ id, name, sats, children }: { id: string; name: string; sats: number; children: ReactNode }) {
  return (
    <li>
      <Link to={`/wallet/${id}`} className="flex flex-col gap-0.5 border-b border-line py-2.5 text-text no-underline last:border-b-0 hover:text-text">
        <span className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
          <span className="flex flex-none items-center gap-1.5 text-sm font-semibold">
            <Amount sats={sats} interactive={false} />
            <ChevronRightIcon size={16} className="flex-none text-muted" />
          </span>
        </span>
        {children}
      </Link>
    </li>
  );
}

/** What the Held apart card says it leaves out. With retirement coins the total at the top includes them; frozen wallets never. */
function heldApartNote(view: HoldingsView): string {
  if (view.all === null) return 'Not counted in what your Bitcoin is worth or in your average cost.';
  return `Not counted in your taxable figures or average cost. Retirement is in the total at the top${view.frozen.length > 0 ? '; frozen wallets are not' : ''}.`;
}

export function RetirementCard({ view }: { view: HoldingsView }) {
  if (view.retirement.length === 0 && view.frozen.length === 0) return null;
  return (
    <Card
      as="section"
      id={HELD_APART_ID}
      tabIndex={-1}
      aria-label={view.all === null ? 'Held apart from your total' : 'Held apart from tax'}
      className="flex scroll-mt-6 flex-col gap-3 outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <h2 className="m-0 text-[15px] font-semibold">Held apart</h2>
      <p className="m-0 text-xs text-muted">{heldApartNote(view)}</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {view.retirement.map((r) => (
          <HeldApartRow key={r.id} id={r.id} name={r.name} sats={r.sats}>
            <span className="text-xs text-muted">{walletKindLabel({ type: 'retirement', frozen: false, archived: false })}</span>
            {r.shown.valueCents !== null && (
              <span className="text-xs text-muted">
                Worth <PlainMoney cents={r.shown.valueCents} precision="dollars" />
              </span>
            )}
            {r.costKnown ? (
              <span className="text-xs text-muted">
                <span className="whitespace-nowrap">
                  Cost <PlainMoney cents={r.shown.costCents} precision="dollars" />
                  {r.shown.gainCents !== null ? ' ·' : ''}
                </span>
                {r.shown.gainCents !== null ? (
                  <>
                    {' '}
                    <GainWords worth={r.shown} plain precision="dollars" className="font-semibold" />
                  </>
                ) : null}
              </span>
            ) : null}
            {r.noteDiffers ? <span className="text-xs text-amber">Balance note differs</span> : null}
          </HeldApartRow>
        ))}
        {view.frozen.map((w) => (
          <HeldApartRow key={w.id} id={w.id} name={w.name} sats={w.sats}>
            <span className="text-xs text-muted">{walletKindLabel({ type: w.type, frozen: true, archived: false })}</span>
            <span className="text-xs text-muted">
              Cost <PlainMoney cents={w.costCents} precision="dollars" />
            </span>
          </HeldApartRow>
        ))}
      </ul>
    </Card>
  );
}


// ---- All your Bitcoin: the hero total and its taxable / retirement split -------------------

/** Move to a section on this screen and put focus there (for screen readers and keyboards), without a second scroll. */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: 'start' });
  el?.focus({ preventScroll: true });
}

/**
 * What the hero shows. With retirement coins it is all your Bitcoin (taxable plus retirement, from the engine's
 * `allBitcoin`); without, exactly the taxable figures, as before.
 */
export function heroFigures(view: HoldingsView): { all: boolean; label: string; region: string; worthCents: number | null; sats: number } {
  if (view.all === null) return { all: false, label: 'Your Bitcoin is worth', region: 'What your Bitcoin is worth', worthCents: view.worthCents, sats: view.totalSats };
  return { all: true, label: 'All your Bitcoin is worth', region: 'What all your Bitcoin is worth', worthCents: view.all.total.valueCents, sats: view.all.total.sats };
}

/** `up $197,603 (+127%) unrealized` under the all-Bitcoin hero. Nothing without retirement coins or without a gain. */
export function HeroGainLine({ view, className }: { view: HoldingsView; className?: string }) {
  const total = view.all?.total;
  if (total === undefined || total.gainCents === null) return null;
  return (
    <span className={className}>
      <GainWords worth={total} precision="dollars" className="font-semibold" /> <span className="text-muted">unrealized</span>
    </span>
  );
}

/**
 * `Average cost of all your Bitcoin: $43,450.12 per BTC` (taxable and retirement), under the all-Bitcoin hero, so it is
 * never mistaken for the taxable average cost below. Shown only when every coin's cost is known.
 */
export function HeroAverageLine({ view, className }: { view: HoldingsView; className?: string }) {
  const total = view.all?.total;
  if (total === undefined || total.sats <= 0 || total.unknownCostSats > 0) return null;
  const average = averageCostPerBtc(total.costCents, total.sats);
  return (
    <span className={cx('text-muted', className)}>
      Average cost of all your Bitcoin: {average === null ? <span className="font-semibold text-soft">—</span> : <Money cents={average} className="font-semibold text-soft" />} per BTC
    </span>
  );
}

function SplitRowBody({ swatch, label, what, btc, worth, wide }: { swatch: string; label: string; what: string; btc: ReactNode; worth: Worth; wide: boolean }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className={cx('size-2.5 flex-none rounded-[3px]', swatch)} aria-hidden="true" />
          {label}
        </span>
        {wide ? (
          <span className="text-xs text-muted">
            {what} · {btc}
          </span>
        ) : (
          // Phone: two short lines, so neither breaks in an odd place.
          <span className="flex flex-col text-xs text-muted">
            <span>
              {what}
              <span className="sr-only"> · </span>
            </span>
            <span>{btc}</span>
          </span>
        )}
      </span>
      <span className="flex flex-none flex-col items-end gap-0.5 text-right">
        {/* Whole dollars that add up to the total at the top (`view.split`). */}
        <span className="text-[15px] font-semibold">{worth.valueCents === null ? '—' : <PlainMoney cents={worth.valueCents} precision="dollars" />}</span>
        {worth.valueCents === null ? null : worth.gainCents === null ? (
          <span className="text-xs text-muted">Gain not known</span>
        ) : (
          <GainWords worth={worth} plain precision="dollars" className="text-xs font-semibold" />
        )}
      </span>
      <ChevronRightIcon size={16} className="-ml-1 flex-none text-muted" />
    </>
  );
}

const SPLIT_ROW = 'press-soft flex min-h-11 w-full items-center gap-3 rounded-xl bg-transparent px-2 py-2.5 text-left text-text no-underline hover:bg-surface-2 hover:text-text active:bg-surface-2';

/**
 * Right under the all-Bitcoin hero: how it splits into taxable and retirement, as a thin bar and two rows. Taxable
 * jumps to the taxable figures below; Retirement opens the one retirement wallet, or jumps to the Held apart list when
 * there are several. Only with retirement coins.
 */
export function SplitCard({ view, wide }: { view: HoldingsView; wide: boolean }) {
  const all = view.split;
  if (all === null) return null;
  const unknown = all.retirement.unknownCostSats > 0;
  const only = view.retirement.length === 1 ? view.retirement[0] : undefined;
  // Always BTC: the dollars are already at the right, and sats would wrap the line.
  const satsLine = (sats: number) => <Amount sats={sats} short showUnit alwaysBtc interactive={false} />;
  const retirement = (
    <SplitRowBody
      swatch={RETIRE_BG}
      label="Retirement"
      what={unknown ? 'Some cost not logged' : 'Kept apart from tax'}
      btc={satsLine(all.retirement.sats)}
      worth={all.retirement}
      wide={wide}
    />
  );
  return (
    <Card as="section" aria-label="Taxable and retirement" className="flex flex-col gap-2 !px-2.5 !pt-3.5 !pb-2 lg:!px-3">
      {/* Shares by BTC. The rows below carry the figures, so the bar itself is decoration. */}
      <div className="mx-2 flex h-1.5 gap-0.5" aria-hidden="true">
        <span className="min-w-0.5 rounded-full bg-accent" style={{ flexGrow: all.taxable.sats, flexBasis: 0 }} />
        <span className={cx('min-w-0.5 rounded-full', RETIRE_BG)} style={{ flexGrow: all.retirement.sats, flexBasis: 0 }} />
      </div>
      <ul className={cx('m-0 list-none p-0', wide ? 'grid grid-cols-2 gap-2' : 'flex flex-col divide-y divide-line')}>
        <li className={cx(!wide && 'pb-0.5')}>
          <button type="button" onClick={() => jumpTo(TAXABLE_ID)} className={SPLIT_ROW}>
            <SplitRowBody swatch="bg-accent" label="Taxable" what="Counts for tax" btc={satsLine(all.taxable.sats)} worth={all.taxable} wide={wide} />
            <span className="sr-only">Go to the taxable figures.</span>
          </button>
        </li>
        <li className={cx(wide ? 'border-l border-line pl-2' : 'pt-0.5')}>
          {only ? (
            <Link to={`/wallet/${only.id}`} className={SPLIT_ROW}>
              {retirement}
              <span className="sr-only">Open {only.name}.</span>
            </Link>
          ) : (
            <button type="button" onClick={() => jumpTo(HELD_APART_ID)} className={SPLIT_ROW}>
              {retirement}
              <span className="sr-only">Go to your retirement wallets.</span>
            </button>
          )}
        </li>
      </ul>
      {unknown ? <p className="m-0 px-2 pb-1 text-xs text-muted">Gain counts only coins with a logged cost. Log a retirement account&apos;s purchases to include it.</p> : null}
    </Card>
  );
}

/** The quiet label that starts the taxable figures under the all-Bitcoin hero. Only with retirement coins. */
export function TaxableDivider({ view }: { view: HoldingsView }) {
  if (view.all === null) return null;
  return (
    <h2 id={TAXABLE_ID} tabIndex={-1} className="m-0 -mb-1 flex scroll-mt-6 items-center gap-3 rounded-md pt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent">
      Taxable
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </h2>
  );
}
