import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { createLocalPriceCache, createLocalSeriesCache, floorToHour, loadChartHistory, seriesPoints, seriesTimes, type ChartHistory, type PricePoint } from '../data/price-history.ts';
import { usePrice } from '../data/price-provider.tsx';
import { demoPriceSeries } from '../demo/demo-data.ts';
import { cx } from '../lib/cx.ts';
import { averageLines, buildHoldingsView, type AverageBasis, type HoldingsView } from '../lib/holdings-view.ts';
import { BalanceNudge } from './BalanceNudge.tsx';
import { LoanNudge, LoansSection } from './loans/loan-parts.tsx';
import { RecentPurchases } from './RecentPurchases.tsx';
import { WalletsCard } from './WalletsTable.tsx';
import { Percent } from './purchase-table.tsx';
import { countOf } from '../lib/format.ts';
import { LOSSES_HELP, LOSSES_TITLE } from '../lib/losses.ts';
import { useHelp } from '../ui/Help.tsx';
import { AddWalletButton, AddWalletSheet } from './wallet/AddWallet.tsx';
import { Amount, Money } from '../ui/Amount.tsx';
import { DesktopCenter, HideButton, LockButton, useIsWide, useLogSheet } from '../ui/AppShell.tsx';
import { Button, buttonClasses } from '../ui/Button.tsx';
import { PlusIcon } from '../ui/icons.tsx';
import { UploadIcon } from '../ui/more-icons.tsx';
import { Card } from '../ui/Card.tsx';
import { SyncIndicator } from '../ui/SyncIndicator.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { PriceChart } from '../ui/PriceChart.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import {
  DocumentationCard,
  HeroAverageLine,
  HeroGainLine,
  heroFigures,
  PriceLine,
  RetirementCard,
  SplitCard,
  StackCard,
  TaxableDivider,
  WalletLinkCard,
  YearSheet,
} from './holdings-parts.tsx';
import { useTitle } from '../ui/use-title.ts';

const YEARS_BACK = 3;

const SERIES_DAYS = YEARS_BACK * 365;

/**
 * Price history for the chart: one point per day, from one request (kept an hour on this device), or the demo's
 * made-up days. If the server has no series, a few quarterly lookups (cached) instead.
 */
function usePriceSeries(): { points: PricePoint[]; loading: boolean; daily: boolean } {
  const { service, quote } = usePrice();
  const { isDemo, today } = useLedger();
  const [live, setLive] = useState<ChartHistory>({ points: [], daily: false });
  const [loaded, setLoaded] = useState(false);
  const nowMs = isDemo ? Date.parse(`${today}T16:00:00Z`) : null;
  const demo = useMemo<ChartHistory | null>(() => (nowMs === null ? null : { points: seriesPoints(demoPriceSeries(nowMs, SERIES_DAYS)), daily: true }), [nowMs]);
  const past = demo ?? live;

  useEffect(() => {
    if (nowMs !== null) return;
    const ctl = new AbortController();
    // Whole hours only, so the cached times don't record when the app was opened.
    const end = floorToHour(Date.now());
    const fallbackTimes = seriesTimes(end, YEARS_BACK * 12, YEARS_BACK * 4 + 1).slice(0, -1).map(floorToHour);
    void loadChartHistory(service, { days: SERIES_DAYS, nowMs: end, fallbackTimes, seriesCache: createLocalSeriesCache(), pointCache: createLocalPriceCache(), signal: ctl.signal, pauseMs: 250 }).then((h) => {
      if (!ctl.signal.aborted) {
        setLive(h);
        setLoaded(true);
      }
    });
    return () => ctl.abort();
  }, [service, nowMs]);

  const points = useMemo(() => {
    // A price the person typed is not a market price: it never joins the chart.
    const last = past.points[past.points.length - 1];
    if (isDemo || quote === null || quote.source === 'manual' || (last !== undefined && quote.asOf <= last.ms)) return past.points;
    return [...past.points, { ms: quote.asOf, cents: quote.usdCents }];
  }, [past, quote, isDemo]);
  return { points, loading: demo === null && !loaded, daily: past.daily };
}

/** No price yet: a soft placeholder the size of the number while it loads, a dash if it could not be fetched. */
function WorthPlaceholder({ loading }: { loading: boolean }) {
  if (loading) return <span role="img" aria-label="Getting the price" className="inline-block h-[0.9em] w-[4.6em] animate-pulse rounded-xl bg-surface-2 align-[-0.05em]" />;
  return <span aria-label="No price right now">$—</span>;
}

