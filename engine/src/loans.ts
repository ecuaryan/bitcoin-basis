/**
 * Loan reports (docs/loans-spec.md): what a loan-funded stack is worth against what was borrowed, interest paid,
 * what is owed now, and the per-purchase picture. Read-only over ledger state; never part of tax math.
 *
 * Interest model (US HELOC practice): simple daily interest on each day's end-of-day principal, daily rate =
 * APR ÷ 365 (or ÷ 360), the rate in force that day. A draw is charged from its own day; a principal payment
 * stops interest from its day. A period's interest is summed exactly and rounded once, half-up.
 */
import { sum } from './book.ts';
import { dateOfDay, dayNumber, latestMonthDay } from './dates.ts';
import { divRoundHalfUp, mulDivOrNull, mulDivRoundHalfUp, SATS_PER_BTC, type Cents, type Sats } from './money.ts';
import { compareStrings } from './order.ts';
import { statementDayOn } from './loan-book.ts';

export { LOAN_PAID_SO_FAR_NOTE } from './loan-book.ts';
import { traceCoins, type GonePiece, type TracedCoins } from './trace.ts';
import type { LedgerState, LocalDate, Loan, LoanDraw, LoanId, LoanPayment, LoanStatement, LotId } from './types.ts';

const MILLION = 1_000_000n;

// ---------------------------------------------------------------------------------------------
// Rates and units
// ---------------------------------------------------------------------------------------------

/** "6.5", "6.50%" or "7.875" → APR in millionths (65_000, 78_750), or null if not 0-100 with up to 4 decimals. */
export function parseAprPercent(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,4}))?\s*%?\s*$/.exec(text);
  if (m === null) return null;
  const v = Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0'));
  return v <= 1_000_000 ? v : null;
}

/** APR in millionths as a percent without trailing zeros past two decimals: 65_000 → "6.50%", 78_750 → "7.875%". */
export function formatAprPercent(aprMillionths: number): string {
  const whole = Math.trunc(aprMillionths / 10_000);
  const frac = String(aprMillionths % 10_000).padStart(4, '0').replace(/0{1,2}$/, '');
  return `${whole}.${frac}%`;
}

/** The APR in force on `date`: the latest rate whose `from` is on or before it (the first rate before then). */
export function aprOn(loan: Loan, date: LocalDate): number {
  const r = [...loan.rates].reverse().find((x) => x.from <= date) ?? loan.rates[0];
  return (r as { aprMillionths: number }).aprMillionths;
}

// ---------------------------------------------------------------------------------------------
// Exact splitting and the daily-balance timeline
// ---------------------------------------------------------------------------------------------

/**
 * Split `total` cents by `weights` (largest remainder: each piece is its exact share rounded down, then the
 * leftover cents go one each to the largest remainders, earlier first on a tie). Pieces add back exactly, are
 * never negative and never exceed their exact share rounded up. Weights must not all be zero.
 */
export function splitByWeights(total: number, weights: readonly bigint[]): number[] {
  const t = BigInt(total);
  const w = weights.reduce((s, x) => s + x, 0n);
  const floors = weights.map((x) => (t * x) / w);
  const order = weights.map((x, i) => ({ i, rem: (t * x) % w })).sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  let left = t - floors.reduce((s, x) => s + x, 0n);
  for (const { i } of order) {
    if (left === 0n) break;
    floors[i] = (floors[i] as bigint) + 1n;
    left -= 1n;
  }
  return floors.map(Number);
}

interface Flow {
  date: LocalDate;
  cents: Cents;
}

/**
 * For each window [cuts[k], cuts[k+1]) (day numbers, ascending), each draw's Σ end-of-day outstanding cents ×
 * APR millionths over the window's days. Principal repaid splits across outstanding draws in proportion to what
 * each still owes (largest remainder); repaying more than is owed leaves a credit that later draws use first.
 */
