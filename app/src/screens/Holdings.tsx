import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { loadPriceSeries, memoryPriceCache, seriesTimes, createLocalPriceCache, type PricePoint } from '../data/price-history.ts';
import { usePrice } from '../data/price-provider.tsx';
import { demoPriceAt } from '../demo/demo-data.ts';
import { cx } from '../lib/cx.ts';
import { buildHoldingsView, type HoldingsView } from '../lib/holdings-view.ts';
import { formatMoney } from '../lib/format.ts';
import { AddWalletButton } from './wallet/AddWallet.tsx';
import { Amount, Money } from '../ui/Amount.tsx';
import { HideButton, LockButton, useIsWide } from '../ui/AppShell.tsx';
import { buttonClasses } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { SyncIndicator } from '../ui/SyncIndicator.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { PriceChart } from '../ui/PriceChart.tsx';
import {
  DocumentationCard,
  GainText,
  MoneyCard,
  PriceLine,
  RetirementCard,
  StackColumns,
  StackRows,
  TierLegend,
  tiersPresent,
  WalletLinkCard,
  WalletRow,
  YearSheet,
} from './holdings-parts.tsx';

const YEARS_BACK = 3;

/** Price history for the chart: monthly for the demo, a few quarterly points (cached) for the live service. */
function usePriceSeries(): PricePoint[] {
  const { service, quote } = usePrice();
  const { isDemo, today } = useLedger();
  const [past, setPast] = useState<PricePoint[]>([]);
  const nowMs = isDemo ? Date.parse(`${today}T16:00:00Z`) : null;

  useEffect(() => {
    const ctl = new AbortController();
    const end = nowMs ?? Date.now();
    const times = isDemo ? seriesTimes(end, YEARS_BACK * 12, YEARS_BACK * 12 + 1) : seriesTimes(end, YEARS_BACK * 12, YEARS_BACK * 4 + 1).slice(0, -1);
    const svc = isDemo ? { current: service.current, historical: (ts: number) => Promise.resolve(demoPriceAt(ts * 1000)) } : service;
    const cache = isDemo ? memoryPriceCache() : createLocalPriceCache();
    void loadPriceSeries(svc, times, cache, { signal: ctl.signal, pauseMs: isDemo ? 0 : 250 }).then((pts) => {
      if (!ctl.signal.aborted) setPast(pts);
    });
    return () => ctl.abort();
  }, [service, isDemo, nowMs]);

  return useMemo(() => {
    if (isDemo || quote === null) return past;
    return [...past, { ms: quote.fetchedAt, cents: quote.usdCents }];
  }, [past, quote, isDemo]);
}

function useHoldingsView(): { view: HoldingsView; priceCents: number | null } {
  const { state, holdings, today } = useLedger();
  const { quote } = usePrice();
  const priceCents = quote?.usdCents ?? null;
  const view = useMemo(() => buildHoldingsView(state, holdings, priceCents, today), [state, holdings, priceCents, today]);
  return { view, priceCents };
}

function FirstRun() {
  return (
    <Card className="flex flex-col items-start gap-4 lg:max-w-xl">
      <p className="m-0 font-display text-2xl font-semibold tracking-tight">Know what your Bitcoin cost.</p>
      <p className="m-0 text-[15px] leading-relaxed text-muted">Nothing is logged yet. Add a wallet, then log what you bought or import your history.</p>
      <div className="flex flex-wrap gap-2.5">
        <Link to="/records?v=wallets" className={buttonClasses('primary', 'no-underline hover:text-bg')}>
          Add a wallet
        </Link>
      </div>
    </Card>
  );
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

function PhoneHoldings({ view, priceCents }: { view: HoldingsView; priceCents: number | null }) {
  const { quote, status, error } = usePrice();
  const series = usePriceSeries();
  const [year, setYear] = useState<number | null>(null);
  const picked = view.stack.find((r) => r.year === year) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="What your Bitcoin is worth" className="flex flex-col gap-1.5">
        <span className="text-[13px] tracking-[0.02em] text-muted">Your Bitcoin is worth</span>
        <span className="font-display text-[46px] font-semibold leading-none tracking-[-0.03em] text-accent">
          {view.worthCents === null ? <span aria-label="Waiting for the price">$—</span> : <Money cents={view.worthCents} precision="dollars" countUp />}
        </span>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-[17px] font-semibold">
            <Amount sats={view.totalSats} showUnit countUp />
          </span>
          <PriceLine quote={quote} status={status} error={error} className="text-[13px]" />
        </div>
      </section>

      <Card as="section" aria-label="Average cost versus price" className="flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted">Your average cost</span>
            <span className="text-xl font-semibold">{view.averageCostCentsPerBtc === null ? '—' : formatMoney(view.averageCostCentsPerBtc)}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-xs text-muted">Gain on paper</span>
            <GainText cents={view.gainCents} className="text-xl font-semibold" />
          </div>
        </div>
        <PriceChart points={series} averageCostCents={view.averageCostCentsPerBtc} width={320} height={84} label="Bitcoin price over three years against your average cost line" />
        <ChartFooter points={series} className="text-[11px]" />
      </Card>

      <Card as="section" aria-label="Your coins by age" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 text-[15px] font-semibold">Your stack</h2>
          <span className="text-xs text-muted">
            {view.lotCount} lots · {view.documentedPercent}% documented
          </span>
        </div>
        <StackRows stack={view.stack} onPick={setYear} />
        <TierLegend tiers={tiersPresent(view.mix)} className="mt-0.5" />
      </Card>

      <section aria-label="Wallets" className="flex flex-col gap-2">
        {view.wallets.map((w) => (
          <WalletLinkCard key={w.id} w={w} />
        ))}
      </section>

      <MoneyCard view={view} />
      <DocumentationCard view={view} />
      <RetirementCard view={view} priceCents={priceCents} />
      <YearSheet row={picked} onClose={() => setYear(null)} />
    </div>
  );
}

