import { mulDivRoundHalfUp, SATS_PER_BTC, type Lot, type Tier } from '@bitcoin-basis/engine';
import { useState } from 'react';
import { Link } from 'react-router';
import { dayChangeTenthsPercent, type PriceQuote } from '../data/price.ts';
import { cx } from '../lib/cx.ts';
import { formatDay, formatMoney, longDate, satsToCents } from '../lib/format.ts';
import type { HoldingsView, StackYear, WalletCard } from '../lib/holdings-view.ts';
import { describeOrigin, TIER_HELP, TIER_LABEL } from '../lib/origin.ts';
import { useLedger } from '../data/ledger-provider.tsx';
import { Amount, Money } from '../ui/Amount.tsx';
import { PlainMoney } from '../ui/plain-money.tsx';
import { Card } from '../ui/Card.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { ChevronRightIcon } from '../ui/icons.tsx';
import { useHelp } from '../ui/Help.tsx';

export const TIER_BG: Record<Tier, string> = {
  documented: 'bg-accent',
  reconstructed: 'bg-cream',
  estimated: 'bg-tier-estimated',
  unknown: 'bg-tier-unknown',
};
const TIER_ORDER: Tier[] = ['documented', 'reconstructed', 'estimated', 'unknown'];

// ---- Hero ------------------------------------------------------------------------------

export function PriceLine({ quote, status, error, className }: { quote: PriceQuote | null; status: string; error: string | null; className?: string }) {
  if (quote === null) {
    return <span className={cx('text-muted', className)}>{status === 'error' ? `${error ?? 'No price right now.'} Showing cost only.` : 'Getting the price…'}</span>;
  }
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

/** What the colours mean. With `mix` it also says how much of your stack each one is (so there is no separate card for it on a phone). */
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

/** What the four colours mean, for a "?" next to a legend. */
export const TIER_COLORS_HELP = 'The colour says how sure the cost is. Documented: a receipt or export backs it up. Reconstructed: rebuilt from statements. Estimated: a best guess. Unknown: no cost yet.';

/** Tiers that actually have coins, documented first. */
export function tiersPresent(mix: Record<Tier, number>): Tier[] {
  const present = TIER_ORDER.filter((t) => mix[t] > 0);
  return present.length > 0 ? present : ['documented', 'reconstructed'];
}

// ---- Coins of one year, with their origin ----------------------------------------------

function CoinRow({ lot }: { lot: Lot }) {
  const { entries, state, today } = useLedger();
  const [open, setOpen] = useState(false);
  const origin = entries.find((e) => e.id === lot.originEntryId);
  const wallets = new Map(state.wallets.map((w) => [w.id, w]));
  const wallet = wallets.get(lot.wallet);
  const perBtc = lot.sats === 0 ? null : mulDivRoundHalfUp(lot.costCents, SATS_PER_BTC, lot.sats);
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-14 w-full items-center gap-3 bg-transparent py-2 text-left text-text">
        <span className={cx('h-8 w-1.5 flex-none rounded-full', TIER_BG[lot.tier])} aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">
            <Amount sats={lot.sats} interactive={false} />
          </span>
          <span className="truncate text-xs text-muted">
            {longDate(lot.acquiredDate)} · {wallet?.name ?? 'Wallet'}
          </span>
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
                · <Money cents={perBtc} precision="dollars" /> per BTC
              </span>
            )}
          </dd>
          <dt className="text-muted">Record</dt>
          <dd>{lot.proof || 'None yet'}</dd>
          <dt className="text-muted">How sure</dt>
          <dd>
            {TIER_LABEL[lot.tier]}. {TIER_HELP[lot.tier]}
          </dd>
          <dt className="text-muted">Bought</dt>
          <dd>{formatDay(lot.acquiredDate, today)}</dd>
        </dl>
      )}
    </li>
  );
}