function windowWeights(loan: Loan, draws: readonly LoanDraw[], repayments: readonly Flow[], cuts: readonly number[]): bigint[][] {
  const out = cuts.slice(1).map(() => draws.map(() => 0n));
  const outstanding = draws.map(() => 0);
  let credit = 0;
  const drawDays = draws.map((d) => dayNumber(d.date));
  const repayDays = repayments.map((r) => dayNumber(r.date));
  const points = [...new Set([...cuts, ...drawDays, ...repayDays, ...loan.rates.map((r) => dayNumber(r.from))])].sort((a, b) => a - b);
  let w = -1;
  points.forEach((p, k) => {
    draws.forEach((d, i) => {
      if (drawDays[i] !== p) return;
      const used = Math.min(credit, d.cents);
      credit -= used;
      outstanding[i] = (outstanding[i] as number) + d.cents - used;
    });
    repayments.forEach((r, j) => {
      if (repayDays[j] !== p) return;
      const owed = sum(outstanding);
      if (r.cents >= owed) {
        credit += r.cents - owed;
        outstanding.fill(0);
        return;
      }
      splitByWeights(r.cents, outstanding.map(BigInt)).forEach((part, i) => (outstanding[i] = (outstanding[i] as number) - part));
    });
    while (w + 1 < cuts.length && (cuts[w + 1] as number) <= p) w++;
    if (w < 0 || w >= cuts.length - 1) return;
    const factor = BigInt(aprOn(loan, dateOfDay(p))) * BigInt((points[k + 1] as number) - p);
    const row = out[w] as bigint[];
    outstanding.forEach((o, i) => (row[i] = (row[i] as bigint) + BigInt(o) * factor));
  });
  return out;
}

const denominator = (loan: Loan): bigint => MILLION * (loan.dayCount === 'actual/360' ? 360n : 365n);

/** Interest for weights summed over draws: Σ ÷ (1,000,000 × 365 or 360), rounded once, half-up. */
const interestOf = (loan: Loan, weights: readonly bigint[]): Cents => Number(divRoundHalfUp(weights.reduce((s, x) => s + x, 0n), denominator(loan)));

const repaymentsOf = (payments: readonly LoanPayment[]): Flow[] => payments.filter((p) => p.principalCents > 0).map((p) => ({ date: p.date, cents: p.principalCents }));

function findLoan(state: LedgerState, loanId: LoanId): Loan | null {
  return state.loans.find((l) => l.id === loanId) ?? null;
}

/** First day anything can accrue: the opening date or the first draw, whichever is earlier. */
function startDay(loan: Loan, draws: readonly LoanDraw[]): number {
  return Math.min(dayNumber(loan.opened), ...draws.map((d) => dayNumber(d.date)));
}

/** Principal owed at the end of `date` from the records: draws − principal repaid (negative = overpaid). */
function netPrincipalOn(loan: Loan, date: LocalDate): Cents {
  return sum(loan.draws.filter((d) => d.date <= date).map((d) => d.cents)) - sum(loan.payments.filter((p) => p.date <= date).map((p) => p.principalCents));
}

// ---------------------------------------------------------------------------------------------
// Interest estimates
// ---------------------------------------------------------------------------------------------

/**
 * Estimated interest the lender charges for the days `fromDate` through `throughDate` (both included), from the
 * records dated through `throughDate`. 0 if `fromDate` is after `throughDate` or the loan is unknown.
 */
export function estimateLoanInterest(state: LedgerState, loanId: LoanId, fromDate: LocalDate, throughDate: LocalDate): Cents {
  const loan = findLoan(state, loanId);
  if (loan === null || fromDate > throughDate) return 0;
  const draws = loan.draws.filter((d) => d.date <= throughDate);
  const weights = windowWeights(loan, draws, repaymentsOf(loan.payments.filter((p) => p.date <= throughDate)), [dayNumber(fromDate), dayNumber(throughDate) + 1]);
  return interestOf(loan, weights[0] as bigint[]);
}

export interface PaymentSuggestion {
  /** First and last day the interest covers. */
  fromDate: LocalDate;
  throughDate: LocalDate;
  days: number;
  /** ESTIMATE of the interest still to pay for the cycle (the cycle's interest − `alreadyPaidCents`); confirm from the statement. */
  interestCents: Cents;
  /** Interest already recorded for this same cycle (a payment made in parts). */
  alreadyPaidCents: Cents;
  /** Principal owed at the end of `throughDate` (for an interest-only line, the balance the interest is on). */
  principalOwedCents: Cents;
  aprMillionths: number;
}

