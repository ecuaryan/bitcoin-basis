/**
 * Retirement purchases (coins bought inside an IRA): what each cost, what it is worth now and the gain or loss, plus
 * the "all Bitcoin" view that puts the taxable book and retirement wallets side by side. Read-only views. Nothing here
 * feeds lots, cost basis, gains, Form 8949, tax estimates, the planner or loans.
 */
import { sum } from './book.ts';
import { dayNumber } from './dates.ts';
import { mulDivOrNull, SATS_PER_BTC, type Cents, type Sats } from './money.ts';
import { averageCostPerBtc, type Holdings, type RetirementHolding } from './reports.ts';
import type { EntryId, IsoInstant, LedgerState, LocalDate, Lot, WalletId } from './types.ts';

/** Some coins at a price against what they cost. Whole cents; null where there is no price or no recorded cost. */
export interface Worth {
  sats: Sats;
  costCents: Cents;
  /** sats × price, half-up; null without a price (or when too large to represent). */
  valueCents: Cents | null;
  /** Worth − cost over the coins whose cost is recorded; null without a price or without any recorded cost. */
  gainCents: Cents | null;
  /** Gain ÷ cost as a whole percent, to the nearest (half away from zero); null with no gain or a $0 cost. */
  percent: number | null;
}

/** Value of `sats` at `priceCents` per BTC (half-up), or null without a price or when it cannot be represented. */
function valueAt(sats: Sats, priceCents: Cents | null): Cents | null {
  return priceCents === null ? null : mulDivOrNull(sats, priceCents, SATS_PER_BTC);
}

/** Whole percent of `gainCents` over `costCents`, rounded to the nearest (half away from zero); null when the cost is $0. */
function percentOf(gainCents: Cents, costCents: Cents): number | null {
  if (costCents <= 0) return null;
  const magnitude = Number((BigInt(Math.abs(gainCents)) * 200n + BigInt(costCents)) / (2n * BigInt(costCents)));
  return gainCents < 0 ? -magnitude : magnitude;
}

const plus = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b);

function worthFrom(sats: Sats, costCents: Cents, valueCents: Cents | null, gainCents: Cents | null): Worth {
  return { sats, costCents, valueCents, gainCents, percent: gainCents === null ? null : percentOf(gainCents, costCents) };
}

/** Coins whose whole cost is known: worth now and gain at `priceCents` (null for none). */
export function worthOf(sats: Sats, costCents: Cents, priceCents: Cents | null): Worth {
  const valueCents = valueAt(sats, priceCents);
  return worthFrom(sats, costCents, valueCents, valueCents === null ? null : valueCents - costCents);
}

/**
 * Value of several pieces (lots, purchases) at `priceCents`: each piece valued on its own (half-up), then added. This is
 * the one way coins are valued, so a list of pieces always adds up to its total exactly. Null without a price or when a
 * piece's value cannot be represented.
 */
export function valueOfPieces(pieces: readonly { sats: Sats }[], priceCents: Cents | null): Cents | null {
  return pieces.reduce<Cents | null>((v, p) => plus(v, valueAt(p.sats, priceCents)), valueAt(0, priceCents));
}

/** Pieces whose whole cost is known (lots, purchases): worth now (`valueOfPieces`) and gain at `priceCents`. */
export function worthOfPieces(pieces: readonly { sats: Sats; costCents: Cents }[], priceCents: Cents | null): Worth {
  const sats = sum(pieces.map((p) => p.sats));
  const costCents = sum(pieces.map((p) => p.costCents));
  const valueCents = valueOfPieces(pieces, priceCents);
  return worthFrom(sats, costCents, valueCents, valueCents === null ? null : valueCents - costCents);
}

/**
 * One retirement wallet's worth: with purchases, each purchase valued on its own (so the purchase list adds up to it)
 * with cost and gain; with balance notes only, the note's balance, with no cost or gain.
 */
export function retirementWorth(state: LedgerState, r: RetirementHolding, priceCents: Cents | null): Worth {
  if (r.balanceFrom !== 'purchases') {
    const valueCents = valueAt(r.sats, priceCents);
    return worthFrom(r.sats, 0, valueCents, null);
  }
  return worthOfPieces(state.retirementBuys.filter((b) => b.wallet === r.wallet), priceCents);
}

