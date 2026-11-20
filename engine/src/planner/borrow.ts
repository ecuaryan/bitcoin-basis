/** Borrow planner: loan-to-value, trigger prices, interest, and what a liquidation would sell and cost in tax. */
import { divRoundHalfUp, mulDivRoundHalfUp, SATS_PER_BTC, type Cents, type Sats } from '../money.ts';
import { oldestFirstOrder, picksFor } from '../picks.ts';
import { err, ok } from '../result.ts';
import type { Lot, LotPick, PickError, Result, WalletId } from '../types.ts';
import type { TaxContext } from './context.ts';
import { evaluatePicks, proceedsFor, type SaleEvaluation } from './evaluate.ts';

export interface BorrowRequest extends TaxContext {
  readonly loanCents: Cents;
  /** Interest per year, 1/10000ths (1150 = 11.5%). */
  readonly ratePerYear: number;
  /** 1/10000ths (7000 = 70%). */
  readonly marginCallLtv: number;
  readonly liquidationLtv: number;
  readonly pledgedSats: Sats;
  /** Cents per BTC. */
  readonly priceCents: Cents;
  readonly lots: readonly Lot[];
  /** The wallet the coins are pledged from. */
  readonly wallet: WalletId;
}

export type BorrowError = PickError | { code: 'invalid-input'; message: string };

export interface BorrowPlan {
  /** Loan ÷ value of the pledged coins, in 1/10000ths, half-up (3333 = 33.33%). */
  readonly ltvBp: number;
  /** Cents per BTC, half-up. */
  readonly marginCallPriceCents: Cents;
  readonly liquidationPriceCents: Cents;
  /** How far the price can fall before margin call / liquidation, in 1/10000ths of the price (negative: already past). */
  readonly dropToMarginCallBp: number;
  readonly dropToLiquidationBp: number;
  readonly interestPerYearCents: Cents;
  readonly liquidation: {
    /** loan ÷ liquidation price, rounded up to whole sats. */
    readonly satsSold: Sats;
    readonly picks: LotPick[];
    readonly sale: SaleEvaluation;
  };
}

const isInt = (v: number, lo: number, hi: number): boolean => Number.isSafeInteger(v) && v >= lo && v <= hi;
const MAX = Number.MAX_SAFE_INTEGER;

/** Price (cents per BTC) at which the loan equals `ltv` of the pledged coins' value, half-up. */
function triggerPrice(loanCents: Cents, ltv: number, pledgedSats: Sats): Cents {
  return Number(divRoundHalfUp(BigInt(loanCents) * BigInt(SATS_PER_BTC) * 10_000n, BigInt(ltv) * BigInt(pledgedSats)));
}

export function planBorrow(req: BorrowRequest): Result<BorrowPlan, BorrowError> {
  const ok_ =
    isInt(req.loanCents, 1, MAX) && isInt(req.pledgedSats, 1, MAX) && isInt(req.priceCents, 1, MAX) &&
    isInt(req.ratePerYear, 0, 10_000) && isInt(req.marginCallLtv, 1, 10_000) && isInt(req.liquidationLtv, 1, 10_000) &&
    req.marginCallLtv <= req.liquidationLtv;
  if (!ok_) return err({ code: 'invalid-input', message: 'loan, coins and price must be positive; LTVs 0.01% to 100% with the margin call at or below liquidation' });
  const marginCallPriceCents = triggerPrice(req.loanCents, req.marginCallLtv, req.pledgedSats);
  const liquidationPriceCents = triggerPrice(req.loanCents, req.liquidationLtv, req.pledgedSats);
  if (!isInt(liquidationPriceCents, 1, MAX)) return err({ code: 'invalid-input', message: 'the loan is too small to price' });
  const valueCents = BigInt(req.pledgedSats) * BigInt(req.priceCents);
  const ltvBp = Number(divRoundHalfUp(BigInt(req.loanCents) * BigInt(SATS_PER_BTC) * 10_000n, valueCents));
  const drop = (price: Cents): number => Number(divRoundHalfUp(BigInt(req.priceCents - price) * 10_000n, BigInt(req.priceCents)));
  const sold = Math.min(req.pledgedSats, Number((BigInt(req.loanCents) * BigInt(SATS_PER_BTC) + BigInt(liquidationPriceCents) - 1n) / BigInt(liquidationPriceCents)));
  const picks = picksFor(oldestFirstOrder(req.lots, req.wallet), sold);
  if (!picks.ok) return picks;
  return ok({
    ltvBp,
    marginCallPriceCents,
    liquidationPriceCents,
    dropToMarginCallBp: drop(marginCallPriceCents),
    dropToLiquidationBp: drop(liquidationPriceCents),
    interestPerYearCents: mulDivRoundHalfUp(req.loanCents, req.ratePerYear, 10_000),
    liquidation: { satsSold: sold, picks: picks.value, sale: evaluatePicks(req.lots, picks.value, proceedsFor(sold, liquidationPriceCents), req) },
  });
}