export function YearSheet({ row, onClose }: { row: StackYear | null; onClose(): void }) {
  return (
    <Sheet open={row !== null} onClose={onClose} title={row ? `${row.year} coins` : ''}>
      {row && (
        <>
          <p className="mb-2 text-sm text-muted">
            {row.lots.length} {row.lots.length === 1 ? 'coin' : 'coins'}, oldest first. Tap one to see where it came from.
          </p>
          <TierLegend tiers={tiersPresent(row.byTier)} className="mb-2" />
          <ul className="m-0 list-none p-0">
            {row.lots.map((l) => (
              <CoinRow key={l.id} lot={l} />
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

// ---- Wallets ---------------------------------------------------------------------------

export function WalletLinkCard({ w }: { w: WalletCard }) {
  return (
    <Link to={`/wallet/${w.id}`} className="press-soft flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-line bg-surface py-3 pl-3.5 pr-2.5 text-text no-underline hover:bg-surface-2 hover:text-text active:bg-surface-2">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{w.name}</span>
        <span className={cx('text-xs normal-nums', w.needsAttention ? 'text-amber' : 'text-muted')}>
          {w.typeLabel} · {w.needsAttention ? 'needs a check' : w.confirmedLabel}
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
        <span className={cx('text-xs', w.needsAttention ? 'text-amber' : 'text-muted')}>{w.needsAttention ? 'Needs a check' : capitalize(w.confirmedLabel)}</span>
      </span>
      <ChevronRightIcon size={16} className="-ml-1 flex-none text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Extra cards (below the design's first screen) -------------------------------------

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

export function MoneyCard({ view }: { view: HoldingsView }) {
  const help = useHelp('What do these mean?', 'In is what you paid for coins. Out is what sales, spending and fees paid in BTC brought in.');
  return (
    <Card as="section" aria-label="Money in and out" className="flex flex-col gap-3">
      <h2 className="m-0 flex items-baseline gap-1 text-[15px] font-semibold">
        Money in and out
        {help.button}
      </h2>
      <dl className="m-0 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Put in</dt>
          <dd className="m-0 text-xl font-semibold">
            <Money cents={view.moneyInCents} precision="dollars" />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Taken out</dt>
          <dd className="m-0 text-xl font-semibold">
            <Money cents={view.moneyOutCents} precision="dollars" />
          </dd>
        </div>
      </dl>
      {help.panel}
    </Card>
  );
}

export function RetirementCard({ view, priceCents }: { view: HoldingsView; priceCents: number | null }) {
  if (view.retirement.length === 0 && view.frozen.length === 0) return null;
  return (
    <Card as="section" aria-label="Held apart from your total" className="flex flex-col gap-3">
      <h2 className="m-0 text-[15px] font-semibold">Held apart</h2>
      <p className="m-0 text-xs text-muted">Not counted in what your Bitcoin is worth or in your average cost.</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {view.retirement.map((r) => (
          <li key={r.id}>
            <Link to={`/wallet/${r.id}`} className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-text no-underline last:border-b-0 hover:text-text">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="text-xs text-muted">Retirement · view only</span>
                {priceCents !== null && (
                  <span className="text-xs text-muted">
                    Worth <PlainMoney cents={satsToCents(r.sats, priceCents)} precision="dollars" />
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Amount sats={r.sats} interactive={false} />
                <ChevronRightIcon size={16} className="flex-none text-muted" />
              </span>
            </Link>
          </li>
        ))}
        {view.frozen.map((w) => (
          <li key={w.id}>
            <Link to={`/wallet/${w.id}`} className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-text no-underline last:border-b-0 hover:text-text">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{w.name}</span>
                <span className="text-xs text-muted">Frozen platform</span>
                <span className="text-xs text-muted">
                  Cost <PlainMoney cents={w.costCents} precision="dollars" />
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Amount sats={w.sats} interactive={false} />
                <ChevronRightIcon size={16} className="flex-none text-muted" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
