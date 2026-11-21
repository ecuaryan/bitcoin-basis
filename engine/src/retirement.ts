/**
 * Retirement purchases (coins bought inside an IRA): what each cost, what it is worth now and the gain or loss, plus
 * the "all Bitcoin" view that puts the taxable book and retirement wallets side by side. Read-only views. Nothing here
 * feeds lots, cost basis, gains, Form 8949, tax estimates, the planner or loans.
 */
import { sum } from './book.ts';
import { dayNumber } from './dates.ts';
import { mulDivOrNull, SATS_PER_BTC, type Cents, type Sats } from './money.ts';
import { averageCostPerBtc, type Holdings } from './reports.ts';
import type { EntryId, IsoInstant, LedgerState, LocalDate, WalletId } from './types.ts';

/** Some coins at a price against what they cost. Whole cents; null where there is no price or no recorded cost. */
export interface Worth {
  sats: Sats;
  costCents: Cents;
  /** sats × price, half-up; null without a price (or when too large to represent). */
  valueCents: Cents | null;
  /** Worth − cost over the coins whose cost is recorded; null without a price or without any recorded cost. */
  gainCents: Cents | null;
  /** Gain ÷ cost as a whole percent, toward zero (never overstates a gain); null with no gain or a $0 cost. */
  percent: number | null;
}

/** Value of `sats` at `priceCents` per BTC (half-up), or null without a price or when it cannot be represented. */
function valueAt(sats: Sats, priceCents: Cents | null): Cents | null {
  return priceCents === null ? null : mulDivOrNull(sats, priceCents, SATS_PER_BTC);
}

/** Whole percent of `gainCents` over `costCents`, toward zero; null when the cost is $0. */
function percentOf(gainCents: Cents, costCents: Cents): number | null {
  if (costCents <= 0) return null;
  const magnitude = Number((BigInt(Math.abs(gainCents)) * 100n) / BigInt(costCents));
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

/**
 * Taxable plus retirement: overall BTC, worth, cost (where known) and gain at `priceCents`. Frozen wallets stay out,
 * as in the taxable totals. A view only: no tax figure ever reads the retirement part.
 */
export function allBitcoin(h: Holdings, priceCents: Cents | null): AllBitcoin {
  const taxable = worthOf(h.totalSats, h.totalCostCents, priceCents);
  const costed = h.retirement.filter((r) => r.balanceFrom === 'purchases');
  const unknownCostSats = sum(h.retirement.filter((r) => r.balanceFrom !== 'purchases').map((r) => r.sats));
  const sats = sum(h.retirement.map((r) => r.sats));
  const costCents = sum(costed.map((r) => r.costCents));
  const valueCents = h.retirement.reduce<Cents | null>((v, r) => plus(v, valueAt(r.sats, priceCents)), valueAt(0, priceCents));
  // Worth, gain and percent are null together: a gain is never shown beside a worth that could not be worked out.
  const costedGain = costed.reduce<Cents | null>((g, r) => plus(g, plus(valueAt(r.sats, priceCents), -r.costCents)), valueAt(0, priceCents));
  const gainCents = valueCents === null || costed.length === 0 ? null : costedGain;
  const retirement = { ...worthFrom(sats, costCents, valueCents, gainCents), unknownCostSats };
  const totalValue = plus(taxable.valueCents, valueCents);
  const totalGain = totalValue === null ? null : costed.length === 0 ? taxable.gainCents : plus(taxable.gainCents, gainCents);
  const total = { ...worthFrom(taxable.sats + sats, taxable.costCents + costCents, totalValue, totalGain), unknownCostSats };
  return { taxable, retirement, total };
}
