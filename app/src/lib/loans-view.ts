/**
 * App-side helpers for loan tracking (docs/loans-spec.md). Every dollar figure comes from the engine; this file only
 * picks, sorts and words them. Money stays integer cents and sats.
 */
import { latestMonthDay, localDate, loanSummary, originLotId, suggestLoanPayment, type Entry, type LedgerState, type Loan, type LoanDraw, type LoanId, type LoanLinkEntry, type LoanPurchase, type LotId } from '@bitcoin-basis/engine';
import { buildItems } from './entry-list.ts';
import { maskDigits } from './format.ts';
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
 * How far the price is from break-even, in the nearest whole percent (under half a percent says within 1%): `Price is 22% below
 * break-even`. Null when either is unknown. `masked` (Hide amounts) hides the percent like every other gain percent; the
 * words stay.
 */
export function breakEvenWords(priceCents: number | null, breakEvenCents: number | null, masked = false): string | null {
  if (priceCents === null || breakEvenCents === null || breakEvenCents <= 0) return null;
  const diff = BigInt(priceCents - breakEvenCents);
  const pct = Number(((diff < 0n ? -diff : diff) * 200n + BigInt(breakEvenCents)) / (2n * BigInt(breakEvenCents)));
  const shown = (text: string): string => (masked ? maskDigits(text) : text);
  if (pct === 0) return priceCents === breakEvenCents ? 'Price is at break-even' : `Price is within ${shown('1%')} of break-even`;
  return `Price is ${shown(`${pct}%`)} ${diff < 0n ? 'below' : 'above'} break-even`;
}

/** The statement day in words: `the 15th`, `the last day of the month`. */
export function statementDayText(day: number | null): string {
  if (day === null) return 'Not set';
  if (day >= 31) return 'Last day of the month';
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `The ${day}${suffix}`;
}