/**
 * Pre-fill for logging a payment made on `payDate`: the billing cycle it pays (ending on the latest statement
 * closing date on or before `payDate`, or on `payDate` if the loan has no statement day; if a payment already covers
 * past that date, the cycle that payment covers), starting the day after
 * the last day an earlier payment's interest covered (or when the loan started), less interest already recorded for
 * that cycle. Uses the statement day in force on `payDate`. Null for an unknown loan.
 */
export function suggestLoanPayment(state: LedgerState, loanId: LoanId, payDate: LocalDate): PaymentSuggestion | null {
  const loan = findLoan(state, loanId);
  if (loan === null) return null;
  const day = statementDayOn(loan, payDate);
  const closing = day === null ? payDate : latestMonthDay(payDate, day);
  const withInterest = loan.payments.filter((p) => p.interestCents > 0);
  // A payment that already covers past that closing date (the statement day changed since, or interest was paid ahead)
  // paid the cycle the closing date falls in: that cycle is the one to finish, never the same days again.
  const throughDate = withInterest.filter((p) => p.date <= payDate && p.interestThrough >= closing).map((p) => p.interestThrough).sort(compareStrings)[0] ?? closing;
  const last = withInterest.map((p) => p.interestThrough).filter((d) => d < throughDate).sort(compareStrings).at(-1);
  const fromDate = last === undefined ? dateOfDay(startDay(loan, loan.draws.filter((d) => d.date <= throughDate))) : dateOfDay(dayNumber(last) + 1);
  const alreadyPaidCents = sum(withInterest.filter((p) => p.interestThrough === throughDate).map((p) => p.interestCents));
  return {
    fromDate,
    throughDate,
    days: Math.max(0, dayNumber(throughDate) - dayNumber(fromDate) + 1),
    interestCents: Math.max(0, estimateLoanInterest(state, loanId, fromDate, throughDate) - alreadyPaidCents),
    alreadyPaidCents,
    principalOwedCents: Math.max(0, netPrincipalOn(loan, throughDate)),
    aprMillionths: aprOn(loan, throughDate),
  };
}

interface Allocation {
  /** Each draw's ESTIMATED share of the interest paid (adds back exactly with `unallocatedCents`). */
  shares: Cents[];
  /** Interest paid for days with no balance and no earlier draws to put it on. */
  unallocatedCents: Cents;
  /** Per payment with interest: each draw's share of that payment's interest. */
  perPayment: { payment: LoanPayment; shares: Cents[] }[];
  accruedCents: Cents;
  /** First day of the accrual estimate (the day after the last day paid), or null if nothing is unpaid. */
  accruedFrom: LocalDate | null;
  /**
   * ESTIMATE: interest for the cycles payments cover (through `onDate`) that those payments did not pay: the
   * cycles' interest (each rounded once) − the interest paid for them, never below 0.
   */
  unpaidBilledCents: Cents;
}

/**
 * Split each payment's interest across the draws by what each draw generated during the days that payment
 * covers (end-of-day outstanding × rate × days); payments covering the same last day share one period, and a
 * payment with no interest (principal only) covers no period. A period with no balance falls back to the amounts
 * of the draws made by its last day (none: unallocated). Also estimate interest accrued after the last day paid, through
 * `onDate`, and what is left unpaid of the cycles the payments cover (a cycle paid in part). The unpaid part is
 * cumulative: paying more for one cycle (a past-due remainder paid with the next statement) makes up for another.
 */