/** One retirement purchase with what it is worth now. */
export interface RetirementPurchaseView extends Worth {
  /** The version applied (open this one to edit or remove it). */
  entryId: EntryId;
  /** Root of the version chain (stable through edits). */
  id: EntryId;
  wallet: WalletId;
  at: IsoInstant;
  date: LocalDate;
  tz: string;
  proof: string;
  averageCostCentsPerBtc: Cents | null;
  /** Whole days from the purchase's local date to `today` (0 for today or a later date). */
  heldDays: number;
}

/** Retirement purchases (of one wallet, or of all with `wallet` null), oldest first, valued at `priceCents` on `today`. */
export function retirementPurchases(state: LedgerState, wallet: WalletId | null, priceCents: Cents | null, today: LocalDate): RetirementPurchaseView[] {
  return state.retirementBuys
    .filter((b) => wallet === null || b.wallet === wallet)
    .map((b) => ({
      ...worthOf(b.sats, b.costCents, priceCents),
      entryId: b.entryId,
      id: b.id,
      wallet: b.wallet,
      at: b.at,
      date: b.date,
      tz: b.tz,
      proof: b.proof,
      averageCostCentsPerBtc: averageCostPerBtc(b.costCents, b.sats),
      heldDays: Math.max(0, dayNumber(today) - dayNumber(b.date)),
    }));
}

export interface WorthWithUnknown extends Worth {
  /** Sats whose cost is not recorded (retirement wallets with balance notes only): in the worth, not in cost or gain. */
  unknownCostSats: Sats;
}

/** Taxable, retirement and everything together. */
export interface AllBitcoin {
  /** Exactly the taxable totals (`holdings().totalSats` and `totalCostCents`: frozen and retirement left out). */
  taxable: Worth;
  /** Every retirement wallet's balance; cost and gain over the wallets with recorded purchases. */
  retirement: WorthWithUnknown;
  /** Taxable plus retirement. The parts add up to it exactly. */
  total: WorthWithUnknown;
}

/** The lots counted in the taxable totals (wallets that are not frozen or retirement), each to be valued on its own. */
export function taxableLots(state: LedgerState): Lot[] {
  const counted = new Set(state.wallets.filter((w) => !w.frozen && w.type !== 'retirement').map((w) => w.id));
  return state.lots.filter((l) => counted.has(l.wallet));
}

/**
 * Taxable plus retirement: overall BTC, worth, cost (where known) and gain at `priceCents`. Frozen wallets stay out,
 * as in the taxable totals. Every worth is piece by piece (`valueOfPieces`: each lot and each retirement purchase on its
 * own), so the lists on every screen add up to these totals. A view only: no tax figure ever reads the retirement part.
 */
export function allBitcoin(state: LedgerState, h: Holdings, priceCents: Cents | null): AllBitcoin {
  const taxable = worthOfPieces(taxableLots(state), priceCents);
  const costed = h.retirement.filter((r) => r.balanceFrom === 'purchases');
  const unknownCostSats = sum(h.retirement.filter((r) => r.balanceFrom !== 'purchases').map((r) => r.sats));
  const sats = sum(h.retirement.map((r) => r.sats));
  const costCents = sum(costed.map((r) => r.costCents));
  const wallets = h.retirement.map((r) => retirementWorth(state, r, priceCents));
  const valueCents = wallets.reduce<Cents | null>((v, w) => plus(v, w.valueCents), valueAt(0, priceCents));
  // Worth, gain and percent are null together: a gain is never shown beside a worth that could not be worked out.
  const costedGain = wallets.filter((_, i) => (h.retirement[i] as RetirementHolding).balanceFrom === 'purchases').reduce<Cents | null>((g, w) => plus(g, w.gainCents), valueAt(0, priceCents));
  const gainCents = valueCents === null || costed.length === 0 ? null : costedGain;
  const retirement = { ...worthFrom(sats, costCents, valueCents, gainCents), unknownCostSats };
  const totalValue = plus(taxable.valueCents, valueCents);
  const totalGain = totalValue === null ? null : costed.length === 0 ? taxable.gainCents : plus(taxable.gainCents, gainCents);
  const total = { ...worthFrom(taxable.sats + sats, taxable.costCents + costCents, totalValue, totalGain), unknownCostSats };
  return { taxable, retirement, total };
}
