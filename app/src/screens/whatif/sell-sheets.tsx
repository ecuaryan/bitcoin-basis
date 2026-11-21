import { formatCents, oldestFirstOrder, parseDollars, planPrepareSale, type LotPick, type LedgerState, type SalePlan, type SellEntry, type MoveEntry, type WalletHolding } from '@bitcoin-basis/engine';
import { TaxTableNotice } from '../../ui/TaxTableNotice.tsx';
import { useSubmit } from '../../ui/use-submit.ts';
import { useMemo, useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { countOf, satsToCents, shortDate } from '../../lib/format.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Field, SelectBox } from '../../ui/Field.tsx';
import { MoneyInput } from '../../ui/formatted-inputs.tsx';
import type { Draft } from '../log/draft.ts';
import { Review } from '../log/Review.tsx';
import { saleDraft } from '../log/sale-review.tsx';
import { entryInstant, newIdGenerator } from '../../ui/new-entry.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { useLotHelp } from '../../ui/Help.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { needsBrokerInstruction, picksFromSelection, planFor, planForWallet, rangeLabel, type PlanKey } from './sell-logic.ts';
import { Note, TierChip } from './sell-parts.tsx';

// ---- Wallet picker -----------------------------------------------------------------------

export function WalletSheet({ open, onClose, wallets, selected, onPick }: { open: boolean; onClose(): void; wallets: readonly WalletHolding[]; selected: string | null; onPick(id: string): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Selling from">
      <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
        {wallets.map((w) => (
          <li key={w.wallet}>
            <button
              type="button"
              aria-pressed={w.wallet === selected}
              onClick={() => {
                onPick(w.wallet);
                onClose();
              }}
              className={cx(
                'flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-left text-text',
                w.wallet === selected ? 'border-accent bg-accent/10' : 'border-line bg-bg hover:bg-surface-2',
              )}
            >
              <span className="flex flex-col">
                <span className="text-[15px] font-semibold">{w.name}</span>
                <span className="text-xs normal-nums text-muted">{w.type === 'self-custody' ? 'Self-custody: move to an exchange to sell' : 'Exchange'}</span>
              </span>
              <span className="text-sm font-semibold">
                <Amount sats={w.sats} showUnit short interactive={false} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ---- Pick lots ---------------------------------------------------------------------------

export function PickCoinsSheet({
  open,
  onClose,
  state,
  wallet,
  sats,
  initial,
  label,
  onUse,
}: {
  open: boolean;
  onClose(): void;
  state: LedgerState;
  wallet: string;
  sats: number;
  /** Lot ids to start from (the plan on screen). */
  initial: readonly string[];
  /** Name of the plan those lots came from, such as "Lowest tax". */
  label?: string;
  today: string;
  onUse(order: string[]): void;
}) {
  const lots = useMemo(() => oldestFirstOrder(state.lots, wallet), [state.lots, wallet]);
  const [order, setOrder] = useState<string[]>([...initial]);
  const [changed, setChanged] = useState(false);
  const lotHelp = useLotHelp();
  // Ticked coins first, so they are in view when the sheet opens. The order stays put while ticking.
  const [listed] = useState(() => {
    const start = new Set(initial);
    return [...lots.filter((l) => start.has(l.id)), ...lots.filter((l) => !start.has(l.id))];
  });
  const { picks, short } = useMemo(() => picksFromSelection(lots, order, sats), [lots, order, sats]);
  const used = new Map(picks.map((p) => [p.lotId, p.sats]));
  function toggle(id: string) {
    setChanged(true);
    setOrder((o) => {
      if (o.includes(id)) return o.filter((x) => x !== id);
      // Already covered: the new coin goes in ahead of the newest one, which is trimmed (or dropped) to make room.
      const covered = picksFromSelection(lots, o, sats).short === 0;
      const lastUsed = covered ? o.findLastIndex((x) => used.has(x)) : -1;
      const next = lastUsed < 0 ? [...o, id] : [...o.slice(0, lastUsed), id, ...o.slice(lastUsed)];
      const r = picksFromSelection(lots, next, sats);
      const kept = new Set(r.picks.map((p) => p.lotId));
      return next.filter((x) => kept.has(x));
    });
  }
  return (
    <Sheet open={open} onClose={onClose} title="Pick lots">
      <div className="flex flex-col gap-3 pb-3">
        <p className="m-0 flex items-baseline gap-1 text-[13px] text-muted">
          <span>Tick the lots to sell. The last one is trimmed to fit.</span>
          {lotHelp.button}
        </p>
        {lotHelp.panel}
        <div role="status" className={cx('rounded-xl border px-3 py-2 text-sm font-semibold', short === 0 ? 'border-accent text-amber' : 'border-line text-soft')}>
          {short === 0 ? (
            <>
              {countOf(picks.length, 'lot')} ticked{label !== undefined && !changed ? ` (${label})` : ''}. They cover <Amount sats={sats} showUnit interactive={false} />.
            </>
          ) : (
            <>
              Still needed: <Amount sats={short} showUnit interactive={false} />
            </>
          )}
        </div>
        <ul className="m-0 flex max-h-[44dvh] list-none flex-col overflow-y-auto p-0">
          {listed.map((l) => {
            const taken = used.get(l.id);
            const on = order.includes(l.id);
            return (
              <li key={l.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-line-soft py-1.5">
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={on} onChange={() => toggle(l.id)} className="size-5 flex-none accent-accent" />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">Bought {shortDate(l.acquiredDate)}</span>
                    <TierChip tier={l.tier} />
                  </span>
                </label>
                <span className="flex flex-col items-end text-right">
                  <span className="text-sm font-semibold">
                    <Amount sats={taken ?? l.sats} interactive={false} />
                  </span>
                  <span className="text-xs text-muted">
                    {taken !== undefined && taken < l.sats ? 'part of ' : ''}
                    cost <Money cents={l.costCents} />
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2.5">
          <Button
            className="flex-1"
            onClick={() => {
              setChanged(true);
              setOrder([]);
            }}
          >
            Clear
          </Button>
          <Button
            variant="primary"
            className="flex-[1.6]"
            disabled={short !== 0}
            onClick={() => {
              onUse(order);
              onClose();
            }}
          >
            Use these lots
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---- Review and save ---------------------------------------------------------------------

function useSaveContext() {
  const { entries, state, isDemo, today, append } = useLedger();
  return { entries, state, isDemo, today, append };
}

/** The review a sale ends on: the same one the Log sheet shows, with the sale price on top. */
export function SaleReviewSheet({
  open,
  onClose,
  walletId,
  sats,
  strategy,
  handPicks,
  priceCents,
  year,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  walletId: string;
  sats: number;
  strategy: PlanKey;
  handPicks: readonly LotPick[] | undefined;
  priceCents: number;
  year: number;
  onSaved(): void;
}) {
  const { entries, state, isDemo, today } = useSaveContext();
  const [priceText, setPriceText] = useState(() => formatCents(priceCents));
  const price = parseDollars(priceText);
  const wallet = state.wallets.find((w) => w.id === walletId);
  const planned = useMemo(() => {
    if (price === null || price <= 0) return null;
    const r = planForWallet(state, state.settings, { wallet: walletId, sats, priceCents: price, onDate: today, year, ...(handPicks ? { handPicks } : {}) }).plans;
    return r.ok ? r.value : null;
  }, [state, walletId, sats, price, today, year, handPicks]);
  const plan = planned ? planFor(planned, strategy) : null;
  const closed = state.closedYears.includes(year);
  const nowMs = Date.parse(entryInstant(isDemo, today));
  const [entryId] = useState(() => newIdGenerator(entries)());

  const draft: Draft | null = useMemo(() => {
    if (plan === null || wallet === undefined) return null;
    const entry: SellEntry = {
      id: entryId,
      kind: 'sell',
      at: entryInstant(isDemo, today),
      tz: state.settings.timeZone,
      wallet: walletId,
      sats,
      proceedsCents: plan.proceedsCents,
      picks: plan.picks,
      spent: false,
      proof: wallet.defaultProof,
      note: 'Logged from What if',
    };
    const lots = oldestFirstOrder(state.lots, walletId);
    const extra = (
      <>
        {needsBrokerInstruction(plan) && <Note tone="warn">Tell {wallet.name} which lots to sell before you sell. Without instructions it may use its own order.</Note>}
        {plan.estimatedShareBp > 0 && <Note>Some of these lots have an Estimated or Unknown cost. Confirm how to report that with your CPA.</Note>}
        <TaxTableNotice year={year} />
        {closed && <Note tone="warn">{year} is closed. Unlock it in Tax season before logging a sale in it.</Note>}
      </>
    );
    return saleDraft({ entry, walletName: wallet.name, lots, onDate: today, nowMs, extra });
  }, [plan, wallet, entryId, isDemo, today, state.settings.timeZone, state.lots, walletId, sats, closed, year, nowMs]);

  return (
    <Sheet open={open} onClose={onClose} title="Log your sale">
      <div className="flex flex-col gap-3.5 pb-3">
        <MoneyInput label="Sale price per BTC" value={priceText} onChange={setPriceText} trailing="USD" hint="What your exchange paid. Change it if the fill differed." />
        {draft === null || closed ? (
          <p className="m-0 text-sm text-loss">{closed ? `${year} is closed. Unlock it in Tax season before logging a sale in it.` : 'Enter a price above zero.'}</p>
        ) : (
          <Review
            draft={draft}
            showTitle={false}
            onBack={onClose}
            onSaved={() => {
              onSaved();
              onClose();
            }}
          />
        )}
      </div>
    </Sheet>
  );
}

// ---- Prepare a sale from self-custody ----------------------------------------------------

/** Moves the chosen coins to an exchange wallet (the sale itself happens there, so it is logged afterwards). */
export function PrepareSaleSheet({
  open,
  onClose,
  walletId,
  sats,
  strategy,
  handPicks,
  priceCents,
  year,
  exchanges,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  walletId: string;
  sats: number;
  strategy: PlanKey;
  handPicks: readonly LotPick[] | undefined;
  priceCents: number;
  year: number;
  exchanges: readonly WalletHolding[];
  onSaved(destination: string): void;
}) {
  const { entries, state, isDemo, today, append } = useSaveContext();
  const toast = useToast();
  const [dest, setDest] = useState(exchanges[0]?.wallet ?? '');
  const [feeText, setFeeText] = useState('0');
  const feeSats = /^\d+$/.test(feeText.trim()) ? Number(feeText.trim()) : null;
  const wallet = state.wallets.find((w) => w.id === walletId);
  const destName = state.wallets.find((w) => w.id === dest)?.name ?? '';

  const result = useMemo(() => {
    if (feeSats === null || feeSats >= sats || dest === '') return null;
    const total = sats + feeSats;
    const have = state.lots.filter((l) => l.wallet === walletId).reduce((s, l) => s + l.sats, 0);
    if (total > have) return null;
    const plans = planForWallet(state, state.settings, { wallet: walletId, sats: total, priceCents, onDate: today, year, ...(handPicks && feeSats === 0 ? { handPicks } : {}) }).plans;
    if (!plans.ok) return null;
    const plan: SalePlan = planFor(plans.value, strategy === 'hand-picked' && feeSats !== 0 ? 'lowest-tax' : strategy);
    const draft = planPrepareSale(state, { fromWallet: walletId, toWallet: dest, picks: plan.picks, feeSats, feeValueCents: satsToCents(feeSats, priceCents) });
    return draft.ok ? { draft: draft.value, plan } : null;
  }, [state, walletId, dest, sats, feeSats, priceCents, today, year, strategy, handPicks]);

  const submit = useSubmit(async () => {
    if (result === null) return;
    const entry: MoveEntry = { ...result.draft, id: newIdGenerator(entries)(), at: entryInstant(isDemo, today), tz: state.settings.timeZone, note: 'Prepared a sale from What if', proof: wallet?.defaultProof ?? '' };
    await append([entry]);
    toast.show(`Move logged. Sell on ${destName}, then log the sale here.`, { success: true });
    onSaved(dest);
    onClose();
  });

  return (
    <Sheet open={open} onClose={onClose} title="Prepare this sale">
      <div className="flex flex-col gap-3.5 pb-3">
        <p className="m-0 text-[13px] leading-[1.45] text-soft">
          Coins in {wallet?.name} cannot be sold directly. Log a move of exactly the coins you chose to an exchange, then sell them there. The move keeps each coin's date and cost.
        </p>
        <SelectBox label="Move to" value={dest} onChange={(e) => setDest(e.target.value)}>
          {exchanges.map((w) => (
            <option key={w.wallet} value={w.wallet}>
              {w.name}
            </option>
          ))}
        </SelectBox>
        <Field label="Network fee (sats)" inputMode="numeric" value={feeText} onChange={(e) => setFeeText(e.target.value)} hint="Paid in BTC from the same coins. A tiny taxable sale." />
        {result ? (
          <dl className="m-0 flex flex-col rounded-2xl border border-line bg-bg px-4 py-1 text-sm">
            {[
              ['Coins arriving', <Amount key="a" sats={result.draft.sats} showUnit interactive={false} />],
              ['Lots used', `${rangeLabel(result.plan.coinsFrom, result.plan.coinsTo)} · ${countOf(result.plan.picks.length, 'lot')}`],
              ['Fee', <Amount key="f" sats={result.draft.feeSats} showUnit interactive={false} />],
              ['Tax from this move', 'None except the fee'],
            ].map(([k, v], i, all) => (
              <div key={String(k)} className={cx('flex min-h-11 items-center justify-between gap-4', i < all.length - 1 && 'border-b border-line')}>
                <dt className="text-soft">{k}</dt>
                <dd className="m-0 text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-sm text-loss">The fee must be a whole number of sats, smaller than the amount.</p>
        )}
        {result && <p className="m-0 text-[13px] text-muted">Your exchange sells by its own rules unless you tell it which lots.</p>}
        <div className="flex gap-2.5">
          <Button className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-[1.6]" disabled={result === null || submit.busy} onClick={() => void submit.run()}>
            {submit.busy ? 'Saving…' : 'Save this move'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