function allocate(loan: Loan, draws: readonly LoanDraw[], payments: readonly LoanPayment[], onDate: LocalDate): Allocation {
  const interestPayments = payments.filter((p) => p.interestCents > 0);
  const throughCuts = [...new Set(interestPayments.map((p) => dayNumber(p.interestThrough) + 1))];
  const start = Math.min(startDay(loan, draws), ...throughCuts);
  const lastCut = Math.max(start, ...throughCuts);
  const end = dayNumber(onDate) + 1;
  const cuts = [...new Set([start, ...throughCuts, ...(end > lastCut ? [end] : [])])].sort((a, b) => a - b);
  const windows = windowWeights(loan, draws, repaymentsOf(payments), cuts);
  const shares = draws.map(() => 0);
  let unallocatedCents = 0;
  const perPayment = interestPayments.map((payment) => {
    const window = windows[cuts.indexOf(dayNumber(payment.interestThrough) + 1) - 1] ?? [];
    const weights = window.some((x) => x > 0n) ? window : draws.map((d) => (d.date <= payment.interestThrough ? BigInt(d.cents) : 0n));
    if (!weights.some((x) => x > 0n)) {
      unallocatedCents += payment.interestCents;
      return { payment, shares: draws.map(() => 0) };
    }
    const split = splitByWeights(payment.interestCents, weights);
    split.forEach((c, i) => (shares[i] = (shares[i] as number) + c));
    return { payment, shares: split };
  });
  const accruing = end > lastCut;
  // "Interest paid so far" settles every cycle through its last day: nothing before it is unpaid, and no excess carries on.
  const settled = Math.max(-Infinity, ...interestPayments.filter((p) => p.paidSoFar === true && dayNumber(p.interestThrough) < end).map((p) => dayNumber(p.interestThrough) + 1));
  // Cycles that ended on or before `onDate` (a cycle paid ahead is not billed yet), after any settled ones.
  const billed = sum(cuts.slice(1).map((c, k) => (c <= end && c > settled && throughCuts.includes(c) ? interestOf(loan, windows[k] as bigint[]) : 0)));
  const paidForBilled = sum(interestPayments.filter((p) => dayNumber(p.interestThrough) < end && dayNumber(p.interestThrough) + 1 > settled).map((p) => p.interestCents));
  return {
    shares,
    unallocatedCents,
    perPayment,
    accruedCents: accruing ? interestOf(loan, windows.at(-1) as bigint[]) : 0,
    accruedFrom: accruing ? dateOfDay(lastCut) : null,
    unpaidBilledCents: Math.max(0, billed - paidForBilled),
  };
}

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

/** One loan-funded purchase, as of a date and price. Value fields are null while no price is known. */
export interface LoanPurchase {
  /** The purchase's lot id (root id of the buy or opening-lot entry). */
  lotId: LotId;
  /** The `loan-link` entry. */
  linkEntryId: string;
  drawDate: LocalDate;
  /** Money drawn for it (its cost unless the link says otherwise). */
  drawCents: Cents;
  /** What the purchase bought, and its cost (held + frozen + gone). */
  sats: Sats;
  costCents: Cents;
  heldSats: Sats;
  heldCostCents: Cents;
  /** Coins from it in frozen wallets (not counted as held). */
  frozenSats: Sats;
  /** Sold or spent coins from it: proceeds and gain (tax figures come from the tax reports, not from here). */
  soldSats: Sats;
  soldCostCents: Cents;
  proceedsCents: Cents;
  /** Coins paid as fees, given, lost or closed out. */
  otherGoneSats: Sats;
  /** What a frozen platform paid back for its coins: its share of the close-out's recovered dollars and of later payouts. */
  recoveredCents: Cents;
  gone: GonePiece[];
  valueCents: Cents | null;
  /** Price-based: value − held cost. */
  upDownCents: Cents | null;
  /** ESTIMATE: its share of the interest paid, by what it generated while outstanding. */
  interestShareCents: Cents;
  /** upDown − interest share. */
  gainIncludingInterestCents: Cents | null;
}

export interface LoanStatementCheck extends LoanStatement {
  /** Draws − principal repaid at the end of the statement date, from the records. */
  recordedCents: Cents;
  /** statement − recorded (positive: the lender says you owe more). */
  differenceCents: Cents;
  matches: boolean;
}