// ---- Desktop ---------------------------------------------------------------------------

function DesktopHoldings({ view, priceCents }: { view: HoldingsView; priceCents: number | null }) {
  const { quote, status, error } = usePrice();
  const series = usePriceSeries();
  const [year, setYear] = useState<number | null>(null);
  const picked = view.stack.find((r) => r.year === year) ?? null;
  const avg = view.averageCostCentsPerBtc;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <section aria-label="What your Bitcoin is worth" className="flex flex-col gap-2">
          <span className="text-sm text-muted">Your Bitcoin is worth</span>
          <span className="font-display text-[64px] font-semibold leading-none tracking-[-0.03em] text-accent">
            {view.worthCents === null ? <span aria-label="Waiting for the price">$—</span> : <Money cents={view.worthCents} precision="dollars" countUp />}
          </span>
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <span className="text-xl font-semibold">
              <Amount sats={view.totalSats} showUnit countUp />
            </span>
            <PriceLine quote={quote} status={status} error={error} className="text-sm" />
          </div>
        </section>
        <div className="flex items-center gap-2.5">
          <SyncIndicator />
          <HideButton variant="text" />
          <LockButton variant="text" />
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Card className="flex flex-col gap-1.5 !rounded-[18px] !p-[18px]">
          <span className="text-[13px] text-muted">Your average cost</span>
          <span className="text-2xl font-semibold">{avg === null ? '—' : formatMoney(avg)}</span>
        </Card>
        <Card className="flex flex-col gap-1.5 !rounded-[18px] !p-[18px]">
          <span className="text-[13px] text-muted">Gain on paper</span>
          <GainText cents={view.gainCents} className="text-2xl font-semibold" />
        </Card>
        <Card className="flex flex-col gap-1.5 !rounded-[18px] !p-[18px]">
          <span className="text-[13px] text-muted">Loss carryforward</span>
          <span className="text-2xl font-semibold">
            <Money cents={view.carryforwardCents} precision="dollars" />
          </span>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card as="section" aria-label="Average cost versus price" className="col-span-2 flex flex-col gap-3">
          <div className="flex justify-between">
            <h2 className="m-0 text-[15px] font-semibold">Price vs. your average cost</h2>
            <span className="text-[13px] text-muted">{YEARS_BACK} years</span>
          </div>
          <PriceChart points={series} averageCostCents={avg} width={640} height={220} strokeWidth={2.5} label="Bitcoin price over three years against your average cost line" />
          <div className="flex justify-between text-xs text-muted">
            <span>{series[0] ? new Date(series[0].ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''}</span>
            <span>Dashed: your average cost, {avg === null ? '—' : formatMoney(avg, { precision: 'dollars' })}</span>
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

      <Card as="section" aria-label="Your coins by age" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-[15px] font-semibold">Your stack, by year bought</h2>
          <TierLegend tiers={tiersPresent(view.mix)} />
        </div>
        <StackColumns stack={view.stack} onPick={setYear} />
        <span className="text-xs text-muted">
          {view.lotCount} lots · {view.documentedPercent}% documented. Pick a year to see each coin and where it came from.
        </span>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <MoneyCard view={view} />
        <DocumentationCard view={view} />
        <RetirementCard view={view} priceCents={priceCents} />
      </div>
      <YearSheet row={picked} onClose={() => setYear(null)} />
    </div>
  );
}

// ---- Screen ----------------------------------------------------------------------------

export function Holdings() {
  const wide = useIsWide();
  const { ready } = useLedger();
  const { view, priceCents } = useHoldingsView();
  if (!ready) return <div aria-busy="true" className="min-h-[60dvh]" />;
  if (view.isEmpty) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Holdings" />
        <FirstRun />
      </div>
    );
  }
  return (
    <>
      <h1 className="sr-only">Holdings</h1>
      {wide ? <DesktopHoldings view={view} priceCents={priceCents} /> : <PhoneHoldings view={view} priceCents={priceCents} />}
    </>
  );
}
