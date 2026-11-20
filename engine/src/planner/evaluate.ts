/** Turn picks into gains and tax for a planned sale. */
import { sum } from '../book.ts';
import { mulDivRoundHalfUp, splitProportional, SATS_PER_BTC, type Cents, type Sats } from '../money.ts';
import { splitCost, termFor } from '../picks.ts';
import { incrementalTax, type Carryforward } from '../tax/tax.ts';
import type { Lot, LotPick, Tier } from '../types.ts';
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
  /** Carryforward into next year with the sale, and without it. */
  readonly carryforwardOut: Carryforward;
  readonly baseCarryforwardOut: Carryforward;
}

const ROUGH: readonly Tier[] = ['estimated', 'unknown'];

/** Proceeds of selling `sats` at `priceCents` per BTC. */
export function proceedsFor(sats: Sats, priceCents: Cents): Cents {
  return mulDivRoundHalfUp(sats, priceCents, SATS_PER_BTC);
}

/** `picks` must already be valid for `lots`. Proceeds split across picks by sats (half-up, remainder last). */
export function evaluatePicks(lots: readonly Lot[], picks: readonly LotPick[], proceedsCents: Cents, ctx: TaxContext): SaleEvaluation {
  const byId = new Map(lots.map((l) => [l.id, l]));
  const used = picks.map((p) => ({ pick: p, lot: byId.get(p.lotId) as Lot }));
  const shares = splitProportional(proceedsCents, picks.map((p) => p.sats));
  let st = 0;
  let lt = 0;
  let cost = 0;
  used.forEach(({ pick, lot }, i) => {
    const c = splitCost(lot.sats, lot.costCents, pick.sats);
    const gain = (shares[i] as number) - c;
    cost += c;
    if (termFor(lot, ctx.onDate) === 'long') lt += gain;
    else st += gain;
  });
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
    carryforwardOut: tax.carryforwardOut,
    baseCarryforwardOut: tax.baseCarryforwardOut,
  };
}