export interface LoanSummary {
  loanId: LoanId;
  name: string;
  closed: boolean;
  asOf: LocalDate;
  /** Null while no price is known. */
  priceCents: Cents | null;
  aprMillionths: number;
  dayCount: Loan['dayCount'];
  // --- The loan (exact from your records unless marked) ---
  drawnCents: Cents;
  /** Of `drawnCents`: for linked purchases, and for anything else. */
  purchasesDrawnCents: Cents;
  otherDrawsCents: Cents;
  principalRepaidCents: Cents;
  /** max(0, drawn − repaid). */
  principalOwedCents: Cents;
  /** Overpaid principal (the lender owes you), else 0. */
  creditCents: Cents;
  interestPaidCents: Cents;
  /** Last day the recorded interest covers; null before the first payment. */
  interestPaidThrough: LocalDate | null;
  /** ESTIMATE: interest since `interestPaidThrough` through `asOf` (billed or not), on the recorded balance. */
  accruedInterestCents: Cents;
  accruedFrom: LocalDate | null;
  /**
   * The latest statement closing date from `accruedFrom` through `asOf` (by the statement day in force on `asOf`):
   * accrued interest up to it has been billed, not paid. Null when no statement closed in that time (none of it is
   * billed yet) or the loan has no statement day.
   */
  accruedBilledThrough: LocalDate | null;
  /**
   * ESTIMATE: interest for the days payments already cover that they did not pay (a cycle paid in part): the
   * cycles' interest − the interest paid for them, never below 0. 0 when every cycle was paid in full.
   */
  unpaidBilledInterestCents: Cents;
  /** Principal owed + unpaid billed interest + accrued interest (an estimate whenever either interest part is not 0). */
  owedNowCents: Cents;
  owedNowEstimated: boolean;
  creditLimitCents: Cents | null;
  /** Limit − (drawn − repaid); null without a limit. Negative means over the limit. */
  availableCreditCents: Cents | null;
  statements: LoanStatementCheck[];
  // --- The coins it bought ---
  purchaseCount: number;
  /** Cost of every linked purchase (held or not). */
  purchasesCostCents: Cents;
  /** Everything the linked purchases bought: held + frozen + sold + other gone, exactly. */
  boughtSats: Sats;
  heldSats: Sats;
  heldCostCents: Cents;
  frozenSats: Sats;
  soldSats: Sats;
  soldCostCents: Cents;
  proceedsCents: Cents;
  otherGoneSats: Sats;
  /** Paid back by frozen platforms for these coins (see `LoanPurchase.recoveredCents`). */
  recoveredCents: Cents;
  /** Each held coin valued on its own at the price (half-up), summed. */
  valueCents: Cents | null;
  /** Price-based: value − held cost. */
  upDownCents: Cents | null;
  /**
   * Interest charged to the coins: the purchases' shares. Exactly the interest paid when every draw was a
   * purchase; otherwise an ESTIMATE (`interestOnPurchasesEstimated`).
   */
  interestOnPurchasesCents: Cents;
  interestOnPurchasesEstimated: boolean;
  /** Interest paid for days with no balance and no draws yet (e.g. dated before any purchase): on nothing. */
  unallocatedInterestCents: Cents;
  /** value − held cost − interest on purchases. */
  gainIncludingInterestCents: Cents | null;
  /** value + proceeds + recovered − cost of every purchase − interest on purchases: the whole result of borrowing to buy. */
  overallResultCents: Cents | null;
  /** (held cost + interest on purchases) ÷ held BTC, cents per BTC, half-up. Null with nothing held. */
  breakEvenPriceCents: Cents | null;
  /** Owed now ÷ held BTC, rounded up: the price at which selling every held coin would just pay the loan off. */
  payoffPriceCents: Cents | null;
  /** Held sats − sats needed to pay off what is owed now (rounded up). Negative: short. */
  payoffLeftoverSats: Sats | null;
  /** The same using principal only (no accrued estimate), as a spreadsheet that tracks paid interest would. */
  payoffLeftoverPrincipalOnlySats: Sats | null;
}

const ceilDiv = (n: bigint, d: bigint): bigint => (n + d - 1n) / d;

/** The latest statement closing date on or before `onDate` if it is on or after `from` (see `accruedBilledThrough`). */
function billedThrough(loan: Loan, from: LocalDate | null, onDate: LocalDate): LocalDate | null {
  const day = statementDayOn(loan, onDate);
  if (from === null || day === null) return null;
  const close = latestMonthDay(onDate, day);
  return close >= from ? close : null;
}

