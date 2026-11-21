import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { floorToHour, loadPriceSeries, memoryPriceCache, seriesTimes, createLocalPriceCache, type PricePoint } from '../data/price-history.ts';
import { usePrice } from '../data/price-provider.tsx';
import { demoPriceAt } from '../demo/demo-data.ts';
import { cx } from '../lib/cx.ts';
import { buildHoldingsView, type HoldingsView } from '../lib/holdings-view.ts';
import { BalanceNudge } from './BalanceNudge.tsx';
import { LoanNudge, LoansSection } from './loans/loan-parts.tsx';
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
import {
  DocumentationCard,
  GainText,
  HeroGainLine,
  heroFigures,
  MoneyCard,
  PriceLine,
  RetirementCard,
  SplitCard,
  StackColumns,
  TaxableDivider,
  StackRows,
  TIER_COLORS_HELP,
  TierLegend,
  tiersPresent,
  WalletLinkCard,
  WalletRow,
  YearSheet,
} from './holdings-parts.tsx';
import { useTitle } from '../ui/use-title.ts';

const YEARS_BACK = 3;

/** Price history for the chart: monthly for the demo, a few quarterly points (cached) for the live service. */
function usePriceSeries(): { points: PricePoint[]; loading: boolean } {
  const { service, quote } = usePrice();
  const { isDemo, today } = useLedger();
  const [past, setPast] = useState<PricePoint[]>([]);
  const [loaded, setLoaded] = useState(false);
  const nowMs = isDemo ? Date.parse(`${today}T16:00:00Z`) : null;

  useEffect(() => {
    const ctl = new AbortController();
    // Live: whole hours only, so the cached times don't record when the app was opened.
    const end = nowMs ?? floorToHour(Date.now());
    const times = isDemo ? seriesTimes(end, YEARS_BACK * 12, YEARS_BACK * 12 + 1) : seriesTimes(end, YEARS_BACK * 12, YEARS_BACK * 4 + 1).slice(0, -1).map(floorToHour);
    const svc = isDemo ? { current: service.current, historical: (ts: number) => Promise.resolve(demoPriceAt(ts * 1000)) } : service;
    const cache = isDemo ? memoryPriceCache() : createLocalPriceCache();
    void loadPriceSeries(svc, times, cache, { signal: ctl.signal, pauseMs: isDemo ? 0 : 250 }).then((pts) => {
      if (!ctl.signal.aborted) {
        setPast(pts);
        setLoaded(true);
      }
    });
    return () => ctl.abort();
  }, [service, isDemo, nowMs]);

  const points = useMemo(() => {
    // A price the person typed is not a market price: it never joins the chart.
    if (isDemo || quote === null || quote.source === 'manual') return past;
    return [...past, { ms: quote.fetchedAt, cents: quote.usdCents }];
  }, [past, quote, isDemo]);
  return { points, loading: !loaded };
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
function LossesStat({ view, variant }: { view: HoldingsView; variant: 'row' | 'tile' }) {
  const help = useHelp(`What are ${LOSSES_TITLE.toLowerCase()}?`, LOSSES_HELP);
  const { today } = useLedger();
  const forYear = view.lossesYear !== null && view.lossesYear !== Number(today.slice(0, 4)) ? ` (for ${view.lossesYear})` : '';
  const money = <Money cents={view.carryforwardCents} precision="dollars" />;
  if (variant === 'row') {
    return (
      <div className="flex flex-col gap-2 border-t border-line pt-2.5">
        <div className="flex items-baseline justify-between">
          <span className="flex items-baseline gap-1 text-xs text-muted">
            {LOSSES_TITLE}
            {forYear}
            {help.button}
          </span>
          <span className="text-[15px] font-semibold">{money}</span>
        </div>
        {help.panel}
      </div>
    );
  }
  return (
    <>
      <span className="flex items-baseline gap-1 text-[13px] text-muted">
        {LOSSES_TITLE}
        {forYear}
        {help.button}
      </span>
      <span className="text-2xl font-semibold">{money}</span>
      {help.panel}
    </>
  );
}

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
          <WalletLinkCard key={r.id} w={{ id: r.id, name: r.name, type: 'retirement', typeLabel: 'Retirement', sats: r.sats, costCents: r.worth.costCents, averageCostCentsPerBtc: null, confirmedLabel: 'Kept apart from tax', needsAttention: false, frozen: false }} />
        ))}
      </section>
    </DesktopCenter>
  );
}

