import { allBitcoin, carryforwardFor, retirementPurchases, retirementWorth, TIERS, valueOfPieces, yearOf, type AllBitcoin, type Holdings, type LedgerState, type Lot, type RetirementHolding, type RetirementPurchaseView, type Tier, type WalletType, type Worth, type WorthWithUnknown } from '@bitcoin-basis/engine';
import { confirmedLabel, sharePercents, wholeDollarParts } from './format.ts';
import { staleLosses } from './losses.ts';
import { WALLET_TYPE_LABEL } from './wallet-label.ts';

/** A retirement purchase in the stack: its own colour, no tax tier. */
export interface StackRetirementPurchase extends RetirementPurchaseView {
  walletName: string;
}

/** One row of a year's lots, taxable or retirement. */
export type StackPiece = { kind: 'lot'; lot: Lot } | { kind: 'retirement'; purchase: StackRetirementPurchase };

/** One year of "Your stack, by year bought": all your Bitcoin bought that year, taxable and retirement. */
export interface StackYear {
  year: number;
  /** Everything bought that year and still held: taxable lots plus retirement purchases. */
  sats: number;
  /** The taxable lots' part of `sats`. */
  taxableSats: number;
  /** The retirement purchases' part of `sats`. */
  retirementSats: number;
  /** Taxable lots only, by documentation tier (retirement has no tier). */
  byTier: Record<Tier, number>;
  /** The taxable lots, newest first. */
  lots: Lot[];
  /** The retirement purchases, newest first. */
  retirement: StackRetirementPurchase[];
  /** Lots and retirement purchases together, newest first (the year sheet's list). */
  pieces: StackPiece[];
}

/** Retirement coins with no purchase dates (balance notes only): in the total, not in any year. */
export interface StackUndated {
  sats: number;
  /** The wallets, by name, in creation order. */
  wallets: string[];
}

export interface WalletCard {
  id: string;
  name: string;
  type: WalletType;
  typeLabel: string;
  sats: number;
  costCents: number;
  averageCostCentsPerBtc: number | null;
  /** `Confirmed today`, `Confirmed Nov 2`, or `Not confirmed yet` (`confirmedLabel` in lib/format). */
  confirmedLabel: string;
  /** The last balance check did not match what the wallet's own app showed. */
  needsAttention: boolean;
  frozen: boolean;
}

/** A retirement wallet on Holdings. Never part of the taxable figures. */
export interface RetirementCard {
  id: string;
  name: string;
  sats: number;
  balanceFrom: RetirementHolding['balanceFrom'];
  /** Worth and, when purchases are recorded, cost and gain. */
  worth: Worth;
  /** `worth` in whole dollars as Held apart shows it: the wallets add up to the Retirement row under the hero. */
  shown: Worth;
  /** Cost and gain are known (purchases recorded). */
  costKnown: boolean;
  /** The latest balance note does not match the purchases up to its date. */
  noteDiffers: boolean;
}

export interface HoldingsView {
  totalSats: number;
  totalCostCents: number;
  averageCostCentsPerBtc: number | null;
  /** Null until a price is known. */
  worthCents: number | null;
  gainCents: number | null;
  lotCount: number;
  /** Share of the taxable BTC in each tier (`sharePercents`: adds up to 100%, `under 1%` for a sliver, 100% only for all). */
  tierShares: Record<Tier, string>;
  mix: Record<Tier, number>;
  /** Oldest year first; taxable lots and retirement purchases. With `stackUndated`, adds up to the hero's BTC. */
  stack: StackYear[];
  /** Retirement balance with no purchase dates, or null. */
  stackUndated: StackUndated | null;
  wallets: WalletCard[];
  frozen: WalletCard[];
  retirement: RetirementCard[];
  /** Taxable, retirement and all together; null when no retirement wallet holds anything (it would just repeat the total). */
  all: AllBitcoin | null;
  /**
   * The Taxable and Retirement rows under the hero, in whole dollars that add up to the hero's (`wholeDollarParts`:
   * worth to worth, gain to gain). Null without retirement coins.
   */
  split: { taxable: Worth; retirement: WorthWithUnknown } | null;
  /** The taxable unrealized gain as shown in whole dollars: the same figure as the Taxable row when there is one. */
  taxableGainShownCents: number | null;
  /** Losses from past years saved for this tax year. */
  carryforwardCents: number;
  /** None are saved for this year but an earlier year has some: the latest such year (ask to update them), else null. */
  staleLossesFor: number | null;
  isEmpty: boolean;
}