/** Sats needed to raise `cents` at `priceCents` per BTC, rounded up (never negative). */
function satsFor(cents: Cents, priceCents: Cents): Sats {
  return cents <= 0 ? 0 : Number(ceilDiv(BigInt(cents) * BigInt(SATS_PER_BTC), BigInt(priceCents)));
}

interface Analysis {
  loan: Loan;
  draws: LoanDraw[];
  payments: LoanPayment[];
  allocation: Allocation;
}

/** The records dated through `onDate` and their interest allocation. */
function analyzeLoan(loan: Loan, onDate: LocalDate): Analysis {
  const draws = loan.draws.filter((d) => d.date <= onDate);
  const payments = loan.payments.filter((p) => p.date <= onDate);
  return { loan, draws, payments, allocation: allocate(loan, draws, payments, onDate) };
}

function purchasesOf(state: LedgerState, a: Analysis, priceCents: Cents | null): LoanPurchase[] {
  const { draws, allocation } = a;
  const traced = draws.map((d) => (d.lotId === null ? null : traceCoins(state, d.lotIds)));
  const purchases: LoanPurchase[] = [];
  draws.forEach((d, i) => {
    const t = traced[i] as TracedCoins | null;
    if (t === null) return;
    const sold = t.gone.filter((g) => g.kind === 'sold' || g.kind === 'spent');
    const gone = sum(t.gone.map((g) => g.sats));
    // Each coin valued on its own, half-up, as everywhere else in the app (so the figures never differ by a cent).
    const valueCents = priceCents === null ? null : sum(t.held.map((l) => mulDivRoundHalfUp(l.sats, priceCents, SATS_PER_BTC)));
    const closedOut = t.gone.filter((g) => g.kind === 'closed-out');
    const upDownCents = valueCents === null ? null : valueCents - t.heldCostCents;
    const interestShareCents = allocation.shares[i] as number;
    purchases.push({
      lotId: d.lotId as LotId,
      linkEntryId: d.entryId,
      drawDate: d.date,
      drawCents: d.cents,
      sats: t.heldSats + t.frozenSats + gone,
      costCents: t.heldCostCents + t.frozenCostCents + sum(t.gone.map((g) => g.costCents)),
      heldSats: t.heldSats,
      heldCostCents: t.heldCostCents,
      frozenSats: t.frozenSats,
      soldSats: sum(sold.map((g) => g.sats)),
      soldCostCents: sum(sold.map((g) => g.costCents)),
      proceedsCents: sum(sold.map((g) => g.proceedsCents)),
      otherGoneSats: gone - sum(sold.map((g) => g.sats)),
      recoveredCents: sum(closedOut.map((g) => g.proceedsCents)) + sum(t.recovered.map((r) => r.cents)),
      gone: t.gone,
      valueCents,
      upDownCents,
      interestShareCents,
      gainIncludingInterestCents: upDownCents === null ? null : upDownCents - interestShareCents,
    });
  });
  return purchases;
}

/** Each loan-funded purchase as of `onDate` at `priceCents` per BTC (null: no price). Empty for an unknown loan. */
export function loanPurchases(state: LedgerState, loanId: LoanId, priceCents: Cents | null, onDate: LocalDate): LoanPurchase[] {
  const loan = findLoan(state, loanId);
  return loan === null ? [] : purchasesOf(state, analyzeLoan(loan, onDate), priceCents);
}

/**
 * The whole picture for one loan as of `onDate` (records dated after it are ignored) at `priceCents` per BTC
 * (null: no price yet). Coins are as in `state`: pass a state replayed to that moment for a past view. Null
 * for an unknown loan.
 */
