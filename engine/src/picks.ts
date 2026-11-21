/**
 * Coin choice: orderings (oldest first, lowest tax), turning an ordering into picks, and
 * validating picks. Pure helpers over a lot list; replay uses the same validation.
 */
import { isLongTerm } from './dates.ts';
import { mulDivRoundHalfUp, SATS_PER_BTC, type Cents, type Sats } from './money.ts';
import { compareLotsOldestFirst } from './order.ts';
import { err, ok } from './result.ts';
import { TIERS, type DisposalPick, type EntryId, type LocalDate, type Lot, type LotId, type LotPick, type PickDetail, type PickError, type Result, type Term, type WalletId } from './types.ts';

/** Short- or long-term for coins from `lot` disposed of on `date`. Inherited lots are always long-term. */
export function termFor(lot: Pick<Lot, 'acquiredDate' | 'alwaysLongTerm'>, date: LocalDate): Term {
  return lot.alwaysLongTerm || isLongTerm(lot.acquiredDate, date) ? 'long' : 'short';
}

/** Cost of taking `sats` from a lot holding `lotSats` and `lotCost`: all of it, or a half-up share. */
export function splitCost(lotSats: Sats, lotCost: Cents, sats: Sats): Cents {
  return sats === lotSats ? lotCost : mulDivRoundHalfUp(lotCost, sats, lotSats);
}

/** Sats taken from a lot, with the gift loss basis (if any) still attached. */
export interface Piece extends PickDetail {
  readonly lossBasis: { readonly costCents: Cents; readonly acquiredDate: LocalDate; readonly term: Term } | null;
}

/** The piece of `lot` that `sats` would be on `date` (the lot is not changed). */
export function pieceOf(lot: Lot, sats: Sats, date: LocalDate): Piece {
  const lb = lot.lossBasis;
  return {
    lotId: lot.id,
    sats,
    costCents: splitCost(lot.sats, lot.costCents, sats),
    acquiredDate: lot.acquiredDate,
    tier: lot.tier,
    term: termFor(lot, date),
    inherited: lot.alwaysLongTerm,
    lossBasis: lb === null ? null : { costCents: splitCost(lot.sats, lb.costCents, sats), acquiredDate: lb.acquiredDate, term: isLongTerm(lb.acquiredDate, date) ? 'long' : 'short' },
  };
}

/** The piece without its loss basis. */
export function detailOf(p: Piece): PickDetail {
  return { lotId: p.lotId, sats: p.sats, costCents: p.costCents, acquiredDate: p.acquiredDate, tier: p.tier, term: p.term, inherited: p.inherited };
}

/**
 * Gain on a piece for `proceedsCents`. For a gift received worth less than the giver's cost
 * (Treas. Reg. 1.1015-1(a)): the giver's cost and date if that gives a gain; the value at the gift and
 * the gift date if that gives a loss; otherwise no gain or loss (the basis reported equals the proceeds).
 */
export function withProceeds(p: Piece, proceedsCents: Cents): DisposalPick {
  const base = detailOf(p);
  const lb = p.lossBasis;
  const basis = lb === null || proceedsCents >= p.costCents ? base : proceedsCents < lb.costCents ? { ...base, ...lb } : { ...base, costCents: proceedsCents };
  return { ...basis, proceedsCents, gainCents: proceedsCents - basis.costCents };
}

/** The wallet's open lots, oldest first (acquired date, then acquired instant, then lot id). */
export function oldestFirstOrder(lots: readonly Lot[], wallet: WalletId): Lot[] {
  return lots.filter((l) => l.wallet === wallet && l.sats > 0).sort(compareLotsOldestFirst);
}

/** Picks for `sats` from the wallet, oldest first. */
export function oldestFirst(lots: readonly Lot[], wallet: WalletId, sats: Sats): Result<LotPick[], PickError> {
  return picksFor(oldestFirstOrder(lots, wallet), sats);
}

