import { isBetterPlan, planSale, type DisposalPick, type LedgerState, type Lot, type LotPick, type SalePlan, type SalePlanError, type SalePlans, type Settings, type Result } from '@bitcoin-basis/engine';

/** The amount What if starts on: 0.25 BTC, or a round quarter of a smaller wallet. */
export function defaultSats(balance: number): number {
  if (balance >= 25_000_000) return 25_000_000;
  for (const unit of [1_000_000, 100_000, 10_000, 1000, 100, 1]) {
    const v = Math.floor(balance / 4 / unit) * unit;
    if (v > 0) return v;
  }
  return balance;
}

/** Size of one slider step in sats: 0.01 BTC for a big wallet, finer for a small one (at least ~20 steps). */
export function stepFor(balance: number): number {
  for (const step of [1_000_000, 100_000, 10_000, 1000, 100, 10]) if (balance / step >= 20) return step;
  return 1;
}

/** Slider runs 0..SLIDER_MAX over the wallet's balance. */
export const SLIDER_MAX = 1000;

/** Sats for a slider position (whole sats, integer math; the far end is exactly the whole balance). */
export function satsForSlider(balance: number, position: number): number {
  const p = Math.min(SLIDER_MAX, Math.max(0, Math.round(position)));
  if (p >= SLIDER_MAX) return balance;
  return Math.floor((balance * p) / SLIDER_MAX);
}