export function loanSummary(state: LedgerState, loanId: LoanId, priceCents: Cents | null, onDate: LocalDate): LoanSummary | null {
  const found = findLoan(state, loanId);
  if (found === null) return null;
  const a = analyzeLoan(found, onDate);
  const { loan, draws, payments, allocation } = a;
  const purchases = purchasesOf(state, a, priceCents);
  const total = (f: (p: LoanPurchase) => number): number => sum(purchases.map(f));
  const drawnCents = sum(draws.map((d) => d.cents));
  const purchasesDrawnCents = sum(draws.filter((d) => d.lotId !== null).map((d) => d.cents));
  const principalRepaidCents = sum(payments.map((p) => p.principalCents));
  const net = drawnCents - principalRepaidCents;
  const principalOwedCents = Math.max(0, net);
  const owedNowCents = principalOwedCents + allocation.unpaidBilledCents + allocation.accruedCents;
  const interestPaidCents = sum(payments.map((p) => p.interestCents));
  const otherDrawsCents = drawnCents - purchasesDrawnCents;
  const interestOnPurchasesCents = total((p) => p.interestShareCents);
  const heldSats = total((p) => p.heldSats);
  const heldCostCents = total((p) => p.heldCostCents);
  const proceedsCents = total((p) => p.proceedsCents);
  const recoveredCents = total((p) => p.recoveredCents);
  const purchasesCostCents = total((p) => p.costCents);
  const valueCents = priceCents === null ? null : total((p) => p.valueCents as number);
  const upDownCents = valueCents === null ? null : valueCents - heldCostCents;
  const throughDates = payments.filter((p) => p.interestCents > 0).map((p) => p.interestThrough).sort(compareStrings);
  const perBtc = (cents: Cents): Cents | null => (heldSats === 0 ? null : mulDivOrNull(cents, SATS_PER_BTC, heldSats));
  return {
    loanId: loan.id,
    name: loan.name,
    closed: loan.closed,
    asOf: onDate,
    priceCents,
    aprMillionths: aprOn(loan, onDate),
    dayCount: loan.dayCount,
    drawnCents,
    purchasesDrawnCents,
    otherDrawsCents,
    principalRepaidCents,
    principalOwedCents,
    creditCents: Math.max(0, -net),
    interestPaidCents,
    interestPaidThrough: throughDates.at(-1) ?? null,
    accruedInterestCents: allocation.accruedCents,
    accruedFrom: allocation.accruedFrom,
    accruedBilledThrough: billedThrough(loan, allocation.accruedFrom, onDate),
    unpaidBilledInterestCents: allocation.unpaidBilledCents,
    owedNowCents,
    owedNowEstimated: allocation.accruedCents !== 0 || allocation.unpaidBilledCents !== 0,
    creditLimitCents: loan.creditLimitCents,
    availableCreditCents: loan.creditLimitCents === null ? null : loan.creditLimitCents - net,
    statements: loan.statements
      .filter((s) => s.date <= onDate)
      .map((s) => {
        const recordedCents = netPrincipalOn(loan, s.date);
        return { ...s, recordedCents, differenceCents: s.balanceCents - recordedCents, matches: s.balanceCents === recordedCents };
      }),
    purchaseCount: purchases.length,
    purchasesCostCents,
    boughtSats: total((p) => p.sats),
    heldSats,
    heldCostCents,
    frozenSats: total((p) => p.frozenSats),
    soldSats: total((p) => p.soldSats),
    soldCostCents: total((p) => p.soldCostCents),
    proceedsCents,
    otherGoneSats: total((p) => p.otherGoneSats),
    valueCents,
    upDownCents,
    interestOnPurchasesCents,
    interestOnPurchasesEstimated: otherDrawsCents !== 0 || allocation.unallocatedCents !== 0,
    unallocatedInterestCents: allocation.unallocatedCents,
    gainIncludingInterestCents: upDownCents === null ? null : upDownCents - interestOnPurchasesCents,
    recoveredCents,
    overallResultCents: valueCents === null ? null : valueCents + proceedsCents + recoveredCents - purchasesCostCents - interestOnPurchasesCents,
    breakEvenPriceCents: perBtc(heldCostCents + interestOnPurchasesCents),
    payoffPriceCents: heldSats === 0 ? null : Number(ceilDiv(BigInt(owedNowCents) * BigInt(SATS_PER_BTC), BigInt(heldSats))),
    payoffLeftoverSats: priceCents === null || priceCents <= 0 ? null : heldSats - satsFor(owedNowCents, priceCents),
    payoffLeftoverPrincipalOnlySats: priceCents === null || priceCents <= 0 ? null : heldSats - satsFor(principalOwedCents, priceCents),
  };
}