/** The two rows under the all-Bitcoin hero, in whole dollars that add up to its worth and gain (see `wholeDollarParts`). */
function splitShown(all: AllBitcoin): { taxable: Worth; retirement: WorthWithUnknown } {
  const value = all.total.valueCents === null ? [all.taxable.valueCents, all.retirement.valueCents] : wholeDollarParts([all.taxable.valueCents, all.retirement.valueCents], all.total.valueCents);
  const gain = all.total.gainCents === null ? [all.taxable.gainCents, all.retirement.gainCents] : wholeDollarParts([all.taxable.gainCents, all.retirement.gainCents], all.total.gainCents);
  return { taxable: { ...all.taxable, valueCents: value[0] ?? null, gainCents: gain[0] ?? null }, retirement: { ...all.retirement, valueCents: value[1] ?? null, gainCents: gain[1] ?? null } };
}

/** Each tier's share of `mix` (see `sharePercents`). */
export function tierShares(mix: Partial<Record<Tier, number>>): Record<Tier, string> {
  const shares = sharePercents(TIERS.map((t) => mix[t] ?? 0));
  return Object.fromEntries(TIERS.map((t, i) => [t, shares[i] as string])) as Record<Tier, string>;
}

const newestFirst = (a: number, b: number) => b - a;
const instant = (iso: string) => Date.parse(iso);

/**
 * "Your stack, by year bought": the taxable lots (wallets not frozen) and the retirement purchases, by the year they
 * were bought. Retirement wallets with balance notes only have no purchase dates; their balance is `stackUndated`.
 */
function stackOf(state: LedgerState, h: Holdings, lots: readonly Lot[], priceCents: number | null, today: string): { stack: StackYear[]; stackUndated: StackUndated | null } {
  const byYear = new Map<number, StackYear>();
  const rowFor = (year: number): StackYear => {
    let row = byYear.get(year);
    if (!row) {
      row = { year, sats: 0, taxableSats: 0, retirementSats: 0, byTier: Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>, lots: [], retirement: [], pieces: [] };
      byYear.set(year, row);
    }
    return row;
  };
  for (const l of lots) {
    const row = rowFor(yearOf(l.acquiredDate));
    row.sats += l.sats;
    row.taxableSats += l.sats;
    row.byTier[l.tier] += l.sats;
    row.lots.push(l);
  }
  // The same wallets as the hero's retirement part: those whose balance comes from their purchases.
  const dated = new Map(h.retirement.filter((r) => r.balanceFrom === 'purchases').map((r) => [r.wallet, r.name]));
  for (const p of retirementPurchases(state, null, priceCents, today)) {
    const walletName = dated.get(p.wallet);
    if (walletName === undefined) continue;
    const row = rowFor(yearOf(p.date));
    row.sats += p.sats;
    row.retirementSats += p.sats;
    row.retirement.push({ ...p, walletName });
  }
  const stack = [...byYear.values()].sort((a, b) => a.year - b.year);
  for (const row of stack) {
    row.lots.sort((a, b) => newestFirst(instant(a.acquiredAt), instant(b.acquiredAt)));
    row.retirement.sort((a, b) => newestFirst(instant(a.at), instant(b.at)));
    row.pieces = [
      ...row.lots.map((lot): StackPiece => ({ kind: 'lot', lot })),
      ...row.retirement.map((purchase): StackPiece => ({ kind: 'retirement', purchase })),
    ].sort((a, b) => newestFirst(instant(a.kind === 'lot' ? a.lot.acquiredAt : a.purchase.at), instant(b.kind === 'lot' ? b.lot.acquiredAt : b.purchase.at)));
  }
  const undated = h.retirement.filter((r) => r.balanceFrom === 'snapshot' && r.sats > 0);
  const stackUndated = undated.length === 0 ? null : { sats: undated.reduce((t, r) => t + r.sats, 0), wallets: undated.map((r) => r.name) };
  return { stack, stackUndated };
}