export interface LowestTaxOptions {
  /** Price in cents per BTC. */
  readonly priceCents: Cents;
  /** Marginal rates (e.g. 0.273), used only to order lots. */
  readonly stRate: number;
  readonly ltRate: number;
  /** Local date of the planned sale (decides each lot's holding period). */
  readonly onDate: LocalDate;
}

/** Estimated gain per sat at `pricePerSat` (a float, for ranking only), with the dual-basis rule for gifts. */
function gainPerSat(lot: Lot, pricePerSat: number, onDate: LocalDate): { gain: number; term: Term } {
  const cost = lot.costCents / lot.sats;
  const lb = lot.lossBasis;
  if (lb === null || pricePerSat >= cost) return { gain: pricePerSat - cost, term: termFor(lot, onDate) };
  const value = lb.costCents / lot.sats;
  if (pricePerSat < value) return { gain: pricePerSat - value, term: isLongTerm(lb.acquiredDate, onDate) ? 'long' : 'short' };
  return { gain: 0, term: termFor(lot, onDate) };
}

/**
 * The wallet's open lots in "lowest tax this year" order: Documented, then Reconstructed,
 * Estimated, Unknown; within a tier by estimated tax per sat, lowest first (biggest losses
 * first; gifts worth less than the giver's cost use the basis that applies at this price). Ties keep oldest-first order.
 */
export function lowestTaxOrder(lots: readonly Lot[], wallet: WalletId, options: LowestTaxOptions): Lot[] {
  const pricePerSat = options.priceCents / SATS_PER_BTC;
  const keyed = oldestFirstOrder(lots, wallet).map((lot) => {
    const { gain, term } = gainPerSat(lot, pricePerSat, options.onDate);
    return { lot, tier: TIERS.indexOf(lot.tier), taxPerSat: (term === 'long' ? options.ltRate : options.stRate) * gain };
  });
  keyed.sort((a, b) => a.tier - b.tier || a.taxPerSat - b.taxPerSat);
  return keyed.map((k) => k.lot);
}