/** Interest paid in one tax year, for the CPA note. */
export interface LoanInterestYear {
  year: number;
  /** Interest paid (by payment date): exact from your records. */
  interestPaidCents: Cents;
  /** The share on loan-funded purchases: exact when every draw was a purchase, else an ESTIMATE. */
  onPurchasesCents: Cents;
  loans: { loanId: LoanId; name: string; interestPaidCents: Cents; onPurchasesCents: Cents }[];
  /**
   * "Interest paid so far" lump sums whose time (the loan's start through the day it was recorded) includes this year.
   * Not in the figures above: it was paid over several years and is not split by year. Listed under every year it spans.
   */
  paidBefore: LoanInterestPaidBefore[];
}

/** An "interest paid so far" lump sum: interest paid by `date`, over the loan's history, not split by year. */
export interface LoanInterestPaidBefore {
  loanId: LoanId;
  name: string;
  /** The day it was recorded (the last payment it includes). */
  date: LocalDate;
  interestPaidCents: Cents;
  /** The share on loan-funded purchases: exact when every draw was a purchase, else an ESTIMATE. */
  onPurchasesCents: Cents;
}

/** Plain-language note for Tax season. Not tax advice. */
export const LOAN_INTEREST_CPA_NOTE =
  'Interest on money borrowed to buy investments may be deductible as investment interest (Form 4952), but only if you itemize, only up to your net investment income, and only for the part of the loan traced to the investment. Interest on a home equity loan used for something other than the home is not deductible as mortgage interest. Confirm with your CPA.';

/**
 * Interest paid per calendar year of the payment date, across every loan (or one), oldest year first. An "interest
 * paid so far" lump sum is not put in the year it was recorded: it is listed in `paidBefore` of every year it spans.
 */
export function loanInterestByYear(state: LedgerState, loanId?: LoanId): LoanInterestYear[] {
  const years = new Map<number, LoanInterestYear>();
  const yearRow = (year: number): LoanInterestYear => {
    const y = years.get(year) ?? { year, interestPaidCents: 0, onPurchasesCents: 0, loans: [], paidBefore: [] };
    years.set(year, y);
    return y;
  };
  for (const loan of state.loans) {
    if (loanId !== undefined && loan.id !== loanId) continue;
    // As of the loan's last record, so each payment's split is final.
    const last = [...loan.draws.map((d) => d.date), ...loan.payments.flatMap((p) => [p.date, p.interestThrough])].sort(compareStrings).at(-1);
    if (last === undefined) continue;
    const a = analyzeLoan(loan, last);
    for (const { payment, shares } of a.allocation.perPayment) {
      const year = Number(payment.date.slice(0, 4));
      const onPurchases = sum(shares.filter((_, i) => (a.draws[i] as LoanDraw).lotId !== null));
      if (payment.paidSoFar === true) {
        const lump = { loanId: loan.id, name: loan.name, date: payment.date, interestPaidCents: payment.interestCents, onPurchasesCents: onPurchases };
        for (let y = Math.min(year, Number(dateOfDay(startDay(loan, a.draws)).slice(0, 4))); y <= year; y++) yearRow(y).paidBefore.push(lump);
        continue;
      }
      const y = yearRow(year);
      y.interestPaidCents += payment.interestCents;
      y.onPurchasesCents += onPurchases;
      const row = y.loans.find((r) => r.loanId === loan.id) ?? { loanId: loan.id, name: loan.name, interestPaidCents: 0, onPurchasesCents: 0 };
      if (!y.loans.includes(row)) y.loans.push(row);
      row.interestPaidCents += payment.interestCents;
      row.onPurchasesCents += onPurchases;
    }
  }
  return [...years.values()].sort((a, b) => a.year - b.year);
}

/** The loan each loan-funded purchase belongs to, keyed by purchase lot id (use `originLotId` for moved pieces). */
export function loanByPurchase(state: LedgerState): Map<LotId, LoanId> {
  return new Map(state.loans.flatMap((l) => l.draws.flatMap((d) => d.lotIds.map((id) => [id, l.id] as const))));
}
