import { mulDivRoundHalfUp, SATS_PER_BTC, type Lot, type Tier, type Worth } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { dayChangeTenthsPercent, type PriceQuote } from '../data/price.ts';
import { cx } from '../lib/cx.ts';
import { countOf, formatMoney, shortDate } from '../lib/format.ts';
import type { HoldingsView, StackYear, WalletCard } from '../lib/holdings-view.ts';
import { buildItems } from '../lib/entry-list.ts';
import { describeOrigin, TIER_HELP, TIER_LABEL } from '../lib/origin.ts';
import { useLedger } from '../data/ledger-provider.tsx';
import { Amount, Money } from '../ui/Amount.tsx';
import { PlainMoney } from '../ui/plain-money.tsx';
import { Card } from '../ui/Card.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { ChevronRightIcon } from '../ui/icons.tsx';
import { useHelp } from '../ui/Help.tsx';
import { usePrice } from '../data/price-provider.tsx';
import { PriceUnavailableLine, yourPriceText } from '../ui/PriceProblem.tsx';
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

export function PriceLine({ quote, status, className }: { quote: PriceQuote | null; status: string; error?: string | null; className?: string }) {
  if (quote === null) {
    return status === 'error' ? <PriceUnavailableLine className={className} /> : <span className={cx('text-muted', className)}>Getting the price…</span>;
  }
  if (quote.source === 'manual') return <span className={cx('text-amber', className)}>{yourPriceText(quote.usdCents)}</span>;
  const tenths = dayChangeTenthsPercent(quote);
  return (
    <>
      <span className={cx('text-muted', className)}>at {formatMoney(quote.usdCents)}</span>
      {tenths !== null && (
        <span className={cx(tenths >= 0 ? 'text-amber' : 'text-loss', className)}>
          {tenths >= 0 ? '▲' : '▼'} {(Math.abs(tenths) / 10).toFixed(1)}% today
        </span>
      )}
      {status === 'error' && <span className={cx('text-loss', className)}>Price may be out of date</span>}
    </>
  );
}

export function GainText({ cents, className }: { cents: number | null; className?: string }) {
  if (cents === null) return <span className={className}>—</span>;
  return <Money cents={cents} precision="dollars" signed className={cx(cents < 0 && 'text-loss', cents >= 0 && 'text-accent', className)} />;
}

// ---- Stack -----------------------------------------------------------------------------

/** Largest year fills this share of the bar track (matches the design). */
const MAX_BAR_PERCENT = 83;

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
                {TIER_ORDER.map((t) => (row.byTier[t] > 0 ? <span key={t} className={cx('h-full', TIER_BG[t])} style={{ width: `${(row.byTier[t] / row.sats) * 100}%` }} /> : null))}
              </span>
            </span>
            <span className="w-16 text-right text-xs">
              <ShortBtc sats={row.sats} />
            </span>
            <span className="sr-only">Show where the {row.year} coins came from.</span>
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
              {[...TIER_ORDER].reverse().map((t) => (row.byTier[t] > 0 ? <span key={t} className={cx('w-full', TIER_BG[t])} style={{ height: `${(row.byTier[t] / row.sats) * 100}%` }} /> : null))}
            </span>
            <span className="text-xs text-muted">{row.year}</span>
            <span className="sr-only">Show where the {row.year} coins came from.</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What the colors mean. With `mix` it also says how much of your stack each one is (so there is no separate card for it on a phone). */
export function TierLegend({ tiers, mix, className }: { tiers: Tier[]; mix?: Record<Tier, number>; className?: string }) {
  const total = mix ? Math.max(1, TIER_ORDER.reduce((n, t) => n + mix[t], 0)) : 1;
  return (
    <div className={cx('flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted lg:text-xs lg:gap-x-4', className)}>
      {tiers.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className={cx('size-2.5 rounded-[3px]', TIER_BG[t])} aria-hidden="true" />
          {TIER_LABEL[t]}
          {mix ? ` ${Math.round((mix[t] * 100) / total)}%` : ''}
        </span>
      ))}
    </div>
  );
}

/** What the four colors mean, for a "?" next to a legend. */
export const TIER_COLORS_HELP = 'The colour says how sure the cost is. Documented: a receipt or export backs it up. Reconstructed: rebuilt from statements. Estimated: a best guess. Unknown: no cost yet.';

