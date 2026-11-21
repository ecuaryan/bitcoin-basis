/**
 * App-side helpers for loan tracking (docs/loans-spec.md). Every dollar figure comes from the engine; this file only
 * picks, sorts and words them. Money stays integer cents and sats.
 */
import { latestMonthDay, localDate, loanSummary, originLotId, suggestLoanPayment, type Entry, type LedgerState, type Loan, type LoanDraw, type LoanId, type LoanPurchase, type LotId } from '@bitcoin-basis/engine';
import { buildItems } from './entry-list.ts';
import type { WorthNow } from './worth-now.ts';

// ---- Tags on loan-funded purchases ------------------------------------------------------------

/** The short word on a purchase paid with a loan: `HELOC` for a home equity line, else `Loan`. */
export function loanTag(name: string): string {
  return /heloc|home[\s-]*equity/i.test(name) ? 'HELOC' : 'Loan';
}

export interface LoanTagInfo {
  loanId: LoanId;
  name: string;
  tag: string;
}

/** Every lot a draw paid for (an imported purchase split across rows has several). */
export function drawLots(d: Pick<LoanDraw, 'lotIds'>): readonly LotId[] {
  return d.lotIds;
}

const tagCache = new WeakMap<LedgerState, Map<LotId, LoanTagInfo>>();

/** Loan-funded purchases by purchase lot id (one replayed state is worked out once). */
export function loanTags(state: LedgerState): Map<LotId, LoanTagInfo> {
  let map = tagCache.get(state);
  if (map === undefined) {
    map = new Map();
    for (const loan of state.loans) {
      for (const d of loan.draws) for (const lot of drawLots(d)) map.set(lot, { loanId: loan.id, name: loan.name, tag: loanTag(loan.name) });
    }
    tagCache.set(state, map);
  }
  return map;
}

/** The loan that paid for a lot (a moved piece counts as its purchase), or null. */
export function loanTagFor(state: LedgerState, lotId: LotId): LoanTagInfo | null {
  return loanTags(state).get(originLotId(lotId)) ?? null;
}

// ---- Words -----------------------------------------------------------------------------------

/**
 * How far the price is from break-even, in whole percent toward zero (never overstates): `Price is 22% below
 * break-even`. Null when either is unknown.
 */
export function breakEvenWords(priceCents: number | null, breakEvenCents: number | null): string | null {
  if (priceCents === null || breakEvenCents === null || breakEvenCents <= 0) return null;
  const diff = BigInt(priceCents - breakEvenCents);
  const pct = Number(((diff < 0n ? -diff : diff) * 100n) / BigInt(breakEvenCents));
  if (pct === 0) return priceCents === breakEvenCents ? 'Price is at break-even' : 'Price is within 1% of break-even';
  return `Price is ${pct}% ${diff < 0n ? 'below' : 'above'} break-even`;
}

/** The statement day in words: `the 15th`, `the last day of the month`. */
export function statementDayText(day: number | null): string {
  if (day === null) return 'Not set';
  if (day >= 31) return 'Last day of the month';
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `The ${day}${suffix}`;
}

/** A loan purchase's coins still held as `WorthNow` (the engine's value and up/down; percent toward zero). */
export function purchaseWorth(p: LoanPurchase): WorthNow {
  const gain = p.upDownCents;
  const percent = gain === null || p.heldCostCents <= 0 ? null : Math.sign(gain) * Number((BigInt(Math.abs(gain)) * 100n) / BigInt(p.heldCostCents));
  return { sats: p.heldSats, costCents: p.heldCostCents, valueCents: p.valueCents, gainCents: gain, percent };
}

// ---- Monthly reminder ------------------------------------------------------------------------

export interface PaymentNudge {
  loanId: LoanId;
  name: string;
  /** The statement closing date of the cycle not paid yet. */
  cycleEnd: string;
  /** ESTIMATE of that cycle's interest. */
  interestCents: number;
}

/**
 * The first open loan whose last statement closed with interest due and no payment logged for that cycle (a payment
 * covers a cycle when its interest runs through the closing date). Needs a statement day.
 */
export function paymentNudge(state: LedgerState, today: string): PaymentNudge | null {
  for (const loan of state.loans) {
    if (loan.closed || loan.statementDay === null) continue;
    const s = suggestLoanPayment(state, loan.id, today);
    if (s === null || s.days <= 0 || s.interestCents <= 0) continue;
    if (loan.payments.some((p) => p.interestCents > 0 && p.interestThrough >= s.throughDate)) continue;
    return { loanId: loan.id, name: loan.name, cycleEnd: s.throughDate, interestCents: s.interestCents };
  }
  return null;
}

