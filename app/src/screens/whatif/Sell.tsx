import { parseBtc, yearOf } from '@bitcoin-basis/engine';
import { useDeferredValue, useMemo, useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { formatMoney, satsToCents } from '../../lib/format.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { useIsWide } from '../../ui/AppShell.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Field } from '../../ui/Field.tsx';
import { ChevronDownIcon } from '../../ui/more-icons.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { Note, PlanCard, Sentence } from './sell-parts.tsx';
import { PickCoinsSheet, PrepareSaleSheet, SaleReviewSheet, WalletSheet } from './sell-sheets.tsx';
import { carriedOut, needsBrokerInstruction, picksFromSelection, planFor, planForWallet, satsForSlider, sliderForSats, SLIDER_MAX, summarize, type PlanKey } from './sell-logic.ts';
import { oldestFirstOrder } from '@bitcoin-basis/engine';

const START_POSITION = 400;

export function Sell() {
  const wide = useIsWide();
  const { state, holdings, today } = useLedger();
  const { quote, status } = usePrice();
  const price = quote?.usdCents ?? null;
  const year = yearOf(today);

  const wallets = useMemo(() => holdings.wallets.filter((w) => !w.frozen && !w.archived && w.sats > 0), [holdings.wallets]);
  const exchanges = wallets.filter((w) => w.type === 'exchange');
  const [chosen, setChosen] = useState<string | null>(null);
  const wallet = wallets.find((w) => w.wallet === chosen) ?? [...exchanges].sort((a, b) => b.sats - a.sats)[0] ?? wallets[0] ?? null;

  const [sats, setSats] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const balance = wallet?.sats ?? 0;
  const amount = Math.min(balance, sats ?? satsForSlider(balance, START_POSITION));
  const deferred = useDeferredValue(amount);

  const [handOrder, setHandOrder] = useState<string[] | null>(null);
  const [planKey, setPlanKey] = useState<PlanKey>('lowest-tax');
  const [sheet, setSheet] = useState<'wallet' | 'pick' | 'review' | 'prepare' | null>(null);

  const lots = useMemo(() => (wallet ? oldestFirstOrder(state.lots, wallet.wallet) : []), [state.lots, wallet]);
  const hand = useMemo(() => (handOrder ? picksFromSelection(lots, handOrder, deferred) : null), [handOrder, lots, deferred]);
  const handPicks = hand && hand.short === 0 && hand.picks.length > 0 ? hand.picks : undefined;

  const planned = useMemo(() => {
    if (wallet === null || price === null || deferred <= 0) return null;
    return planForWallet(state, state.settings, { wallet: wallet.wallet, sats: deferred, priceCents: price, onDate: today, year, ...(handPicks ? { handPicks } : {}) });
  }, [state, wallet, price, deferred, today, year, handPicks]);

  const plans = planned?.plans.ok ? planned.plans.value : null;
  const selfCustody = planned?.selfCustody ?? wallet?.type === 'self-custody';
  const activeKey: PlanKey = planKey === 'hand-picked' && plans?.handPicked == null ? 'lowest-tax' : planKey;
  const active = plans ? planFor(plans, activeKey) : null;
  const closed = state.closedYears.includes(year);

  function pickWallet(id: string) {
    setChosen(id);
    setSats(null);
    setTyped('');
    setHandOrder(null);
    setPlanKey('lowest-tax');
  }
  function onSlide(position: number) {
    setSats(satsForSlider(balance, position));
    setTyped('');
  }
  function onType(text: string) {
    setTyped(text);
    const parsed = parseBtc(text);
    if (parsed !== null && parsed > 0 && parsed <= balance) setSats(parsed);
  }
  const typedBad = typed !== '' && (parseBtc(typed) === null || (parseBtc(typed) ?? 0) > balance || parseBtc(typed) === 0);

  if (wallet === null) {
    return <Card className="text-[15px] text-muted">Nothing to sell yet. Log a purchase first, or load the demo book from Holdings.</Card>;
  }

  const controls = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted">Selling from</span>
        <button
          type="button"
          onClick={() => setSheet('wallet')}
          aria-haspopup="dialog"
          className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-text hover:bg-surface-2"
        >
          {wallet.name} · <Amount sats={wallet.sats} short interactive={false} /> BTC
          <ChevronDownIcon size={14} className="text-muted" />
        </button>
      </div>

      <section aria-label="Amount to sell" className="flex flex-col items-center gap-1 pt-1">
        <span className="font-display text-[40px] font-semibold tracking-[-0.02em]">
          <Amount sats={amount} showUnit interactive={false} />
        </span>
        <span className="text-[15px] text-muted">
          {price === null ? (
            status === 'error' ? 'No price right now.' : 'Getting the price…'
          ) : (
            <>
              ≈ <Money cents={satsToCents(amount, price)} /> at {formatMoney(price)}
            </>
          )}
        </span>
        <input
          type="range"
          aria-label="Amount to sell"
          aria-valuetext={`${Math.round(sliderForSats(balance, amount) / 10)} percent of this wallet`}
          min={0}
          max={SLIDER_MAX}
          step={1}
          value={sliderForSats(balance, amount)}
          onChange={(e) => onSlide(Number(e.target.value))}
          className="mt-3 h-7 w-full accent-accent"
        />
        <div className="mt-1 flex w-full items-start gap-3">
          <Field
            label="Or type an amount"
            inputMode="decimal"
            placeholder="0.0000"
            suffix="BTC"
            value={typed}
            onChange={(e) => onType(e.target.value)}
            aria-invalid={typedBad}
            hint={typedBad ? 'Use a number of BTC up to what this wallet holds.' : undefined}
            className="flex-1"
          />
          <Button className="mt-[22px]" onClick={() => onSlide(SLIDER_MAX)}>
            All
          </Button>
        </div>
      </section>
    </div>
  );

  let body;
  if (price === null) {
    body = <Card className="text-[15px] text-muted">{status === 'error' ? 'The price could not be loaded, so there is nothing to compare yet.' : 'Getting the price…'}</Card>;
  } else if (deferred <= 0) {
    body = <Card className="text-[15px] text-muted">Slide to choose how much to sell.</Card>;
  } else if (planned && !planned.plans.ok) {
    body = <Card className="text-[15px] text-loss">{planned.plans.error.message}</Card>;
  } else if (plans && active) {
    const summary = summarize(plans.oldestFirst, plans.lowestTax);
    const options = [
      { value: 'oldest-first' as const, label: 'Oldest first' },
      { value: 'lowest-tax' as const, label: 'Lowest tax' },
      ...(plans.handPicked ? [{ value: 'hand-picked' as const, label: 'Your picks' }] : []),
    ];
    body = (
      <>
        <div className={cx('grid gap-2.5', plans.handPicked ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2')}>
          <PlanCard title="Oldest first" plan={plans.oldestFirst} year={year} active={activeKey === 'oldest-first'} carryBest={carriedOut(plans.oldestFirst) > carriedOut(plans.lowestTax)} />
          <PlanCard title="Lowest tax" plan={plans.lowestTax} year={year} active={activeKey === 'lowest-tax'} carryBest={carriedOut(plans.lowestTax) > carriedOut(plans.oldestFirst)} />
          {plans.handPicked && <PlanCard title="Your picks" plan={plans.handPicked} year={year} active={activeKey === 'hand-picked'} className="col-span-2 lg:col-span-1" />}
        </div>
        <Card as="section" aria-label="What this means" className="flex flex-col gap-3 !rounded-2xl !p-3.5">
          <Note tone="warn">
            <Sentence parts={summary} />
          </Note>
          {plans.lowestTax.deferredNote !== null && needsBrokerInstruction(plans.lowestTax) && <Note>{plans.lowestTax.deferredNote}</Note>}
          {plans.lowestTax.note !== null && <Note>{plans.lowestTax.note}</Note>}
          {active.headsUp && <Note tone="warn">This sale adds more than $1,000 of estimated tax. You may need to make an estimated payment before filing.</Note>}
          {needsBrokerInstruction(active) && !selfCustody && <Note>Tell {wallet.name} which coins to sell before you sell. Otherwise it may use its own order.</Note>}
          {closed && <Note tone="warn">{year} is closed. Unlock it in Tax season before logging a sale in it.</Note>}
          <p className="m-0 text-xs text-muted">Estimates, not tax advice. Based on your settings in Records.</p>
        </Card>
        <div className="flex flex-col gap-2.5">
          <Segmented<PlanKey> label="Coins to use" value={activeKey} onChange={setPlanKey} options={options} />
          <div className="flex gap-2.5">
            <Button className="min-h-[52px] flex-1 !rounded-2xl" onClick={() => setSheet('pick')}>
              Pick coins
            </Button>
            {selfCustody ? (
              <Button variant="primary" className="min-h-[52px] flex-[1.6] !rounded-2xl" onClick={() => setSheet('prepare')} disabled={exchanges.length === 0}>
                Prepare this sale
              </Button>
            ) : (
              <Button variant="primary" className="min-h-[52px] flex-[1.6] !rounded-2xl" onClick={() => setSheet('review')} disabled={closed}>
                Log this sale
              </Button>
            )}
          </div>
          {selfCustody && <p className="m-0 text-xs text-muted">Self-custody coins are moved to an exchange first. This logs that move; the sale comes after.</p>}
        </div>
      </>
    );
  }

  return (
    <div className={cx(wide ? 'grid grid-cols-[minmax(0,360px)_minmax(0,1fr)] items-start gap-8' : 'flex flex-col gap-3')}>
      <div className={cx(wide && 'sticky top-8')}>{controls}</div>
      <div className="flex flex-col gap-3">{body}</div>

      <WalletSheet open={sheet === 'wallet'} onClose={() => setSheet(null)} wallets={wallets} selected={wallet.wallet} onPick={pickWallet} />
      {sheet === 'pick' && (
        <PickCoinsSheet
          open
          onClose={() => setSheet(null)}
          state={state}
          wallet={wallet.wallet}
          sats={amount}
          today={today}
          initial={handOrder ?? (plans ? planFor(plans, activeKey).picks.map((p) => p.lotId) : [])}
          onUse={(order) => {
            setHandOrder(order);
            setPlanKey('hand-picked');
          }}
        />
      )}
      {sheet === 'review' && price !== null && (
        <SaleReviewSheet
          open
          onClose={() => setSheet(null)}
          walletId={wallet.wallet}
          sats={amount}
          strategy={activeKey}
          handPicks={handPicks}
          priceCents={price}
          year={year}
          onSaved={() => {
            setSats(null);
            setHandOrder(null);
            setPlanKey('lowest-tax');
          }}
        />
      )}
      {sheet === 'prepare' && price !== null && (
        <PrepareSaleSheet
          open
          onClose={() => setSheet(null)}
          walletId={wallet.wallet}
          sats={amount}
          strategy={activeKey}
          handPicks={handPicks}
          priceCents={price}
          year={year}
          exchanges={exchanges}
          onSaved={pickWallet}
        />
      )}
    </div>
  );
}
