/** Borrow planner: loan-to-value, trigger prices, interest, and what a liquidation would sell and cost in tax. */
import { sum } from '../book.ts';
import { divRoundHalfUp, MAX_ENTRY_CENTS, MAX_ENTRY_SATS, mulDivRoundHalfUp, SATS_PER_BTC, type Cents, type Sats } from '../money.ts';
import { oldestFirstOrder, takeInOrder } from '../picks.ts';
import { err, ok } from '../result.ts';
import type { Lot, LotPick, PickError, Result, Wallet, WalletId } from '../types.ts';
import type { TaxContext } from './context.ts';
import { evaluatePicks, type SaleEvaluation } from './evaluate.ts';

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
  /** All wallets (e.g. `state.wallets`), to check the pledging wallet. */
  readonly wallets: readonly Wallet[];
  /** The wallet the coins are pledged from: not frozen, retirement or archived. Pledged coins come from its lots. */
  readonly wallet: WalletId;
}

export type BorrowError = PickError | { code: 'invalid-input' | 'unknown-wallet' | 'wallet-frozen' | 'retirement-wallet' | 'wallet-archived'; message: string };

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

const toSafe = (n: bigint): number | null => {
  const v = Number(n);
  return Number.isSafeInteger(v) ? v : null;
};

/** The pledging wallet must exist and be usable: not frozen, retirement or archived. */
function walletProblem(req: BorrowRequest): BorrowError | null {
  const w = req.wallets.find((x) => x.id === req.wallet);
  if (w === undefined) return { code: 'unknown-wallet', message: `wallet ${req.wallet} does not exist` };
  if (w.type === 'retirement') return { code: 'retirement-wallet', message: `${w.name} is a retirement wallet; it is not part of tax planning.` };
  if (w.frozen) return { code: 'wallet-frozen', message: `${w.name} is frozen; its coins cannot be pledged.` };
  if (w.archived) return { code: 'wallet-archived', message: `${w.name} is archived.` };
  return null;
}

const inputsOk = (req: BorrowRequest): boolean =>
  isInt(req.loanCents, 1, MAX_ENTRY_CENTS) && isInt(req.pledgedSats, 1, MAX_ENTRY_SATS) && isInt(req.priceCents, 1, MAX_ENTRY_CENTS) &&
  isInt(req.ratePerYear, 0, 10_000) && isInt(req.marginCallLtv, 1, 10_000) && isInt(req.liquidationLtv, 1, 10_000) &&
  req.marginCallLtv <= req.liquidationLtv;

export function planBorrow(req: BorrowRequest): Result<BorrowPlan, BorrowError> {
  const bad = walletProblem(req);
  if (bad !== null) return err(bad);
  if (!inputsOk(req)) return err({ code: 'invalid-input', message: 'loan, coins and price must be positive; LTVs 0.01% to 100% with the margin call at or below liquidation' });
  const lots = oldestFirstOrder(req.lots, req.wallet);
  const held = sum(lots.map((l) => l.sats));
  if (req.pledgedSats > held) return err({ code: 'insufficient-sats', message: `the wallet holds ${held} sats, fewer than the ${req.pledgedSats} pledged` });
  const loan = BigInt(req.loanCents) * BigInt(SATS_PER_BTC) * 10_000n;
  const price = BigInt(req.priceCents);
  // Price (cents per BTC) at which the loan equals `ltv` of the pledged coins' value, half-up.
  const trigger = (ltv: number): bigint => divRoundHalfUp(loan, BigInt(ltv) * BigInt(req.pledgedSats));
  const drop = (p: bigint): bigint => divRoundHalfUp((price - p) * 10_000n, price);
  const marginCall = trigger(req.marginCallLtv);
  const liquidation = trigger(req.liquidationLtv);
  const figures = [divRoundHalfUp(loan, BigInt(req.pledgedSats) * price), marginCall, liquidation, drop(marginCall), drop(liquidation)].map(toSafe);
  if (figures.includes(null)) return err({ code: 'invalid-input', message: 'these numbers are too large to compute' });
  const [ltvBp, marginCallPriceCents, liquidationPriceCents, dropToMarginCallBp, dropToLiquidationBp] = figures as [number, number, number, number, number];
  if (liquidationPriceCents < 1) return err({ code: 'invalid-input', message: 'the loan is too small to price' });
  // Rounded up to whole sats; at most loan + one sat's worth, so the proceeds stay in range.
  const sold = Math.min(req.pledgedSats, Number((BigInt(req.loanCents) * BigInt(SATS_PER_BTC) + BigInt(liquidationPriceCents) - 1n) / BigInt(liquidationPriceCents)));
  const picks = takeInOrder(lots, sold); // sold ≤ pledged ≤ held, so the lots cover it
  return ok({
    ltvBp,
    marginCallPriceCents,
    liquidationPriceCents,
    dropToMarginCallBp,
    dropToLiquidationBp,
    interestPerYearCents: mulDivRoundHalfUp(req.loanCents, req.ratePerYear, 10_000),
    liquidation: { satsSold: sold, picks, sale: evaluatePicks(req.lots, picks, mulDivRoundHalfUp(sold, liquidationPriceCents, SATS_PER_BTC), req) },
  });
}
