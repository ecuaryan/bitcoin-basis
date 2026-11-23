/** Turn picks into gains and tax for a planned sale. */
import { sum } from '../book.ts';
import { MAX_ENTRY_CENTS, mulDivOrNull, mulDivRoundHalfUp, splitProportional, SATS_PER_BTC, type Cents, type Sats } from '../money.ts';
import { pieceOf, withProceeds } from '../picks.ts';
import { incrementalTax, type Carryforward } from '../tax/tax.ts';
import type { DisposalPick, Lot, LotPick, Tier } from '../types.ts';
import { taxInput, type TaxContext } from './context.ts';

export interface SaleEvaluation {
  readonly proceedsCents: Cents;
  readonly costCents: Cents;
  readonly stGainCents: Cents;
  readonly ltGainCents: Cents;
  readonly gainCents: Cents;
  /** Oldest and newest acquired date among the coins used. */
  readonly coinsFrom: string;
  readonly coinsTo: string;
  /** Sats whose cost is Estimated or Unknown, and their share of the sale in 1/10000ths (half-up). */
  readonly estimatedSats: Sats;
  readonly estimatedShareBp: number;
  readonly federalTaxCents: Cents;
  readonly stateTaxCents: Cents;
  readonly totalTaxCents: Cents;
  /** What the sale leaves after this tax: proceeds − total tax (more than the proceeds when the sale saves tax). */
  readonly afterTaxCents: Cents;
  /** Carryforward into next year with the sale, and without it. */
  readonly carryforwardOut: Carryforward;
  readonly baseCarryforwardOut: Carryforward;
  /**
   * Each lot's part of the sale, in pick order: sats, cost, proceeds (the sale's proceeds split by sats, so they add up
   * to `proceedsCents`), gain and term. For a gift worth less than the giver's cost, cost, date and term are the basis
   * the dual-basis rule used, so proceeds − cost is the gain. Gains add up to `gainCents`, costs to `costCents`.
   */
  readonly pieces: readonly DisposalPick[];
}

const ROUGH: readonly Tier[] = ['estimated', 'unknown'];

/** Proceeds of selling `sats` at `priceCents` per BTC, or null when over $1 trillion (too large to plan). */
export function proceedsFor(sats: Sats, priceCents: Cents): Cents | null {
  const p = mulDivOrNull(sats, priceCents, SATS_PER_BTC);
  return p !== null && p <= MAX_ENTRY_CENTS ? p : null;
}

/**
 * `picks` must already be valid for `lots`. Proceeds split across picks by sats (half-up, remainder last);
 * gifts worth less than the giver's cost use the dual-basis rule, as in replay.
 */
export function evaluatePicks(lots: readonly Lot[], picks: readonly LotPick[], proceedsCents: Cents, ctx: TaxContext): SaleEvaluation {
  const byId = new Map(lots.map((l) => [l.id, l]));
  const used = picks.map((p) => ({ pick: p, lot: byId.get(p.lotId) as Lot }));
  const shares = splitProportional(proceedsCents, picks.map((p) => p.sats));
  const pieces = used.map(({ pick, lot }, i) => withProceeds(pieceOf(lot, pick.sats, ctx.onDate), shares[i] as number));
  const termGain = (term: 'short' | 'long'): Cents => sum(pieces.filter((p) => p.term === term).map((p) => p.gainCents));
  const st = termGain('short');
  const lt = termGain('long');
  const cost = sum(pieces.map((p) => p.costCents));
  const totalSats = sum(picks.map((p) => p.sats));
  const estimatedSats = sum(used.filter(({ lot }) => ROUGH.includes(lot.tier)).map(({ pick }) => pick.sats));
  const dates = used.map(({ lot }) => lot.acquiredDate).sort();
  const tax = incrementalTax(taxInput(ctx, 0, 0), taxInput(ctx, st, lt));
  return {
    proceedsCents,
    costCents: cost,
    stGainCents: st,
    ltGainCents: lt,
    gainCents: st + lt,
    coinsFrom: dates[0] as string,
    coinsTo: dates[dates.length - 1] as string,
    estimatedSats,
    estimatedShareBp: mulDivRoundHalfUp(estimatedSats, 10_000, totalSats),
    federalTaxCents: tax.federal,
    stateTaxCents: tax.state,
    totalTaxCents: tax.total,
    afterTaxCents: proceedsCents - tax.total,
    carryforwardOut: tax.carryforwardOut,
    baseCarryforwardOut: tax.baseCarryforwardOut,
    pieces,
  };
}