function useHoldingsView(): { view: HoldingsView } {
  const { state, holdings, today } = useLedger();
  const { quote } = usePrice();
  const priceCents = quote?.usdCents ?? null;
  const view = useMemo(() => buildHoldingsView(state, holdings, priceCents, today), [state, holdings, priceCents, today]);
  return { view };
}

const UNREALIZED_HELP = 'Unrealized: what you would gain if you sold today. No tax is due until you sell.';

/** The "?" beside "Unrealized gain". */
function useUnrealizedHelp() {
  return useHelp('What is an unrealized gain?', UNREALIZED_HELP);
}

/** The unused losses from earlier returns, with a "?" that says what they are. */

/** No wallet yet: one card, one button, and the sheet opens right here. */
function FirstRun() {
  // Setup sends people here with `?add=wallet` so the sheet is already open.
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(() => params.get('add') === 'wallet');
  useEffect(() => {
    if (params.get('add') === 'wallet') setParams({}, { replace: true });
  }, [params, setParams]);
  return (
    <DesktopCenter>
      <Card className="flex flex-col items-start gap-4">
        <p className="m-0 font-display text-2xl font-semibold tracking-tight">Know what your Bitcoin cost.</p>
        <p className="m-0 text-[15px] leading-relaxed text-muted">Start with the wallet or exchange you use most, or bring in a spreadsheet of your history.</p>
        <div className="flex w-full flex-col gap-2.5 sm:flex-row">
          <Button variant="primary" onClick={() => setOpen(true)}>
            <PlusIcon size={16} />
            Add a wallet
          </Button>
          <Link to="/records?v=io" className={buttonClasses('secondary', 'text-text no-underline hover:text-text')}>
            <UploadIcon size={16} />
            Import a spreadsheet or backup
          </Link>
        </div>
      </Card>
      <AddWalletSheet open={open} onClose={() => setOpen(false)} />
    </DesktopCenter>
  );
}

/** A wallet, but nothing logged in it yet: just the next step (no $0, no empty chart). */
function WalletReady({ view }: { view: HoldingsView }) {
  const log = useLogSheet();
  const first = view.wallets[0];
  // Only a retirement wallet so far: its purchases go in through the retirement form.
  const ira = first === undefined ? view.retirement[0] : undefined;
  const title = view.wallets.length === 1 && first ? `${first.name} is ready.` : view.wallets.length === 0 && view.retirement.length === 1 && ira ? `${ira.name} is ready.` : 'Your wallet is ready.';
  return (
    <DesktopCenter>
      <Card className="flex flex-col items-start gap-4">
        <p className="m-0 font-display text-2xl font-semibold tracking-tight">{title}</p>
        <p className="m-0 text-[15px] leading-relaxed text-muted">Log what you bought, or bring in your history.</p>
        <div className="flex w-full flex-col gap-2.5 sm:flex-row">
          <Button variant="primary" onClick={() => log.open(ira ? { kind: 'retirement-buy', wallet: ira.id } : { kind: 'buy', ...(first ? { wallet: first.id } : {}) })}>
            <PlusIcon size={16} />
            Log a purchase
          </Button>
          <Link to="/records?v=io" className={buttonClasses('secondary', 'text-text no-underline hover:text-text')}>
            <UploadIcon size={16} />
            Import history
          </Link>
        </div>
      </Card>
      <section aria-label="Wallets" className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-0.5 pt-1">
          <h2 className="m-0 text-[15px] font-semibold">Wallets</h2>
          <AddWalletButton compact />
        </div>
        {view.wallets.map((w) => (
          <WalletLinkCard key={w.id} w={w} />
        ))}
        {view.retirement.map((r) => (
          <WalletLinkCard key={r.id} w={{ id: r.id, name: r.name, type: 'retirement', typeLabel: 'Retirement', sats: r.sats, costCents: r.worth.costCents, averageCostCentsPerBtc: null, confirmedLabel: 'Kept apart from tax', needsAttention: false, frozen: false, worth: null, shown: null }} />
        ))}
      </section>
    </DesktopCenter>
  );
}