/** Tiers that actually have coins, documented first. */
export function tiersPresent(mix: Record<Tier, number>): Tier[] {
  const present = TIER_ORDER.filter((t) => mix[t] > 0);
  return present.length > 0 ? present : ['documented', 'reconstructed'];
}

// ---- Coins of one year, with their origin ----------------------------------------------

function CoinRow({ lot, priceCents }: { lot: Lot; priceCents: number | null }) {
  const { entries, state } = useLedger();
  const [open, setOpen] = useState(false);
  const origin = entries.find((e) => e.id === lot.originEntryId);
  const wallets = new Map(state.wallets.map((w) => [w.id, w]));
  const wallet = wallets.get(lot.wallet);
  const perBtc = lot.sats === 0 ? null : mulDivRoundHalfUp(lot.costCents, SATS_PER_BTC, lot.sats);
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

export function YearSheet({ row, onClose }: { row: StackYear | null; onClose(): void }) {
  const { quote } = usePrice();
  const priceCents = quote?.usdCents ?? null;
  return (
    <Sheet open={row !== null} onClose={onClose} title={row ? `${row.year} coins` : ''}>
      {row && (
        <>
          <p className="mb-2 text-sm text-muted">
            {countOf(row.lots.length, 'coin')}, newest first. Tap one to see where it came from.
          </p>
          <TierLegend tiers={tiersPresent(row.byTier)} className="mb-2" />
          <YearTotal lots={row.lots} year={row.year} priceCents={priceCents} />
          <ul className="m-0 list-none p-0">
            {row.lots.map((l) => (
              <CoinRow key={l.id} lot={l} priceCents={priceCents} />
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

function YearTotal({ lots, year, priceCents }: { lots: Lot[]; year: number; priceCents: number | null }) {
  const w = sumWorth(lots, priceCents);
  return (
    <p className="mb-2 mt-0 text-sm" aria-label={`${year} total`}>
      <span className="text-soft">All {year} coins now </span>
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
  return (
    <Card as="section" aria-label="How well your coins are documented" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold">How well it is documented</h2>
        <span className="text-xs text-muted">{view.documentedPercent}%</span>
      </div>
      <div className="flex h-3.5 overflow-hidden rounded-[7px] bg-surface-2" role="img" aria-label={tiers.map((t) => `${TIER_LABEL[t]} ${Math.round((view.mix[t] * 100) / total)} percent`).join(', ')}>
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
              <Amount sats={view.mix[t]} interactive={false} /> · {Math.round((view.mix[t] * 100) / total)}%
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** What the imported coins (opening lots, not removed) cost in all. Money in counts only purchases logged here. */
function importedCostCents(entries: Parameters<typeof buildItems>[0]): number {
  return buildItems(entries).reduce((sum, i) => (!i.deleted && i.current.kind === 'opening-lot' ? sum + i.current.costCents : sum), 0);
}

export function MoneyCard({ view }: { view: HoldingsView }) {
  const { entries, state } = useLedger();
  const imported = useMemo(() => importedCostCents(entries), [entries]);
  const earlier = state.settings.earlierMoneyInCents;
  const help = useHelp(
    'What do these mean?',
    'Put in: dollars you paid for purchases logged in this app, plus anything you entered in Settings for before you started. Taken out: dollars your sales and spending brought in. Not used in tax math.',
  );
  return (
    <Card as="section" aria-label="Money in and out" className="flex flex-col gap-3">
      <h2 className="m-0 flex items-baseline gap-1 text-[15px] font-semibold">
        Money in and out
        {help.button}
      </h2>
      {help.panel}
      <dl className="m-0 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Put in</dt>
          <dd className="m-0 text-xl font-semibold">
            <Money cents={view.moneyInCents} precision="dollars" />
          </dd>
          <dd className="m-0 text-xs text-muted">
            {earlier > 0 ? (
              <>
                Purchases here, plus <Money cents={earlier} precision="dollars" /> from before
              </>
            ) : (
              'Purchases logged here'
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Taken out</dt>
          <dd className="m-0 text-xl font-semibold">
            <Money cents={view.moneyOutCents} precision="dollars" />
          </dd>
          <dd className="m-0 text-xs text-muted">From sales and spending</dd>
        </div>
      </dl>
      {imported > 0 && earlier === 0 ? (
        <p className="m-0 text-xs leading-[1.45] text-soft">
          Your imported coins (cost <Money cents={imported} precision="dollars" />) are not counted here. To count money you put in before
          using this app, enter it in{' '}
          <Link to="/settings#taxes" className="font-semibold text-amber">
            Settings, under Your records
          </Link>
          .
        </p>
      ) : null}
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
            {r.worth.valueCents !== null && (
              <span className="text-xs text-muted">
                Worth <PlainMoney cents={r.worth.valueCents} precision="dollars" />
              </span>
            )}
            {r.costKnown ? (
              <span className="text-xs text-muted">
                <span className="whitespace-nowrap">
                  Cost <PlainMoney cents={r.worth.costCents} precision="dollars" />
                  {r.worth.gainCents !== null ? ' ·' : ''}
                </span>
                {r.worth.gainCents !== null ? (
                  <>
                    {' '}
                    <GainWords worth={r.worth} plain precision="dollars" className="font-semibold" />
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
 * `Average cost $43,450.12 per BTC` for all your Bitcoin (taxable and retirement), under the all-Bitcoin hero. Shown only
 * when every coin's cost is known, so it never mixes in coins without a cost.
 */
export function HeroAverageLine({ view, className }: { view: HoldingsView; className?: string }) {
  const total = view.all?.total;
  if (total === undefined || total.sats <= 0 || total.unknownCostSats > 0) return null;
  return (
    <span className={cx('text-muted', className)}>
      Average cost <Money cents={mulDivRoundHalfUp(total.costCents, SATS_PER_BTC, total.sats)} className="font-semibold text-soft" /> per BTC
    </span>
  );
}

function SplitRowBody({ swatch, label, sub, worth, wide }: { swatch: string; label: string; sub: ReactNode; worth: Worth; wide: boolean }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className={cx('size-2.5 flex-none rounded-[3px]', swatch)} aria-hidden="true" />
          {label}
        </span>
        <span className="text-xs text-muted">{sub}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-0.5 text-right">
        <span className="text-[15px] font-semibold">{worth.valueCents === null ? '—' : <PlainMoney cents={worth.valueCents} precision="dollars" />}</span>
        {worth.valueCents === null ? null : worth.gainCents === null ? (
          <span className="text-xs text-muted">Gain not known</span>
        ) : (
          <GainWords worth={worth} plain precision="dollars" showPercent={wide} className="text-xs font-semibold" />
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
  const all = view.all;
  if (all === null) return null;
  const unknown = all.retirement.unknownCostSats > 0;
  const only = view.retirement.length === 1 ? view.retirement[0] : undefined;
  // Always BTC: the dollars are already at the right, and sats would wrap the line.
  const satsLine = (sats: number) => <Amount sats={sats} short showUnit alwaysBtc interactive={false} />;
  const retirement = (
    <SplitRowBody
      swatch="bg-cream"
      label="Retirement"
      sub={
        <>
          {unknown ? 'Some cost not logged' : 'Kept apart from tax'} · {satsLine(all.retirement.sats)}
        </>
      }
      worth={all.retirement}
      wide={wide}
    />
  );
  return (
    <Card as="section" aria-label="Taxable and retirement" className="flex flex-col gap-2 !px-2.5 !pt-3.5 !pb-2 lg:!px-3">
      {/* Shares by BTC. The rows below carry the figures, so the bar itself is decoration. */}
      <div className="mx-2 flex h-1.5 gap-0.5" aria-hidden="true">
        <span className="min-w-0.5 rounded-full bg-accent" style={{ flexGrow: all.taxable.sats, flexBasis: 0 }} />
        <span className="min-w-0.5 rounded-full bg-cream" style={{ flexGrow: all.retirement.sats, flexBasis: 0 }} />
      </div>
      <ul className={cx('m-0 list-none p-0', wide ? 'grid grid-cols-2 gap-2' : 'flex flex-col divide-y divide-line')}>
        <li className={cx(!wide && 'pb-0.5')}>
          <button type="button" onClick={() => jumpTo(TAXABLE_ID)} className={SPLIT_ROW}>
            <SplitRowBody swatch="bg-accent" label="Taxable" sub={<>Counts for tax · {satsLine(all.taxable.sats)}</>} worth={all.taxable} wide={wide} />
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