/** Slider position that best matches `sats`. */
export function sliderForSats(balance: number, sats: number): number {
  if (balance <= 0) return 0;
  return Math.min(SLIDER_MAX, Math.max(0, Math.round((sats * SLIDER_MAX) / balance)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2025-07-03`, `2025-10-20` as `Jul–Oct 2025`; one month as `Jul 2025`; across years `Jul 2022–Mar 2024`. */
export function rangeLabel(from: string, to: string): string {
  const [fy = '', fm = '1'] = from.split('-');
  const [ty = '', tm = '1'] = to.split('-');
  const a = MONTHS[Number(fm) - 1] ?? '';
  const b = MONTHS[Number(tm) - 1] ?? '';
  // No-break spaces: a line may break after the dash, never between a month and its year.
  if (fy === ty && fm === tm) return `${a}\u00a0${fy}`;
  if (fy === ty) return `${a}–${b}\u00a0${fy}`;
  return `${a}\u00a0${fy}–${b}\u00a0${ty}`;
}

/** Half-up percent with one decimal from 1/10000ths: 1234 becomes `12.3%`. */
export function percentFromBp(bp: number): string {
  const tenths = Math.floor((Math.abs(bp) + 5) / 10);
  return `${bp < 0 ? '\u2212' : ''}${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/**
 * A risky share (sats on Estimated or Unknown cost) as a whole percent from 1/10000ths, rounded UP so a warning never
 * understates it: 19.99% is `20%`, 0.5% is `1%`. Only all of it is `100%` (99.01% is `99%`).
 */
export function riskPercentFromBp(bp: number): string {
  if (bp <= 0) return '0%';
  if (bp >= 10_000) return '100%';
  return `${Math.min(99, Math.ceil(bp / 100))}%`;
}

/** What a plan does to this year's tax, worded the same as the Log review: `Tax this adds` or `Tax this saves`, and how much. */
export function taxEffectLabel(taxCents: number, adds = 'Tax this adds', saves = 'Tax this saves'): { label: string; cents: number } {
  return taxCents < 0 ? { label: saves, cents: -taxCents } : { label: adds, cents: taxCents };
}

export type Segment = string | { cents: number; bold?: boolean } | { bold: string };

export const carriedOut = (p: SalePlan): number => p.carryforwardOut.st + p.carryforwardOut.lt;

/** One-line verdict on the comparison, as text with money slots (so hide-amounts can mask them). */
export function summarize(oldest: SalePlan, lowest: SalePlan): Segment[] {
  const out: Segment[] = [];
  const carryDiff = carriedOut(lowest) - carriedOut(oldest);
  if (oldest.totalTaxCents <= 0 && lowest.totalTaxCents <= 0) {
    // Neither adds tax: compare what each saves this year, then the losses each leaves for next year.
    if (oldest.totalTaxCents === lowest.totalTaxCents) out.push(oldest.totalTaxCents === 0 ? 'Neither choice adds tax this year. ' : 'Both choices save the same tax this year. ');
    else if (lowest.totalTaxCents < oldest.totalTaxCents) out.push({ bold: 'Lowest tax saves ' }, { cents: oldest.totalTaxCents - lowest.totalTaxCents, bold: true }, { bold: ' more this year' }, ' than oldest first. ');
    else out.push({ bold: 'Oldest first saves ' }, { cents: lowest.totalTaxCents - oldest.totalTaxCents, bold: true }, { bold: ' more this year' }, ' than lowest tax. ');
    if (carryDiff > 0) out.push({ bold: 'Lowest tax keeps ' }, { cents: carryDiff, bold: true }, { bold: ' more losses' }, ' for next year. ');
    else if (carryDiff < 0) out.push({ bold: 'Oldest first keeps ' }, { cents: -carryDiff, bold: true }, { bold: ' more losses' }, ' for next year. ');
  } else if (oldest.totalTaxCents === lowest.totalTaxCents) {
    out.push('Both choices add the same tax: ', { cents: oldest.totalTaxCents, bold: true }, '. ');
  } else if (lowest.totalTaxCents < oldest.totalTaxCents) {
    out.push({ bold: 'Lowest tax saves ' }, { cents: oldest.totalTaxCents - lowest.totalTaxCents, bold: true }, { bold: ' this year' }, ' compared with oldest first. ');
  } else {
    out.push({ bold: 'Oldest first is cheaper by ' }, { cents: lowest.totalTaxCents - oldest.totalTaxCents, bold: true }, { bold: ' this year' }, '. ');
  }
  return out;
}

/** How well documented the coins used are (the detail behind the verdict). */
export function documentationNote(oldest: SalePlan, lowest: SalePlan): string {
  const rough = Math.max(oldest.estimatedShareBp, lowest.estimatedShareBp);
  return rough === 0 ? 'All coins used are Documented.' : `Part of the sale uses Estimated or Unknown cost (up to ${riskPercentFromBp(rough)}): confirm with your CPA.`;
}

/** The exchange follows its own default (oldest first) unless told which coins to sell. */
export function needsBrokerInstruction(plan: SalePlan): boolean {
  return plan.brokerInstructionNeeded;
}

/**
 * The small pill on the plan cards, by the engine's own rule (`isBetterPlan`: less tax wins; at equal tax, more loss left
 * for next year). Every plan no other plan beats gets one, unless no plan beats any other (then there is nothing to point
 * at). The words say why it won: `Least tax` (`Saves the most` when it saves tax), or `Keeps more losses` when another
 * plan costs the same tax.
 */
export function bestPills(plans: readonly SalePlan[]): (string | null)[] {
  const unbeaten = plans.map((p) => !plans.some((o) => isBetterPlan(o, p)));
  if (unbeaten.every(Boolean)) return plans.map(() => null);
  return plans.map((p, i) => {
    if (!unbeaten[i]) return null;
    const onTax = plans.every((o, j) => unbeaten[j] || o.totalTaxCents > p.totalTaxCents);
    if (!onTax) return 'Keeps more losses';
    return p.totalTaxCents < 0 ? 'Saves the most' : 'Least tax';
  });
}

/** Which plans' "Losses left for next year" stands out: the one plan that leaves the most (more than $0). */
export function mostCarried(plans: readonly SalePlan[]): boolean[] {
  const most = Math.max(...plans.map(carriedOut));
  const count = plans.filter((p) => carriedOut(p) === most).length;
  return plans.map((p) => most > 0 && count === 1 && carriedOut(p) === most);
}

/** `Short-term gain` or `Short-term loss`, by the sign ($0 is a gain of nothing). */
export function termLabel(term: 'Short-term' | 'Long-term', cents: number): string {
  return `${term} ${cents < 0 ? 'loss' : 'gain'}`;
}

/**
 * The tax as shown on a card: what it adds, or (negative tax) what it saves, as a positive figure, with its federal and
 * state parts flipped the same way so `Federal $X + state $Y` adds up to it (the engine splits them so they do).
 */
export function taxShown(plan: SalePlan): { label: string; saves: boolean; cents: number; federal: number; state: number } {
  const saves = plan.totalTaxCents < 0;
  const flip = saves ? -1 : 1;
  return { ...taxEffectLabel(plan.totalTaxCents), saves, federal: flip * plan.federalTaxCents, state: flip * plan.stateTaxCents };
}

export interface LotsUsed {
  rows: readonly DisposalPick[];
  /** Sum of the rows' sats; cost, proceeds and gain are the plan's own totals (the rows add up to them). */
  total: { sats: number; costCents: number; proceedsCents: number; gainCents: number };
}

/** The selected plan's lots, in the order the plan uses them, and the Total row. */
export function lotsUsed(plan: SalePlan): LotsUsed {
  return {
    rows: plan.pieces,
    total: { sats: plan.pieces.reduce((s, p) => s + p.sats, 0), costCents: plan.costCents, proceedsCents: plan.proceedsCents, gainCents: plan.gainCents },
  };
}

export type PlanKey = 'oldest-first' | 'lowest-tax' | 'hand-picked';

export function planFor(plans: SalePlans, key: PlanKey): SalePlan {
  if (key === 'oldest-first') return plans.oldestFirst;
  if (key === 'hand-picked' && plans.handPicked !== null) return plans.handPicked;
  return plans.lowestTax;
}

/**
 * Plan a sale from a wallet; for a self-custody wallet, plan the sale of those coins as if they were already on
 * an exchange (the later move keeps each lot's date and cost), so the comparison can still be shown.
 */
export function planForWallet(
  state: LedgerState,
  settings: Settings,
  req: Parameters<typeof planSale>[2],
): { plans: Result<SalePlans, SalePlanError>; selfCustody: boolean } {
  const wallet = state.wallets.find((w) => w.id === req.wallet);
  const selfCustody = wallet?.type === 'self-custody' && !wallet.frozen;
  if (!selfCustody) return { plans: planSale(state, settings, req), selfCustody: false };
  const asExchange: LedgerState = { ...state, wallets: state.wallets.map((w) => (w.id === req.wallet ? { ...w, type: 'exchange' } : w)) };
  return { plans: planSale(asExchange, settings, req), selfCustody: true };
}

/**
 * Hand picking: coins are chosen in the order tapped; each takes what is still needed, and the last one is trimmed.
 * `short` is how many sats are still missing (0 when the choice covers the amount).
 */
export function picksFromSelection(lots: readonly Lot[], order: readonly string[], target: number): { picks: LotPick[]; short: number } {
  const byId = new Map(lots.map((l) => [l.id, l]));
  const picks: LotPick[] = [];
  let left = target;
  for (const id of order) {
    const lot = byId.get(id);
    if (lot === undefined || left <= 0) continue;
    const take = Math.min(lot.sats, left);
    picks.push({ lotId: id, sats: take });
    left -= take;
  }
  return { picks, short: left };
}