/** Every taxable lot was bought in the last month, so a short chart is expected. */
function isYoung(view: HoldingsView, today: string): boolean {
  // Lots are newest first in each year: the oldest year's last lot is the first ever bought.
  const first = view.stack.find((r) => r.lots.length > 0)?.lots.at(-1)?.acquiredDate;
  if (first === undefined) return true;
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`) < 30 * 86_400_000;
}

/** The switch's last choice, kept while the app is open (back from a wallet, it is still what was picked). */
let chosenBasis: AverageBasis | null = null;

/**
 * "Price vs. your average cost": three years of price against a dashed average-cost line. With retirement coins a
 * switch picks whose average the line is (All, the default, Taxable or Retirement), and the line under the chart says
 * which one it is, so the card belongs with the whole picture above the Taxable label.
 */
function AverageChartCard({ view, wide }: { view: HoldingsView; wide: boolean }) {
  const { today } = useLedger();
  const { points, loading, daily } = usePriceSeries();
  const lines = averageLines(view);
  const [basis, setBasis] = useState<AverageBasis | null>(chosenBasis);
  const line = lines.find((l) => l.basis === basis) ?? lines[0] ?? null;
  const first = points[0];
  const from = first ? new Date(first.ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
  const choose = (b: AverageBasis) => {
    chosenBasis = b;
    setBasis(b);
  };
  const switcher =
    line !== null && lines.length > 1 ? (
      <Segmented options={lines.map((l) => ({ value: l.basis, label: l.label }))} value={line.basis} onChange={choose} label="Average cost line for" className={wide ? 'w-[300px]' : 'w-full'} />
    ) : null;
  const caption = (
    <span className="inline-flex items-center gap-2">
      <span className="w-4 flex-none border-t-2 border-dashed border-soft" aria-hidden="true" />
      <span>
        {line === null ? 'Your average cost' : line.caption}: {line === null ? '—' : <Money cents={line.centsPerBtc} className="font-semibold text-soft" />}
      </span>
    </span>
  );
  const chart = (
    <PriceChart
      points={points}
      averageCostCents={line?.centsPerBtc ?? null}
      width={wide ? 640 : 320}
      height={wide ? 220 : 96}
      {...(wide ? { strokeWidth: 2.5 } : {})}
      label={`Bitcoin price over three years against ${line === null ? 'your average cost' : line.caption.replace(/^Average cost/, 'the average cost')}`}
      status={loading ? 'loading' : 'ready'}
      young={isYoung(view, today)}
      markHigh={daily}
    />
  );
  return (
    <Card as="section" aria-label="Average cost versus price" className={cx('flex flex-col gap-3', wide && 'col-span-2')}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className={cx('m-0 font-semibold', wide ? 'text-[15px]' : 'text-sm')}>Price vs. your average cost</h2>
        <div className="flex items-center gap-3">
          {wide ? switcher : null}
          <span className={cx('text-muted', wide ? 'text-[13px]' : 'text-xs')}>{YEARS_BACK} years</span>
        </div>
      </div>
      {wide ? null : switcher}
      {chart}
      <div className={cx('flex flex-col gap-1.5 text-muted', wide ? 'text-xs' : 'text-[11px]')}>
        <div className="flex justify-between gap-2">
          <span className="whitespace-nowrap">{from}</span>
          {wide ? caption : null}
          <span className="whitespace-nowrap">Today</span>
        </div>
        {wide ? null : caption}
      </div>
    </Card>
  );
}

/** A figure in the taxable card: a small label, the value, and the lines under it. */
function Figure({ label, children, sub, className }: { label: ReactNode; children: ReactNode; sub: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className="flex items-baseline gap-1 text-xs text-muted">{label}</span>
      <span className="text-lg font-semibold leading-snug">{children}</span>
      <span className="flex flex-col gap-0.5 text-xs leading-snug text-muted">{sub}</span>
    </div>
  );
}

/**
 * What counts for tax, each figure saying exactly what it is: the unrealized gain with its math (worth − cost, in
 * cents), the taxable Bitcoin, the taxable average cost per BTC (beside the average of all your Bitcoin, so the two never
 * look like a contradiction), and losses from past years.
 */
function TaxableFigures({ view }: { view: HoldingsView }) {
  const gainHelp = useUnrealizedHelp();
  const lossHelp = useHelp(`What are ${LOSSES_TITLE.toLowerCase()}?`, LOSSES_HELP);
  const { today } = useLedger();
  const year = today.slice(0, 4);
  const taxable = view.split !== null;
  const worth = view.walletsTotal.worth;
  const gain = worth.gainCents;
  const avg = view.averageCostCentsPerBtc;
  const allAverage = taxable ? (averageLines(view).find((l) => l.basis === 'all') ?? null) : null;
  return (
    <Card as="section" aria-label="Your taxable figures" className="@container flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline gap-1 text-xs text-muted @min-[40rem]:text-[13px]">
          {gain !== null && gain < 0 ? 'Unrealized loss' : 'Unrealized gain'}
          {taxable ? ' on taxable Bitcoin' : ''}
          {gainHelp.button}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="font-display text-[30px] font-semibold leading-none tracking-[-0.02em] @min-[40rem]:text-4xl">
            {gain === null ? '—' : <Money cents={gain} signed className={gain < 0 ? 'text-loss' : 'text-gain'} />}
          </span>
          <Percent worth={worth} className="text-base" />
        </span>
        {worth.valueCents === null ? null : (
          <span className="text-xs leading-normal text-muted @min-[40rem]:text-[13px]">
            Worth{' '}
            <span className="text-soft">
              <Money cents={worth.valueCents} />
            </span>{' '}
            − cost{' '}
            <span className="text-soft">
              <Money cents={worth.costCents} />
            </span>
          </span>
        )}
        {gainHelp.panel}
      </div>
      <div className="grid grid-cols-2 gap-x-3.5 gap-y-4 border-t border-line pt-4 @min-[40rem]:grid-cols-3 @min-[40rem]:gap-x-6">
        <Figure
          label={taxable ? 'Taxable Bitcoin' : 'Your Bitcoin'}
          sub={
            <>
              <span>In {countOf(view.wallets.length, 'wallet')}</span>
              {view.all !== null ? (
                <span>
                  Of <Amount sats={view.all.total.sats} short showUnit interactive={false} /> in all
                </span>
              ) : null}
            </>
          }
        >
          <Amount sats={view.totalSats} short showUnit alwaysBtc />
        </Figure>
        <Figure
          label={taxable ? 'Taxable average cost' : 'Your average cost'}
          sub={
            avg === null ? (
              <span>Some costs are not known yet</span>
            ) : (
              <>
                <span>
                  <Money cents={view.totalCostCents} /> ÷ <Amount sats={view.totalSats} short showUnit interactive={false} alwaysBtc />
                </span>
                {allAverage !== null ? (
                  <span>
                    All your Bitcoin: <Money cents={allAverage.centsPerBtc} /> per BTC
                  </span>
                ) : null}
              </>
            )
          }
        >
          {avg === null ? (
            '—'
          ) : (
            <>
              <Money cents={avg} /> <span className="text-xs font-normal text-muted">per BTC</span>
            </>
          )}
        </Figure>
        <Figure
          className="col-span-2 @min-[40rem]:col-span-1"
          label={
            <>
              {LOSSES_TITLE}
              {lossHelp.button}
            </>
          }
          sub={
            <>
              {view.carryforwardCents > 0 ? (
                <span>
                  {view.carryforward.st > 0 && view.carryforward.lt > 0 ? (
                    <>
                      Short-term <Money cents={view.carryforward.st} /> + long-term <Money cents={view.carryforward.lt} />
                    </>
                  ) : view.carryforward.st > 0 ? (
                    'All short-term'
                  ) : (
                    'All long-term'
                  )}
                </span>
              ) : view.staleLossesFor === null ? (
                <span>None saved for {year}</span>
              ) : null}
              {view.staleLossesFor === null ? null : (
                <span className="leading-snug text-amber">
                  Saved for {view.staleLossesFor}.{' '}
                  <Link to="/settings#taxes" className="font-semibold text-amber underline underline-offset-2 hover:text-text">
                    Update them for {year}
                  </Link>
                </span>
              )}
            </>
          }
        >
          <Money cents={view.carryforwardCents} />
        </Figure>
      </div>
      {lossHelp.panel}
    </Card>
  );
}

// ---- Phone -----------------------------------------------------------------------------

/**
 * One order on both sizes. First the whole picture (taxable and retirement): the total, the split, your stack by year,
 * the price against your average cost, your retirement accounts and loans. Then, under the Taxable label, only what
 * counts for tax: average cost, unrealized gain, losses from past years, wallets, and how well it is documented.
 */
function PhoneHoldings({ view }: { view: HoldingsView }) {
  const { status } = usePrice();
  const [year, setYear] = useState<number | null>(null);
  const picked = view.stack.find((r) => r.year === year) ?? null;
  const hero = heroFigures(view);
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={hero.region} className="flex flex-col gap-1.5">
        <span className="text-[13px] tracking-[0.02em] text-muted">{hero.label}</span>
        <span className="font-display text-[46px] font-semibold leading-none tracking-[-0.03em] text-accent">
          {hero.worthCents === null ? <WorthPlaceholder loading={status === 'loading'} /> : <Money cents={hero.worthCents} precision="dollars" countUp />}
        </span>
        {/* Two lines, always: inline, a longer amount (sats, dollars, or hidden) would wrap the price line and move the page. */}
        <div className="mt-1 flex flex-col items-start gap-0.5">
          <span className="text-[17px] font-semibold">
            <Amount sats={hero.sats} showUnit countUp valueCents={hero.worthCents} className="-my-2.5 inline-flex min-h-11 items-center" />
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <PriceLine className="text-[13px]" />
          </span>
          <HeroGainLine view={view} className="text-[13px]" />
          <HeroAverageLine view={view} className="text-[13px]" />
        </div>
      </section>

      <SplitCard view={view} wide={false} />

      <BalanceNudge />
      <LoanNudge />

      <StackCard view={view} wide={false} onPick={setYear} />
      <AverageChartCard view={view} wide={false} />
      <RetirementCard view={view} />
      <RecentPurchases />
      <LoansSection />

      <TaxableDivider view={view} />

      <TaxableFigures view={view} />

      <WalletsCard view={view} />

      <DocumentationCard view={view} />
      <YearSheet row={picked} onClose={() => setYear(null)} />
    </div>
  );
}

// ---- Desktop ---------------------------------------------------------------------------

function DesktopHoldings({ view }: { view: HoldingsView }) {
  const { status } = usePrice();
  const [year, setYear] = useState<number | null>(null);
  const picked = view.stack.find((r) => r.year === year) ?? null;
  const hero = heroFigures(view);
  const retirement = view.retirement.length > 0;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <section aria-label={hero.region} className="flex flex-col gap-2">
          <span className="text-sm text-muted">{hero.label}</span>
          <span className="font-display text-[64px] font-semibold leading-none tracking-[-0.03em] text-accent">
            {hero.worthCents === null ? <WorthPlaceholder loading={status === 'loading'} /> : <Money cents={hero.worthCents} precision="dollars" countUp />}
          </span>
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <span className="text-xl font-semibold">
              <Amount sats={hero.sats} showUnit countUp valueCents={hero.worthCents} className="-my-2 inline-flex min-h-11 items-center" />
            </span>
            <PriceLine className="text-sm" />
          </div>
          <HeroGainLine view={view} className="text-sm" />
          <HeroAverageLine view={view} className="text-sm" />
        </section>
        <div className="flex items-center gap-2.5">
          <SyncIndicator />
          <HideButton variant="text" />
          <LockButton variant="text" />
        </div>
      </header>

      <SplitCard view={view} wide />

      <BalanceNudge />
      <LoanNudge />

      <StackCard view={view} wide onPick={setYear} />

      {/* Cards keep their own height: a long list should not stretch the one beside it. */}
      <div className={cx('grid items-start gap-4', retirement ? 'grid-cols-3' : 'grid-cols-1')}>
        <AverageChartCard view={view} wide />
        <RetirementCard view={view} />
      </div>

      <RecentPurchases />

      <LoansSection />

      <TaxableDivider view={view} />

      <TaxableFigures view={view} />

      <div className="grid grid-cols-3 items-start gap-4">
        <div className="col-span-2">
          <WalletsCard view={view} />
        </div>
        <DocumentationCard view={view} />
      </div>
      <YearSheet row={picked} onClose={() => setYear(null)} />
    </div>
  );
}

// ---- Screen ----------------------------------------------------------------------------

export function Holdings() {
  const wide = useIsWide();
  const { ready, entries } = useLedger();
  const { view } = useHoldingsView();
  useTitle('Holdings');
  if (!ready) return <div aria-busy="true" className="min-h-[60dvh]" />;
  if (view.isEmpty || entries.every((e) => e.kind === 'wallet')) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Holdings" />
        {view.isEmpty ? <FirstRun /> : <WalletReady view={view} />}
      </div>
    );
  }
  return (
    <>
      <h1 className="sr-only">Holdings</h1>
      {wide ? <DesktopHoldings view={view} /> : <PhoneHoldings view={view} />}
    </>
  );
}