/** Every coin was bought in the last month, so a short chart is expected. */
function isYoung(view: HoldingsView, today: string): boolean {
  const first = view.stack[0]?.lots[0]?.acquiredDate;
  if (first === undefined) return true;
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`) < 30 * 86_400_000;
}

function ChartFooter({ points, className }: { points: PricePoint[]; className?: string }) {
  const first = points[0];
  return (
    <div className={cx('flex justify-between text-muted', className)}>
      <span>{first ? new Date(first.ms).getUTCFullYear() : ''}</span>
      <span>Dashed line: your average cost</span>
      <span>Today</span>
    </div>
  );
}

// ---- Phone -----------------------------------------------------------------------------

function PhoneHoldings({ view }: { view: HoldingsView }) {
  const { quote, status, error } = usePrice();
  const { today } = useLedger();
  const { points: series, loading: seriesLoading } = usePriceSeries();
  const young = isYoung(view, today);
  const [year, setYear] = useState<number | null>(null);
  const picked = view.stack.find((r) => r.year === year) ?? null;
  const tierHelp = useHelp('What do the colors mean?', TIER_COLORS_HELP);
  const gainHelp = useUnrealizedHelp();
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
            <Amount sats={hero.sats} showUnit countUp className="-my-2.5 inline-flex min-h-11 items-center" />
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <PriceLine quote={quote} status={status} error={error} className="text-[13px]" />
          </span>
          <HeroGainLine view={view} className="text-[13px]" />
        </div>
      </section>

      <SplitCard view={view} wide={false} />

      <BalanceNudge />
      <LoanNudge />

      <TaxableDivider view={view} />

      <Card as="section" aria-label="Average cost versus price" className="flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted">Your average cost</span>
            <span className="text-xl font-semibold">{view.averageCostCentsPerBtc === null ? '—' : <Money cents={view.averageCostCentsPerBtc} />}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="flex items-baseline gap-1 text-xs text-muted">
              Unrealized gain
              {gainHelp.button}
            </span>
            <GainText cents={view.gainCents} className="text-xl font-semibold" />
          </div>
        </div>
        {gainHelp.panel}
        <PriceChart points={series} averageCostCents={view.averageCostCentsPerBtc} width={320} height={84} label="Bitcoin price over three years against your average cost line" status={seriesLoading ? 'loading' : 'ready'} young={young} />
        <ChartFooter points={series} className="text-[11px]" />
        <LossesStat view={view} variant="row" />
      </Card>

      <Card as="section" aria-label="Your coins by age" className="flex flex-col gap-2.5">
        <h2 className="m-0 text-[15px] font-semibold">Your stack, by year bought</h2>
        <StackRows stack={view.stack} onPick={setYear} />
        <div className="mt-0.5 flex items-center gap-1">
          <TierLegend tiers={tiersPresent(view.mix)} mix={view.mix} />
          {tierHelp.button}
        </div>
        {tierHelp.panel}
      </Card>

      <section aria-label="Wallets" className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-0.5 pt-1">
          <h2 className="m-0 text-[15px] font-semibold">Wallets</h2>
          <AddWalletButton compact />
        </div>
        {view.wallets.map((w) => (
          <WalletLinkCard key={w.id} w={w} />
        ))}
      </section>

      <LoansSection />

      <MoneyCard view={view} />
      <RetirementCard view={view} />
      <YearSheet row={picked} onClose={() => setYear(null)} />
    </div>
  );
}

// ---- Desktop ---------------------------------------------------------------------------

function DesktopHoldings({ view }: { view: HoldingsView }) {
  const { quote, status, error } = usePrice();
  const { today } = useLedger();
  const { points: series, loading: seriesLoading } = usePriceSeries();
  const young = isYoung(view, today);
  const [year, setYear] = useState<number | null>(null);
  const picked = view.stack.find((r) => r.year === year) ?? null;
  const avg = view.averageCostCentsPerBtc;
  const tierHelp = useHelp('What do the colors mean?', TIER_COLORS_HELP);
  const gainHelp = useUnrealizedHelp();
  const hero = heroFigures(view);
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
              <Amount sats={hero.sats} showUnit countUp className="-my-2 inline-flex min-h-11 items-center" />
            </span>
            <PriceLine quote={quote} status={status} error={error} className="text-sm" />
          </div>
          <HeroGainLine view={view} className="text-sm" />
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

      <TaxableDivider view={view} />

      <div className="grid grid-cols-3 gap-4">
        <Card className="flex flex-col gap-1.5 !rounded-[18px] !p-[18px]">
          <span className="text-[13px] text-muted">Your average cost</span>
          <span className="text-2xl font-semibold">{avg === null ? '—' : <Money cents={avg} />}</span>
        </Card>
        <Card className="flex flex-col gap-1.5 !rounded-[18px] !p-[18px]">
          <span className="flex items-baseline gap-1 text-[13px] text-muted">
            Unrealized gain
            {gainHelp.button}
          </span>
          <GainText cents={view.gainCents} className="text-2xl font-semibold" />
          {gainHelp.panel}
        </Card>
        <Card className="flex flex-col gap-1.5 !rounded-[18px] !p-[18px]">
          <LossesStat view={view} variant="tile" />
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card as="section" aria-label="Average cost versus price" className="col-span-2 flex flex-col gap-3">
          <div className="flex justify-between">
            <h2 className="m-0 text-[15px] font-semibold">Price vs. your average cost</h2>
            <span className="text-[13px] text-muted">{YEARS_BACK} years</span>
          </div>
          <PriceChart points={series} averageCostCents={avg} width={640} height={220} strokeWidth={2.5} label="Bitcoin price over three years against your average cost line" status={seriesLoading ? 'loading' : 'ready'} young={young} />
          <div className="flex justify-between text-xs text-muted">
            <span>{series[0] ? new Date(series[0].ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''}</span>
            <span>Dashed: your average cost, {avg === null ? '—' : <Money cents={avg} />}</span>
            <span>Today</span>
          </div>
        </Card>

        <Card as="section" aria-label="Wallets" className="flex flex-col gap-1">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Wallets</h2>
          {view.wallets.map((w) => (
            <WalletRow key={w.id} w={w} />
          ))}
          <AddWalletButton className="mt-2 self-start" />
        </Card>
      </div>

      <LoansSection />

      <Card as="section" aria-label="Your coins by age" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[15px] font-semibold">Your stack, by year bought</h2>
          <div className="flex items-center gap-1">
            <TierLegend tiers={tiersPresent(view.mix)} />
            {tierHelp.button}
          </div>
        </div>
        {tierHelp.panel}
        <StackColumns stack={view.stack} onPick={setYear} />
        <span className="text-xs text-muted">
          {view.documentedPercent}% documented. Pick a year to see each coin and where it came from.
        </span>
      </Card>

      {/* Cards keep their own height: a long Held apart list should not stretch the short ones. */}
      <div className="grid grid-cols-3 items-start gap-4">
        <MoneyCard view={view} />
        <DocumentationCard view={view} />
        <RetirementCard view={view} />
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
