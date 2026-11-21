import { parseBtc, parseDollars, planBorrow, taxContext, yearOf } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { formatMoney } from '../../lib/format.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { useIsWide, useLogSheet } from '../../ui/AppShell.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { BtcInput, MoneyInput, PercentInput } from '../../ui/formatted-inputs.tsx';
import { SelectBox } from '../../ui/Field.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { loadScenarios, parsePercentBp, priceScale, roomPercent, saveScenarios, type SavedScenario } from './borrow-logic.ts';
import { Note } from './sell-parts.tsx';
import { percentFromBp, rangeLabel } from './sell-logic.ts';

function Bar({ plan, todayCents }: { plan: { liquidationPriceCents: number; marginCallPriceCents: number }; todayCents: number }) {
  const s = priceScale(plan, todayCents);
  const markers = [
    { key: 'liq', label: 'Liquidation', cents: plan.liquidationPriceCents, at: s.liquidation },
    { key: 'mc', label: 'Margin call', cents: plan.marginCallPriceCents, at: s.marginCall },
    { key: 'now', label: 'Today', cents: todayCents, at: s.today },
  ].sort((a, b) => a.cents - b.cents);
  const aria = `Bitcoin price scale: ${markers.map((m) => `${m.label.toLowerCase()} at ${formatMoney(m.cents, { precision: 'dollars' })}`).join(', ')}`;
  const lo = Math.min(s.liquidation, s.marginCall);
  const hi = Math.max(s.liquidation, s.marginCall);
  return (
    <div role="img" aria-label={aria} className="flex flex-col gap-1.5">
      <div className="relative h-4 overflow-hidden rounded-lg bg-line">
        <div className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(135deg,rgb(217_133_120/0.65)_0_6px,rgb(217_133_120/0.35)_6px_12px)]" style={{ width: `${lo}%` }} />
        <div className="absolute inset-y-0 bg-amber/75" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        <div className="absolute inset-y-0 bg-[linear-gradient(90deg,rgb(247_147_26/0.25),rgb(247_147_26/0.7))]" style={{ left: `${hi}%`, width: `${Math.max(0, s.today - hi)}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-soft">
        {markers.map((m, i) => (
          <span key={m.key} className={cx('flex flex-col', i === markers.length - 1 && 'items-end text-right', i === 1 && 'items-center text-center')}>
            {m.label}
            <strong className="text-text">{formatMoney(m.cents, { precision: 'dollars' })}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

const DEFAULTS = { loan: '25000', pledge: '1', rate: '11.5', marginCall: '70', liquidation: '80' };

export function Borrow() {
  const wide = useIsWide();
  const { open: openLog } = useLogSheet();
  const toast = useToast();
  const { state, holdings, today } = useLedger();
  const { quote, status } = usePrice();
  const price = quote?.usdCents ?? null;
  const year = yearOf(today);

  const wallets = useMemo(() => holdings.wallets.filter((w) => !w.frozen && !w.archived && w.sats > 0), [holdings.wallets]);
  const biggest = [...wallets].sort((a, b) => b.sats - a.sats)[0];
  const [walletId, setWalletId] = useState<string | null>(null);
  const wallet = wallets.find((w) => w.wallet === walletId) ?? biggest ?? null;
  const [loan, setLoan] = useState(DEFAULTS.loan);
  const [pledge, setPledge] = useState(DEFAULTS.pledge);
  const [rate, setRate] = useState(DEFAULTS.rate);
  const [marginCall, setMarginCall] = useState(DEFAULTS.marginCall);
  const [liquidation, setLiquidation] = useState(DEFAULTS.liquidation);
  const [saved, setSaved] = useState<SavedScenario[]>(() => loadScenarios());

  const loanCents = parseDollars(loan);
  const pledgedSats = parseBtc(pledge);
  const rateBp = parsePercentBp(rate);
  const mcBp = parsePercentBp(marginCall);
  const liqBp = parsePercentBp(liquidation);

  const outcome = useMemo(() => {
    if (wallet === null || price === null) return { kind: 'wait' as const };
    if (loanCents === null || loanCents <= 0) return { kind: 'bad' as const, message: 'Enter how much you would borrow, in dollars.' };
    if (pledgedSats === null || pledgedSats <= 0) return { kind: 'bad' as const, message: 'Enter how much BTC you would put up.' };
    if (pledgedSats > wallet.sats) return { kind: 'bad' as const, message: `${wallet.name} does not hold that much. Lower the BTC you put up, or pick another wallet.` };
    if (rateBp === null || mcBp === null || liqBp === null) return { kind: 'bad' as const, message: 'Interest and the two limits are percentages, like 11.5 and 70.' };
    if (mcBp > liqBp) return { kind: 'bad' as const, message: 'Margin call must be at or below where the lender sells.' };
    const r = planBorrow({
      ...taxContext(state, state.settings, year, today),
      loanCents,
      ratePerYear: rateBp,
      marginCallLtv: mcBp,
      liquidationLtv: liqBp,
      pledgedSats,
      priceCents: price,
      lots: state.lots,
      wallets: state.wallets,
      wallet: wallet.wallet,
    });
    return r.ok ? { kind: 'plan' as const, plan: r.value } : { kind: 'bad' as const, message: r.error.message };
  }, [wallet, price, loanCents, pledgedSats, rateBp, mcBp, liqBp, state, year, today]);

  function save() {
    if (wallet === null) return;
    const id = `${Date.now().toString(36)}-${saved.length}`;
    const next = [...saved, { id, wallet: wallet.wallet, loan, pledge, rate, marginCall, liquidation }];
    setSaved(next);
    saveScenarios(next);
    toast.show('Scenario saved on this device.');
  }
  function load(s: SavedScenario) {
    setWalletId(s.wallet);
    setLoan(s.loan);
    setPledge(s.pledge);
    setRate(s.rate);
    setMarginCall(s.marginCall);
    setLiquidation(s.liquidation);
  }
  function remove(id: string) {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    saveScenarios(next);
  }

  if (wallet === null) {
    return (
      <Card className="flex flex-col items-start gap-3 text-[15px] text-muted">
        <p className="m-0">Nothing to borrow against yet. Log a purchase first.</p>
        <Button variant="primary" onClick={() => openLog({ kind: 'buy' })}>
          Log a purchase
        </Button>
      </Card>
    );
  }

  const inputs = (
    <section aria-label="Loan" className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <MoneyInput label="Borrow" value={loan} onChange={setLoan} trailing="USD" />
        <BtcInput label="Put up" value={pledge} onChange={setPledge} trailing="BTC" />
        <PercentInput label="Interest" value={rate} onChange={setRate} trailing="% a year" frameClassName="col-span-2" />
        <PercentInput label="Margin call at" value={marginCall} onChange={setMarginCall} />
        <PercentInput label="Lender sells at" value={liquidation} onChange={setLiquidation} />
      </div>
      <p className="m-0 text-xs text-muted">Your lender's limits, as a % of the loan to the coins' value.</p>
      <SelectBox label="Coins put up from" value={wallet.wallet} onChange={(e) => setWalletId(e.target.value)}>
        {wallets.map((w) => (
          <option key={w.wallet} value={w.wallet}>
            {w.name}
          </option>
        ))}
      </SelectBox>
    </section>
  );

  let results;
  if (outcome.kind === 'wait') {
    results = <Card className="text-[15px] text-muted">{status === 'error' ? 'The price could not be loaded, so there is nothing to work out yet.' : 'Getting the price…'}</Card>;
  } else if (outcome.kind === 'bad') {
    results = (
      <Card role="alert" className="text-[15px] text-loss">
        {outcome.message}
      </Card>
    );
  } else if (price !== null) {
    const { plan } = outcome;
    const sale = plan.liquidation.sale;
    const covered = sale.totalTaxCents === 0 && sale.gainCents > 0 && state.settings.carryforwardStCents + state.settings.carryforwardLtCents > 0;
    const rows: [string, ReactNode][] = [
      ['Interest a year', <Money key="i" cents={plan.interestPerYearCents} precision="dollars" />],
      [
        'If liquidated, lender sells',
        <span key="s">
          <Amount sats={plan.liquidation.satsSold} showUnit interactive={false} />, your oldest ({rangeLabel(sale.coinsFrom, sale.coinsTo)})
        </span>,
      ],
      [
        'Tax that sale would add',
        <span key="t">
          <Money cents={sale.totalTaxCents} precision="dollars" /> · {sale.gainCents < 0 ? 'loss' : 'gain'} <Money cents={Math.abs(sale.gainCents)} precision="dollars" />
          {covered ? ' covered by carryforward' : ''}
        </span>,
      ],
    ];
    results = (
      <>
        <section aria-label="Loan vs. coin value" className="flex flex-col gap-3.5 rounded-[18px] border-[1.5px] border-accent bg-[linear-gradient(180deg,rgb(247_147_26/0.16),rgb(247_147_26/0.04))] p-4">
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold tracking-[0.02em] text-amber">LOAN VS. COIN VALUE TODAY</span>
              <span className="font-display text-[34px] font-semibold leading-[1.1]">{percentFromBp(plan.ltvBp)}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-soft">Price could fall</span>
              <span className="text-xl font-bold">{roomPercent(plan.dropToLiquidationBp)}%</span>
              <span className="text-xs text-soft">before liquidation</span>
            </div>
          </div>
          <Bar plan={plan} todayCents={price} />
        </section>
        <section aria-label="Costs" className="rounded-[18px] border border-line bg-surface px-4 py-0.5">
          <dl className="m-0">
            {rows.map(([k, v], i) => (
              <div key={k} className={cx('flex min-h-[52px] items-center justify-between gap-4', i < rows.length - 1 && 'border-b border-line')}>
                <dt className="text-sm text-soft">{k}</dt>
                <dd className="m-0 text-right text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </>
    );
  }

  return (
    <div className={cx(wide ? 'grid grid-cols-[minmax(0,380px)_minmax(0,1fr)] items-start gap-8' : 'flex flex-col gap-3.5')}>
      <div className="flex flex-col gap-3">{inputs}</div>
      <div className="flex flex-col gap-3">
        {results}
        <Note>Planning only. A liquidation is a sale, so it uses up coins and can create tax. Lenders differ: check how yours picks coins. Estimates, not tax advice.</Note>
        <div className="flex gap-2.5">
          <Button className="min-h-[54px] flex-1 !rounded-2xl" onClick={save} disabled={outcome.kind !== 'plan'}>
            Save this scenario
          </Button>
        </div>
        {saved.length > 0 && (
          <section aria-label="Saved scenarios" className="flex flex-col gap-2">
            <h2 className="m-0 text-[15px] font-semibold">Saved scenarios</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {saved.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2">
                  <span className="min-w-0 text-sm">
                    <Money cents={parseDollars(s.loan) ?? 0} precision="dollars" /> against {s.pledge} BTC at {s.rate}%
                    <span className="block text-xs text-muted">{state.wallets.find((w) => w.id === s.wallet)?.name ?? 'a wallet'} · limits {s.marginCall}% and {s.liquidation}%</span>
                  </span>
                  <span className="flex gap-1.5">
                    <Button onClick={() => load(s)} aria-label={`Open the scenario: loan of ${s.loan} dollars`}>
                      Open
                    </Button>
                    <Button variant="ghost" onClick={() => remove(s.id)} aria-label={`Delete the scenario: loan of ${s.loan} dollars`}>
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