/** A loan purchase's coins still held as `WorthNow` (the engine's value and up/down; percent to the nearest whole). */
export function purchaseWorth(p: LoanPurchase): WorthNow {
  const gain = p.upDownCents;
  const percent = gain === null || p.heldCostCents <= 0 ? null : Math.sign(gain) * Number((BigInt(Math.abs(gain)) * 200n + BigInt(p.heldCostCents)) / (2n * BigInt(p.heldCostCents)));
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
 * The principal balance the records show at the end of `date`, as the engine checks a statement against it: draws less
 * principal paid (negative: paid more than was drawn, a credit). Exact.
 */
export function recordedBalanceOn(state: LedgerState, loanId: LoanId, date: string): number {
  const s = loanSummary(state, loanId, null, date);
  return s === null ? 0 : s.principalOwedCents - s.creditCents;
}

/**
 * Which statement to ask about: the latest closing date (today if the loan has no statement day, or nothing was owed
 * yet at that closing), with the balance the records show then (`recordedBalanceOn`: negative is a credit).
 */
export function statementToCheck(state: LedgerState, loan: Loan, today: string): { date: string; owedCents: number } {
  const owedOn = (d: string): number => recordedBalanceOn(state, loan.id, d);
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
  /**
   * Every lot the same link pays for (an imported purchase split across rows: they are ticked, dated and removed
   * together); just this lot when it is not linked.
   */
  linkLots: readonly LotId[];
  /** The draw date when none is given: the earliest of `linkLots`' dates (this lot's date when not linked). */
  drawDefault: string;
  /** The link entry itself (its `alsoLots` and `drawCents` carry over when its draw date changes), or null. */
  link: LoanLinkEntry | null;
}

/** Every purchase and imported lot in the book (not removed), newest first, with the loan each is linked to. */
export function purchaseOptions(entries: readonly Entry[], state: LedgerState): PurchaseOption[] {
  const applied = new Set(state.applied);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const links = new Map<LotId, { loanId: LoanId; entryId: string; date: string; lots: readonly LotId[] }>();
  for (const loan of state.loans) for (const d of loan.draws) for (const lot of drawLots(d)) links.set(lot, { loanId: loan.id, entryId: d.entryId, date: d.date, lots: drawLots(d) });
  const out: PurchaseOption[] = [];
  for (const item of buildItems(entries)) {
    const e = item.current;
    if (item.deleted || item.conflict || !applied.has(e.id) || (e.kind !== 'buy' && e.kind !== 'opening-lot')) continue;
    const link = links.get(item.id);
    const entry = link === undefined ? undefined : byId.get(link.entryId);
    out.push({
      lotId: item.id,
      date: e.kind === 'buy' ? localDate(e.at, e.tz) : localDate(e.acquiredAt, e.tz),
      sats: e.sats,
      costCents: e.costCents,
      walletId: e.wallet,
      loanId: link?.loanId ?? null,
      linkEntryId: link?.entryId ?? null,
      drawDate: link?.date ?? null,
      linkLots: link?.lots ?? [item.id],
      drawDefault: '',
      link: entry?.kind === 'loan-link' ? entry : null,
    });
  }
  const dates = new Map(out.map((o) => [o.lotId, o.date]));
  for (const o of out) o.drawDefault = o.linkLots.map((l) => dates.get(l) ?? o.date).sort()[0] ?? o.date;
  return out.sort((a, b) => (a.date === b.date ? (a.lotId < b.lotId ? 1 : -1) : a.date < b.date ? 1 : -1));
}

/** The lots that are ticked, unticked and dated together with `o` in a picker for `loanId` (its link's lots, if that loan's). */
export function lotsWith(o: PurchaseOption, loanId: LoanId | null): readonly LotId[] {
  return o.loanId !== null && o.loanId === loanId ? o.linkLots : [o.lotId];
}

/** What to save so `loanId` is linked to exactly the `chosen` purchases (lot id to its draw date; null = its default date). */
export interface LinkPlan {
  add: { lot: LotId; drawDate?: string }[];
  /** Links to remove (their current entry ids), each once. */
  remove: string[];
  /** Links whose draw date changes: replace `entryId` with a link that has the new date (and keeps its other lots and amount). */
  change: { entryId: string; lot: LotId; alsoLots?: LotId[]; drawCents?: number; drawDate?: string }[];
}

/**
 * The links to add, remove and change. A link to several lots (a CSV import that split one purchase across rows) is one
 * unit: removed once, and only when none of its lots is still chosen; a new draw date keeps its other lots and amount.
 */
export function planLinks(loanId: LoanId, options: readonly PurchaseOption[], chosen: ReadonlyMap<LotId, string | null>): LinkPlan {
  const plan: LinkPlan = { add: [], remove: [], change: [] };
  const seen = new Set<string>();
  for (const o of options) {
    if (o.loanId === null) {
      if (!chosen.has(o.lotId)) continue;
      const date = chosen.get(o.lotId) ?? null;
      plan.add.push({ lot: o.lotId, ...(date !== null && date !== o.date ? { drawDate: date } : {}) });
      continue;
    }
    if (o.loanId !== loanId || o.linkEntryId === null || seen.has(o.linkEntryId)) continue;
    seen.add(o.linkEntryId);
    const picked = o.linkLots.filter((l) => chosen.has(l));
    if (picked.length === 0) {
      plan.remove.push(o.linkEntryId);
      continue;
    }
    const date = picked.map((l) => chosen.get(l) ?? null).find((d) => d !== null) ?? null;
    if ((date ?? o.drawDefault) === o.drawDate) continue;
    const link = o.link;
    plan.change.push({
      entryId: o.linkEntryId,
      lot: link?.lot ?? o.lotId,
      ...(link?.alsoLots === undefined ? {} : { alsoLots: [...link.alsoLots] }),
      ...(link?.drawCents === undefined ? {} : { drawCents: link.drawCents }),
      ...(date !== null && date !== o.drawDefault ? { drawDate: date } : {}),
    });
  }
  return plan;
}

/** Removing a loan-funded purchase: the loan and draw it paid with, and the link version that keeps that draw counted. */
export interface FundedRemoval {
  loanId: LoanId;
  loanName: string;
  drawCents: number;
  drawDate: string;
  /**
   * A new version of the link that says its amount and date (null when it already does), saved with the removal: with
   * the purchase gone, the engine still counts the draw (as money drawn for something else), so what is owed stays right.
   */
  keepLink: Omit<LoanLinkEntry, 'id'> | null;
}

/** What removing the entry `entryId` (any version of a purchase or imported lot) does to a loan, or null if no loan paid for it. */
export function fundedRemoval(entries: readonly Entry[], state: LedgerState, entryId: string): FundedRemoval | null {
  const root = buildItems(entries).find((i) => i.versions.some((v) => v.id === entryId))?.id ?? entryId;
  for (const loan of state.loans) {
    const draw = loan.draws.find((d) => drawLots(d).includes(root));
    if (draw === undefined) continue;
    const link = entries.find((e) => e.id === draw.entryId);
    const keepLink: Omit<LoanLinkEntry, 'id'> | null =
      link?.kind !== 'loan-link' || (link.drawCents !== undefined && link.drawDate !== undefined)
        ? null
        : { ...withoutId(link), drawCents: draw.cents, drawDate: draw.date, replaces: link.id, reason: 'Its purchase was removed; the draw still counts' };
    return { loanId: loan.id, loanName: loan.name, drawCents: draw.cents, drawDate: draw.date, keepLink };
  }
  return null;
}

function withoutId<T extends { id: string }>(e: T): Omit<T, 'id'> {
  const { id, ...rest } = e;
  void id;
  return rest;
}

const GONE_WORDS: Record<LoanPurchase['gone'][number]['kind'], string> = {
  given: 'given away',
  sold: 'sold',
  spent: 'spent',
  fees: 'paid as network fees',
  lost: 'lost',
  'closed-out': 'closed out on a frozen platform',
};

/**
 * What became of the Bitcoin a loan's purchases bought that is no longer held: its sats and the ways it left, most
 * first (`given away, sold, spent or paid as network fees`). Null when none has left.
 */
export function goneWords(purchases: readonly LoanPurchase[]): { sats: number; words: string } | null {
  const by = new Map<string, number>();
  for (const p of purchases) for (const g of p.gone) by.set(g.kind, (by.get(g.kind) ?? 0) + g.sats);
  const kinds = [...by.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  if (kinds.length === 0) return null;
  const words = kinds.map(([k]) => GONE_WORDS[k as keyof typeof GONE_WORDS]);
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
  return { sats: kinds.reduce((t, [, s]) => t + s, 0), words: `later ${list}` };
}
