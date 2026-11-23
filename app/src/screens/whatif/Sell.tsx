import { formatBtc, oldestFirstOrder, parseBtc, yearOf, type SalePlan } from '@bitcoin-basis/engine';
import { TaxTableNotice } from '../../ui/TaxTableNotice.tsx';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { hasLosses, staleLosses } from '../../lib/losses.ts';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { PriceAge } from '../../ui/PriceFreshness.tsx';
import { cx } from '../../lib/cx.ts';
import { formatMoney, satsToCents } from '../../lib/format.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { useIsWide, useLogSheet } from '../../ui/AppShell.tsx';
import { Button } from '../../ui/Button.tsx';
import { PlusIcon } from '../../ui/icons.tsx';
import { Card } from '../../ui/Card.tsx';
import { PriceUnavailable } from '../../ui/PriceProblem.tsx';
import { NoIncomeNote, TaxProfilePrompt } from '../tax/TaxProfilePrompt.tsx';
import { BtcInput } from '../../ui/formatted-inputs.tsx';
import { ChevronDownIcon } from '../../ui/more-icons.tsx';
import { LotsUsedTable, Note, PlanCard, PlanChoice, Sentence } from './sell-parts.tsx';
import { SectionHeader } from '../../ui/SectionHeader.tsx';
import { useLotHelp } from '../../ui/Help.tsx';
import { TERM_HELP } from '../../lib/terms.ts';
import { PickCoinsSheet, PrepareSaleSheet, SaleReviewSheet, WalletSheet } from './sell-sheets.tsx';
import { bestPills, defaultSats, mostCarried, documentationNote, needsBrokerInstruction, picksFromSelection, planFor, planForWallet, stepFor, summarize, type PlanKey } from './sell-logic.ts';

export const PLAN_LABEL: Record<PlanKey, string> = { 'oldest-first': 'Oldest first', 'lowest-tax': 'Lowest tax', 'hand-picked': 'Lots you picked' };

