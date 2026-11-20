/** Sell planner: oldest first vs lowest tax (and hand-picked) for one wallet. */
import { ok, err } from '../result.ts';
import { type Cents, type Sats } from '../money.ts';
import { lowestTaxOrder, oldestFirstOrder, picksFor, validatePicks } from '../picks.ts';
import { canSellFrom, type SellRefusal } from '../sell-guard.ts';
import { marginalRates } from '../tax/tax.ts';
import type { LedgerState, LocalDate, Lot, LotPick, PickError, Result, Settings, WalletId } from '../types.ts';
import { TIERS } from '../types.ts';
import { taxContext, taxInput } from './context.ts';
import { evaluatePicks, proceedsFor, type SaleEvaluation } from './evaluate.ts';
import { givingOnSale, givingPercentBp } from './giving.ts';

/** More than this much added tax triggers the estimated-payment heads-up ($1,000). */
export const HEADS_UP_TAX_CENTS = 100_000;

export interface SaleRequest {
  readonly wallet: WalletId;
  readonly sats: Sats;
  /** Cents per BTC. */
  readonly priceCents: Cents;
  readonly onDate: LocalDate;
  readonly year: number;
  /** A third plan from the user's own picks (must add up to `sats`). */
  readonly handPicks?: readonly LotPick[];
}

export type SalePlanError = SellRefusal | PickError | { code: 'unknown-wallet'; message: string };

export interface SalePlan extends SaleEvaluation {
  readonly strategy: 'oldest-first' | 'lowest-tax' | 'hand-picked';
  readonly picks: LotPick[];
  /** Giving on this sale in cents, or null when giving is off. */
  readonly givingCents: Cents | null;
  /** Estimated tax added is over $1,000: an estimated payment may be needed. */
  readonly headsUp: boolean;
  /** On the lowest-tax plan: a reminder that it defers tax rather than removing it. */
  readonly deferredNote: string | null;
}

export interface SalePlans {
  readonly oldestFirst: SalePlan;
  readonly lowestTax: SalePlan;
  readonly handPicked: SalePlan | null;
}

/** Take sats from lots in order (the caller has checked the wallet holds enough). */
function greedy(order: readonly Lot[], sats: Sats): LotPick[] {
  const picks: LotPick[] = [];
  let left = sats;
  for (const lot of order) {
    const take = Math.min(left, lot.sats);
    if (take > 0) picks.push({ lotId: lot.id, sats: take });
    left -= take;
  }
  return picks;
}

const carried = (p: SalePlan): Cents => p.carryforwardOut.st + p.carryforwardOut.lt;
/** Cheaper wins; at equal tax, more loss carried forward. */
const better = (a: SalePlan, b: SalePlan): boolean => a.totalTaxCents < b.totalTaxCents || (a.totalTaxCents === b.totalTaxCents && carried(a) > carried(b));

export const DEFERRED_NOTE = 'Lowest tax defers tax rather than removing it: the coins left in your wallet keep a higher cost-to-gain gap, so more tax may come later.';

/** Plan a sale from one wallet, or refuse (retirement, frozen, self-custody) with guidance. */
export function planSale(state: LedgerState, settings: Settings, req: SaleRequest): Result<SalePlans, SalePlanError> {
  const wallet = state.wallets.find((w) => w.id === req.wallet);
  if (wallet === undefined) return err({ code: 'unknown-wallet', message: `wallet ${req.wallet} does not exist` });
  const allowed = canSellFrom(wallet);
  if (!allowed.ok) return allowed;

  const ctx = taxContext(state, settings, req.year, req.onDate);
  const proceeds = proceedsFor(req.sats, req.priceCents);
  const percent = givingPercentBp(settings);
  const build = (strategy: SalePlan['strategy'], picks: LotPick[]): SalePlan => {
    const ev = evaluatePicks(state.lots, picks, proceeds, ctx);
    const givingCents = settings.givingEnabled ? givingOnSale({ percent, gains: ev.gainCents, mode: settings.givingMode, estimatedTax: ev.totalTaxCents }) : null;
    return { ...ev, strategy, picks, givingCents, headsUp: ev.totalTaxCents > HEADS_UP_TAX_CENTS, deferredNote: strategy === 'lowest-tax' ? DEFERRED_NOTE : null };
  };

  const oldest = picksFor(oldestFirstOrder(state.lots, wallet.id), req.sats);
  if (!oldest.ok) return oldest;
  const rates = marginalRates(taxInput(ctx, 0, 0));
  // Candidate orderings, each keeping the documentation tiers in order: by marginal-rate tax per sat,
  // by plain gain per sat (biggest losses first), and oldest first. The cheapest wins; at equal tax,
  // the one that leaves the most loss carried forward, then the earlier candidate.
  const opts = { priceCents: req.priceCents, onDate: req.onDate };
  const candidates = [
    lowestTaxOrder(state.lots, wallet.id, { ...opts, stRate: rates.st, ltRate: rates.lt }),
    lowestTaxOrder(state.lots, wallet.id, { ...opts, stRate: 1, ltRate: 1 }),
    [...oldestFirstOrder(state.lots, wallet.id)].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)),
  ].map((order) => build('lowest-tax', greedy(order, req.sats)));
  const lowest = candidates.reduce((best, c) => (better(c, best) ? c : best));
  let handPicked: SalePlan | null = null;
  if (req.handPicks !== undefined) {
    const valid = validatePicks(state.lots, wallet.id, req.handPicks, req.sats);
    if (!valid.ok) return valid;
    handPicked = build('hand-picked', [...valid.value]);
  }
  return ok({ oldestFirst: build('oldest-first', oldest.value), lowestTax: lowest, handPicked });
}
