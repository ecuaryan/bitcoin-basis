/** Sell planner: oldest first vs lowest tax (and hand-picked) for one wallet. */
import { ok, err } from '../result.ts';
import { type Cents, type Sats } from '../money.ts';
import { isValidLocalDate, yearOf } from '../dates.ts';
import { lowestTaxOrder, oldestFirstOrder, picksFor, takeInOrder, validatePicks } from '../picks.ts';
import { canSellFrom, type SellRefusal } from '../sell-guard.ts';
import { marginalRates } from '../tax/tax.ts';
import type { LedgerState, LocalDate, LotPick, PickError, Result, Settings, WalletId } from '../types.ts';
import { TIERS } from '../types.ts';
import { taxContext, taxInput } from './context.ts';
import { evaluatePicks, proceedsFor, type SaleEvaluation } from './evaluate.ts';

/** More than this much added tax triggers the estimated-payment heads-up ($1,000). */
export const HEADS_UP_TAX_CENTS = 100_000;

export interface SaleRequest {
  readonly wallet: WalletId;
  readonly sats: Sats;
  /** Cents per BTC (more than 0). */
  readonly priceCents: Cents;
  /** Local date of the sale; must fall in `year`. */
  readonly onDate: LocalDate;
  readonly year: number;
  /** A third plan from the user's own picks (must add up to `sats`). */
  readonly handPicks?: readonly LotPick[];
}

export type SalePlanError = SellRefusal | PickError | { code: 'unknown-wallet' | 'invalid-input'; message: string };

export interface SalePlan extends SaleEvaluation {
  readonly strategy: 'oldest-first' | 'lowest-tax' | 'hand-picked';
  readonly picks: LotPick[];
  /** Estimated tax added is over $1,000: an estimated payment may be needed. */
  readonly headsUp: boolean;
  /** On the lowest-tax plan: a reminder that it defers tax rather than removing it. */
  readonly deferredNote: string | null;
  /** On the lowest-tax plan, when oldest first costs less: why (see TIER_NOTE). Otherwise null. */
  readonly note: string | null;
  /**
   * True when these coins are not the exchange's default choice: tell the exchange which coins to sell by
   * the time of the sale, or its default applies (Treas. Reg. 1.1012-1(j)(3)).
   */
  readonly brokerInstructionNeeded: boolean;
}

export interface SalePlans {
  readonly oldestFirst: SalePlan;
  readonly lowestTax: SalePlan;
  readonly handPicked: SalePlan | null;
}

const carried = (p: SalePlan): Cents => p.carryforwardOut.st + p.carryforwardOut.lt;
/** Cheaper wins; at equal tax, more loss carried forward. */
const better = (a: SalePlan, b: SalePlan): boolean => a.totalTaxCents < b.totalTaxCents || (a.totalTaxCents === b.totalTaxCents && carried(a) > carried(b));

export const DEFERRED_NOTE = 'Lowest tax defers tax rather than removing it: the coins left in your wallet keep a higher cost-to-gain gap, so more tax may come later.';
export const TIER_NOTE = 'Oldest first costs less here because it leans on coins whose cost is less well documented. Lowest tax prefers well-documented coins.';

function requestProblem(req: SaleRequest): SalePlanError | null {
  if (!Number.isSafeInteger(req.sats) || req.sats <= 0) return { code: 'invalid-amount', message: 'amount must be a positive whole number of sats' };
  if (!Number.isSafeInteger(req.priceCents) || req.priceCents <= 0) return { code: 'invalid-input', message: 'the price must be more than $0' };
  if (!isValidLocalDate(req.onDate) || yearOf(req.onDate) !== req.year) return { code: 'invalid-input', message: `the sale date must be a date in ${req.year}` };
  return null;
}

/** Plan a sale from one wallet, or refuse (retirement, frozen, self-custody) with guidance. */
export function planSale(state: LedgerState, settings: Settings, req: SaleRequest): Result<SalePlans, SalePlanError> {
  const wallet = state.wallets.find((w) => w.id === req.wallet);
  if (wallet === undefined) return err({ code: 'unknown-wallet', message: `wallet ${req.wallet} does not exist` });
  const allowed = canSellFrom(wallet);
  if (!allowed.ok) return allowed;
  const bad = requestProblem(req);
  if (bad !== null) return err(bad);
  const proceeds = proceedsFor(req.sats, req.priceCents);
  if (proceeds === null) return err({ code: 'invalid-input', message: 'the sale is too large to plan' });

  const ctx = taxContext(state, settings, req.year, req.onDate);
  const build = (strategy: SalePlan['strategy'], picks: LotPick[]): SalePlan => {
    const ev = evaluatePicks(state.lots, picks, proceeds, ctx);
    // Only exchange wallets get this far (canSellFrom), and their default is assumed to be oldest first.
    return { ...ev, strategy, picks, headsUp: ev.totalTaxCents > HEADS_UP_TAX_CENTS, deferredNote: strategy === 'lowest-tax' ? DEFERRED_NOTE : null, note: null, brokerInstructionNeeded: strategy !== 'oldest-first' };
  };

  const oldest = picksFor(oldestFirstOrder(state.lots, wallet.id), req.sats);
  if (!oldest.ok) return oldest;
  const oldestFirst = build('oldest-first', oldest.value);
  const rates = marginalRates(taxInput(ctx, 0, 0));
  // Candidate orderings, each keeping the documentation tiers in order: by marginal-rate tax per sat,
  // by plain gain per sat (biggest losses first), and oldest first. The cheapest wins; at equal tax,
  // the one that leaves the most loss carried forward, then the earlier candidate.
  const opts = { priceCents: req.priceCents, onDate: req.onDate };
  const candidates = [
    lowestTaxOrder(state.lots, wallet.id, { ...opts, stRate: rates.st, ltRate: rates.lt }),
    lowestTaxOrder(state.lots, wallet.id, { ...opts, stRate: 1, ltRate: 1 }),
    [...oldestFirstOrder(state.lots, wallet.id)].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)),
  ].map((order) => build('lowest-tax', takeInOrder(order, req.sats)));
  const lowest = candidates.reduce((best, c) => (better(c, best) ? c : best));
  // Tiers outrank tax on purpose (estimated costs should not be leaned on to cut tax); say so when it matters.
  const lowestTax = oldestFirst.totalTaxCents < lowest.totalTaxCents ? { ...lowest, note: TIER_NOTE } : lowest;
  let handPicked: SalePlan | null = null;
  if (req.handPicks !== undefined) {
    const valid = validatePicks(state.lots, wallet.id, req.handPicks, req.sats);
    if (!valid.ok) return valid;
    handPicked = build('hand-picked', [...valid.value]);
  }
  return ok({ oldestFirst, lowestTax, handPicked });
}