export function buildHoldingsView(state: LedgerState, h: Holdings, priceCents: number | null, today: string): HoldingsView {
  const live = new Set(h.wallets.filter((w) => !w.frozen).map((w) => w.wallet));
  const lots = state.lots.filter((l) => live.has(l.wallet));

  const { stack, stackUndated } = stackOf(state, h, lots, priceCents, today);

  const card = (w: Holdings['wallets'][number]): WalletCard => {
    const checks = state.balanceChecks.filter((c) => c.wallet === w.wallet);
    const lastMatch = checks.filter((c) => c.matches).reduce<string | null>((best, c) => (best === null || c.date > best ? c.date : best), null);
    const last = checks.reduce<(typeof checks)[number] | null>((best, c) => (best === null || c.date >= best.date ? c : best), null);
    return {
      id: w.wallet,
      name: w.name,
      type: w.type,
      typeLabel: WALLET_TYPE_LABEL[w.type],
      sats: w.sats,
      costCents: w.costCents,
      averageCostCentsPerBtc: w.averageCostCentsPerBtc,
      confirmedLabel: confirmedLabel(lastMatch, today),
      needsAttention: last !== null && !last.matches,
      frozen: w.frozen,
    };
  };

  // Lot by lot (each half-up, then added), as everywhere: the year rows, wallets and loan purchases add up to it exactly.
  const worthCents = valueOfPieces(lots, priceCents);
  const all = h.retirement.some((r) => r.sats > 0) ? allBitcoin(state, h, priceCents) : null;
  const split = all === null ? null : splitShown(all);
  const cards = h.retirement.map((r) => {
    const costKnown = r.balanceFrom === 'purchases';
    const worth = retirementWorth(state, r, priceCents);
    return { id: r.wallet, name: r.name, sats: r.sats, balanceFrom: r.balanceFrom, worth: costKnown ? worth : { ...worth, gainCents: null, percent: null }, costKnown, noteDiffers: costKnown && r.snapshot !== null && !r.snapshot.matches };
  });
  // Whole dollars that add up to the Retirement row (or, without one, each wallet toward zero).
  const values = wholeDollarParts(cards.map((c) => c.worth.valueCents), split?.retirement.valueCents ?? 0);
  const gains = wholeDollarParts(cards.map((c) => c.worth.gainCents), split?.retirement.gainCents ?? 0);
  const retirement: RetirementCard[] = cards.map((c, i) => ({ ...c, shown: split === null ? c.worth : { ...c.worth, valueCents: values[i] ?? null, gainCents: gains[i] ?? null } }));
  return {
    totalSats: h.totalSats,
    totalCostCents: h.totalCostCents,
    averageCostCentsPerBtc: h.averageCostCentsPerBtc,
    worthCents,
    gainCents: worthCents === null ? null : worthCents - h.totalCostCents,
    lotCount: lots.length,
    tierShares: tierShares(h.documentationMix),
    mix: h.documentationMix,
    stack,
    stackUndated,
    wallets: h.wallets
      .filter((w) => !w.frozen && !(w.archived && w.sats === 0))
      .map(card)
      .sort((a, b) => b.sats - a.sats),
    frozen: h.wallets.filter((w) => w.frozen).map(card),
    retirement,
    all,
    split,
    taxableGainShownCents: split === null ? worthCents === null ? null : worthCents - h.totalCostCents : split.taxable.gainCents,
    carryforwardCents: (({ st, lt }) => st + lt)(carryforwardFor(state.settings, yearOf(today), yearOf(today))),
    staleLossesFor: staleLosses(state.settings, yearOf(today))?.savedFor ?? null,
    isEmpty: state.wallets.length === 0 && state.lots.length === 0,
  };
}