/** localStorage key: the cycle (a closing date) the payment reminder was put off for. Only a date. */
export const LOAN_NUDGE_KEY = 'bb.loan-nudge';

export function loanNudgeSnoozed(cycleEnd: string, storage: Pick<Storage, 'getItem'> = window.localStorage): boolean {
  try {
    return storage.getItem(LOAN_NUDGE_KEY) === cycleEnd;
  } catch {
    return false;
  }
}

export function snoozeLoanNudge(cycleEnd: string, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  try {
    storage.setItem(LOAN_NUDGE_KEY, cycleEnd);
  } catch {
    // Storage blocked: it comes back next visit.
  }
}

// ---- Statement check -------------------------------------------------------------------------

/**
 * Which statement to ask about: the latest closing date (today if the loan has no statement day, or nothing was owed
 * yet at that closing), with what the records say was owed then (exact: draws less what was paid down).
 */
export function statementToCheck(state: LedgerState, loan: Loan, today: string): { date: string; owedCents: number } {
  const owedOn = (d: string): number => loanSummary(state, loan.id, null, d)?.principalOwedCents ?? 0;
  const close = loan.statementDay === null ? today : latestMonthDay(today, loan.statementDay);
  const date = owedOn(close) === 0 && owedOn(today) > 0 ? today : close;
  return { date, owedCents: owedOn(date) };
}

// ---- Purchases that can be linked ------------------------------------------------------------

export interface PurchaseOption {
  /** The purchase's lot id (root id of the buy or imported lot). */
  lotId: LotId;
  /** Acquired local date. */
  date: string;
  sats: number;
  costCents: number;
  walletId: string;
  /** The loan it is paid with now, if any, and that link's current entry and draw date. */
  loanId: LoanId | null;
  linkEntryId: string | null;
  drawDate: string | null;
}

/** Every purchase and imported lot in the book (not removed), newest first, with the loan each is linked to. */
export function purchaseOptions(entries: readonly Entry[], state: LedgerState): PurchaseOption[] {
  const applied = new Set(state.applied);
  const links = new Map<LotId, { loanId: LoanId; entryId: string; date: string }>();
  for (const loan of state.loans) for (const d of loan.draws) for (const lot of drawLots(d)) links.set(lot, { loanId: loan.id, entryId: d.entryId, date: d.date });
  const out: PurchaseOption[] = [];
  for (const item of buildItems(entries)) {
    const e = item.current;
    if (item.deleted || item.conflict || !applied.has(e.id) || (e.kind !== 'buy' && e.kind !== 'opening-lot')) continue;
    const link = links.get(item.id);
    out.push({
      lotId: item.id,
      date: e.kind === 'buy' ? localDate(e.at, e.tz) : localDate(e.acquiredAt, e.tz),
      sats: e.sats,
      costCents: e.costCents,
      walletId: e.wallet,
      loanId: link?.loanId ?? null,
      linkEntryId: link?.entryId ?? null,
      drawDate: link?.date ?? null,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? (a.lotId < b.lotId ? 1 : -1) : a.date < b.date ? 1 : -1));
}

/** What to save so `loanId` is linked to exactly the `chosen` purchases (lot id to its draw date; null = its purchase date). */
export interface LinkPlan {
  add: { lot: LotId; drawDate?: string }[];
  /** Links to remove (their current entry ids). */
  remove: string[];
  /** Links whose draw date changes: replace `entryId` with a link that has the new date. */
  change: { entryId: string; lot: LotId; drawDate?: string }[];
}

export function planLinks(loanId: LoanId, options: readonly PurchaseOption[], chosen: ReadonlyMap<LotId, string | null>): LinkPlan {
  const plan: LinkPlan = { add: [], remove: [], change: [] };
  for (const o of options) {
    const want = chosen.has(o.lotId);
    const mine = o.loanId === loanId;
    const date = chosen.get(o.lotId) ?? null;
    const drawDate = date !== null && date !== o.date ? { drawDate: date } : {};
    if (want && o.loanId === null) plan.add.push({ lot: o.lotId, ...drawDate });
    else if (!want && mine && o.linkEntryId !== null) plan.remove.push(o.linkEntryId);
    else if (want && mine && o.linkEntryId !== null && (date ?? o.date) !== o.drawDate) plan.change.push({ entryId: o.linkEntryId, lot: o.lotId, ...drawDate });
  }
  return plan;
}