export function Sell() {
  const wide = useIsWide();
  const { open: openLog } = useLogSheet();
  const { state, holdings, today } = useLedger();
  const { quote, status } = usePrice();
  const price = quote?.usdCents ?? null;
  const year = yearOf(today);

  const wallets = useMemo(() => holdings.wallets.filter((w) => !w.frozen && !w.archived && w.sats > 0), [holdings.wallets]);
  const exchanges = wallets.filter((w) => w.type === 'exchange');
  const [chosen, setChosen] = useState<string | null>(null);
  const wallet = wallets.find((w) => w.wallet === chosen) ?? [...exchanges].sort((a, b) => b.sats - a.sats)[0] ?? wallets[0] ?? null;

  const [sats, setSats] = useState<number | null>(null);
  /** What is being typed in the amount box; null while the box just follows the slider. */
  const [typed, setTyped] = useState<string | null>(null);
  const balance = wallet?.sats ?? 0;
  const amount = Math.min(balance, sats ?? defaultSats(balance));
  const step = stepFor(balance);
  const stepsMax = Math.max(1, Math.ceil(balance / step));
  const deferred = useDeferredValue(amount);

  const [handOrder, setHandOrder] = useState<string[] | null>(null);
  const [planKey, setPlanKey] = useState<PlanKey>('lowest-tax');
  const [sheet, setSheet] = useState<'wallet' | 'pick' | 'review' | 'prepare' | null>(null);
  const lotHelp = useLotHelp();

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
  const stale = staleLosses(state.settings, year);

  function pickWallet(id: string) {
    setChosen(id);
    setSats(null);
    setTyped(null);
    setHandOrder(null);
    setPlanKey('lowest-tax');
  }
  function onSlide(position: number) {
    setSats(position >= stepsMax ? balance : Math.min(balance, position * step));
    setTyped(null);
  }
  function onType(text: string) {
    setTyped(text);
    const parsed = parseBtc(text);
    if (parsed !== null && parsed > 0 && parsed <= balance) setSats(parsed);
  }
  const typedBad = typed !== null && typed !== '' && (parseBtc(typed) === null || (parseBtc(typed) ?? 0) > balance || parseBtc(typed) === 0);

  if (wallet === null) {
    return (
      <Card className="flex flex-col items-start gap-3 text-[15px] text-muted">
        <p className="m-0">Nothing to sell yet. Log a purchase and your options show up here.</p>
        <Button variant="primary" onClick={() => openLog({ kind: 'buy' })}>
          <PlusIcon size={16} />
          Log a purchase
        </Button>
      </Card>
    );
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
          <span>
            {wallet.name} · <Amount sats={wallet.sats} showUnit interactive={false} />
          </span>
          <ChevronDownIcon size={14} className="text-muted" />
        </button>
      </div>

      <section aria-label="Amount to sell" className="flex flex-col items-center gap-1 pt-1">
        <span className="font-display text-[40px] font-semibold tracking-[-0.02em]">
          <Amount sats={amount} showUnit interactive={false} />
        </span>
        <span className="text-[15px] text-muted">
          {price === null ? (
            status === 'error' ? 'Needs today’s price.' : 'Getting the price…'
          ) : (
            <>
              ≈ <Money cents={satsToCents(amount, price)} /> at {quote?.source === 'manual' ? 'your price ' : ''}
              {formatMoney(price)}
              <PriceAge quote={quote} />
            </>
          )}
        </span>
        <input
          type="range"
          aria-label="Amount to sell"
          aria-valuetext={`${balance === 0 ? 0 : Math.round((amount * 100) / balance)} percent of this wallet`}
          min={0}
          max={stepsMax}
          step={1}
          value={Math.min(stepsMax, Math.round(amount / step))}
          onChange={(e) => onSlide(Number(e.target.value))}
          className="mt-3 h-7 w-full accent-accent"
        />
        <div className="mt-1 flex w-full items-start gap-3">
          <BtcInput
            label="Or type an amount"
            value={typed ?? formatBtc(amount)}
            onChange={onType}
            onBlur={() => {
              if (!typedBad) setTyped(null);
            }}
            trailing="BTC"
            error={typedBad ? 'Use a number of BTC up to what this wallet holds.' : null}
            frameClassName="flex-1"
          />
          <Button className="mt-[22px] min-h-[52px]" onClick={() => onSlide(stepsMax)}>
            All
          </Button>
        </div>
      </section>
    </div>
  );

  let body;
  if (price === null) {
    body = status === 'error' ? <PriceUnavailable need="Selling needs a price to estimate what you would get and the tax." /> : <Card className="text-[15px] text-muted">Getting the price…</Card>;
  } else if (deferred <= 0) {
    body = <Card className="text-[15px] text-muted">Slide to choose how much to sell.</Card>;
  } else if (planned && !planned.plans.ok) {
    body = <Card className="text-[15px] text-loss">{planned.plans.error.message}</Card>;
  } else if (plans && active) {
    const summary = summarize(plans.oldestFirst, plans.lowestTax);
    const choices: { key: PlanKey; plan: SalePlan }[] = [
      { key: 'oldest-first', plan: plans.oldestFirst },
      { key: 'lowest-tax', plan: plans.lowestTax },
      ...(plans.handPicked ? [{ key: 'hand-picked' as const, plan: plans.handPicked }] : []),
    ];
    const pills = bestPills(choices.map((c) => c.plan));
    const carryBest = mostCarried(choices.map((c) => c.plan));
    body = (
      <>
        <div className="flex flex-col gap-2">
          <SectionHeader title="Which lots to sell" help={lotHelp.button} className="px-0.5" />
          {lotHelp.panel}
          <PlanChoice label="Which lots to sell" className={cx('grid grid-cols-2 gap-x-2.5 pt-2.5 lg:gap-x-3', choices.length === 3 && 'lg:grid-cols-3')}>
            {choices.map((c, i) => (
              <PlanCard
                key={c.key}
                title={PLAN_LABEL[c.key]}
                plan={c.plan}
                active={activeKey === c.key}
                onSelect={() => setPlanKey(c.key)}
                pill={pills[i] ?? null}
                carryBest={carryBest[i] ?? false}
                className={c.key === 'hand-picked' ? 'col-span-2 mt-5 lg:col-span-1 lg:mt-0' : ''}
              />
            ))}
          </PlanChoice>
        </div>
        <LotsUsedTable planName={PLAN_LABEL[activeKey]} plan={active} />
        <Card as="section" aria-label="What this means" className="flex flex-col gap-3 !rounded-2xl !p-3.5">
          <Note tone="warn">
            <Sentence parts={summary} />
          </Note>
          {active.totalTaxCents <= 0 && active.gainCents > 0 && hasLosses(state.settings, year, today) && <Note>Covered by losses from past years.</Note>}
          {stale !== null && (
            <Note tone="warn">
              Your losses from past years are saved for {stale.savedFor}.{' '}
              <Link to="/settings#taxes" className="font-semibold">
                Update them for {year}
              </Link>
            </Note>
          )}
          <TaxTableNotice year={year} />
          <NoIncomeNote />
          {active.headsUp && <Note tone="warn">This sale adds more than $1,000 of estimated tax. You may need to make an estimated payment before filing.</Note>}
          {closed && <Note tone="warn">{year} is closed. Unlock it in Tax season before logging a sale in it.</Note>}
          <details className="group">
            {/* The 44px tap target overlaps the card's gap, so "Why?" sits as close as the lines above it. */}
            <summary className="-my-2.5 flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-soft">Why?</summary>
            <div className="flex flex-col gap-3 pb-1 pt-3.5">
              <Note>{TERM_HELP}</Note>
              <Note>{documentationNote(plans.oldestFirst, plans.lowestTax)}</Note>
              {plans.lowestTax.deferredNote !== null && needsBrokerInstruction(plans.lowestTax) && <Note>{plans.lowestTax.deferredNote}</Note>}
              {plans.lowestTax.note !== null && <Note>{plans.lowestTax.note}</Note>}
              {needsBrokerInstruction(active) && !selfCustody && <Note>Tell {wallet.name} which lots to sell before you sell. Otherwise it may use its own order.</Note>}
              <p className="m-0 text-xs text-muted">Estimates, not tax advice. Based on your tax settings.</p>
            </div>
          </details>
        </Card>
        <div className="flex flex-col gap-2.5">
          <div className="flex gap-2.5">
            <Button className="min-h-[52px] flex-1 !rounded-2xl" onClick={() => setSheet('pick')}>
              Pick lots
            </Button>
            {selfCustody ? (
              <Button variant="primary" className="min-h-[52px] flex-[1.6] !rounded-2xl" onClick={() => setSheet('prepare')} disabled={exchanges.length === 0}>
                Prepare this sale
              </Button>
            ) : (
              <Button variant="primary" className="min-h-[52px] flex-[1.6] !rounded-2xl" onClick={() => setSheet('review')} disabled={closed}>
                I sold it, log it
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
      <div className="flex flex-col gap-3">
        <TaxProfilePrompt />
        {body}
      </div>

      <WalletSheet open={sheet === 'wallet'} onClose={() => setSheet(null)} wallets={wallets} selected={wallet.wallet} onPick={pickWallet} />
      {sheet === 'pick' && (
        <PickCoinsSheet
          open
          onClose={() => setSheet(null)}
          state={state}
          wallet={wallet.wallet}
          sats={amount}
          today={today}
          label={PLAN_LABEL[activeKey]}
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