/** Cost per sat of `a` against `b`, exactly (cross-multiplied in BigInt): negative when `a` cost less per sat. */
function compareCostPerSat(a: Lot, b: Lot): number {
  const left = BigInt(a.costCents) * BigInt(b.sats);
  const right = BigInt(b.costCents) * BigInt(a.sats);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The wallet's open lots in "lowest cost first" order, the default for a gift: lowest cost per BTC first,
 * ties oldest first. The giver keeps the higher-cost coins (less tax on a later sale) and the recipient takes
 * over the cost. Lots that cost at or below the gift's value per BTC always come before lots that cost more,
 * so a gift uses coins with a loss (a loss nobody can claim, Treas. Reg. 1.1015-1(a)) only when the others
 * cannot cover it, and then the ones with the smallest loss per sat.
 */
export function lowestCostOrder(lots: readonly Lot[], wallet: WalletId): Lot[] {
  return oldestFirstOrder(lots, wallet).sort(compareCostPerSat);
}

/** Picks for `sats` from the wallet, lowest cost first (the default for a gift). */
export function lowestCostFirst(lots: readonly Lot[], wallet: WalletId, sats: Sats): Result<LotPick[], PickError> {
  return picksFor(lowestCostOrder(lots, wallet), sats);
}

/**
 * Sats of a gift's `picks` that come from lots costing more per sat than the gift is worth per sat
 * (`valueCents` for `totalSats`): given below cost, so their loss is lost. Picks of unknown lots count as 0.
 */
export function satsGivenBelowCost(lots: readonly Lot[], picks: readonly LotPick[], totalSats: Sats, valueCents: Cents): Sats {
  const byId = new Map(lots.map((l) => [l.id, l]));
  let below = 0;
  for (const p of picks) {
    const lot = byId.get(p.lotId);
    if (lot !== undefined && BigInt(lot.costCents) * BigInt(totalSats) > BigInt(valueCents) * BigInt(lot.sats)) below += p.sats;
  }
  return below;
}

/** Take up to `sats` from lots in the given order (as far as they go). */
export function takeInOrder(orderedLots: readonly Lot[], sats: Sats): LotPick[] {
  const picks: LotPick[] = [];
  let left = sats;
  for (const lot of orderedLots) {
    const take = Math.min(left, lot.sats);
    if (take > 0) picks.push({ lotId: lot.id, sats: take });
    left -= take;
  }
  return picks;
}

/** Take `sats` from lots in the given order, or say why not. */
export function picksFor(orderedLots: readonly Lot[], sats: Sats): Result<LotPick[], PickError> {
  if (!Number.isSafeInteger(sats) || sats <= 0) return err({ code: 'invalid-amount', message: 'amount must be a positive whole number of sats' });
  const picks = takeInOrder(orderedLots, sats);
  const left = sats - picks.reduce((s, p) => s + p.sats, 0);
  if (left > 0) return err({ code: 'insufficient-sats', message: `short by ${left} sats` });
  return ok(picks);
}

/** First problem with `picks` against lots found through `lookup`, or null if they are valid. */
export function pickProblem(lookup: (id: LotId) => Lot | undefined, wallet: WalletId, picks: readonly LotPick[], totalSats: Sats): PickError | null {
  if (!Number.isSafeInteger(totalSats) || totalSats <= 0) return { code: 'invalid-amount', message: 'amount must be a positive whole number of sats' };
  const seen = new Set<LotId>();
  let sum = 0;
  for (const p of picks) {
    if (!Number.isSafeInteger(p.sats) || p.sats <= 0) return { code: 'invalid-amount', lotId: p.lotId, message: 'each pick needs a positive whole number of sats' };
    if (seen.has(p.lotId)) return { code: 'duplicate-pick', lotId: p.lotId, message: `lot ${p.lotId} is picked twice` };
    seen.add(p.lotId);
    const lot = lookup(p.lotId);
    if (lot === undefined) return { code: 'unknown-lot', lotId: p.lotId, message: `lot ${p.lotId} does not exist` };
    if (lot.wallet !== wallet) return { code: 'wrong-wallet', lotId: p.lotId, message: `lot ${p.lotId} is in another wallet` };
    if (lot.sats < p.sats) return { code: 'insufficient-sats', lotId: p.lotId, message: `lot ${p.lotId} has ${lot.sats} sats, not ${p.sats}` };
    sum += p.sats;
  }
  if (sum !== totalSats) return { code: 'picks-sum-mismatch', message: `picks add up to ${sum} sats, not ${totalSats}` };
  return null;
}

/** Validate hand picks: each lot in the wallet with enough sats, no repeats, summing to `totalSats`. */
export function validatePicks(lots: readonly Lot[], wallet: WalletId, picks: readonly LotPick[], totalSats: Sats): Result<readonly LotPick[], PickError> {
  const byId = new Map(lots.map((l) => [l.id, l]));
  const problem = pickProblem((id) => byId.get(id), wallet, picks, totalSats);
  return problem === null ? ok(picks) : err(problem);
}

/** How a move's picks divide into moved sats (first) and fee sats (after), pick by pick. */
export function splitMovePicks(picks: readonly LotPick[], movedSats: Sats): { moved: Sats[]; fee: Sats[] } {
  let left = movedSats;
  const moved = picks.map((p) => {
    const m = Math.min(p.sats, left);
    left -= m;
    return m;
  });
  return { moved, fee: picks.map((p, i) => p.sats - (moved[i] as number)) };
}

/**
 * Picks that sell exactly the coins a move delivered (the destination lots `<moveId>:<sourceLotId>`).
 * Used for "prepare sale": move the chosen lots to an exchange, then sell these.
 */
export function picksAfterMove(moveId: EntryId, picks: readonly LotPick[], movedSats: Sats): LotPick[] {
  const { moved } = splitMovePicks(picks, movedSats);
  return picks.flatMap((p, i) => ((moved[i] as number) > 0 ? [{ lotId: `${moveId}:${p.lotId}`, sats: moved[i] as number }] : []));
}
