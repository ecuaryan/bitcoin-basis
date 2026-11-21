import { planSale, type LedgerState, type Lot, type LotPick, type SalePlan, type SalePlanError, type SalePlans, type Settings, type Result } from '@bitcoin-basis/engine';

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

/** Whole percent from 1/10000ths, rounded down when it is not 0 or 100 (never overstates a share). */
export function shortPercentFromBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  return `${bp > 0 && whole === 0 ? '<1' : whole}%`;
}

export type Segment = string | { cents: number; bold?: boolean } | { bold: string };

export const carriedOut = (p: SalePlan): number => p.carryforwardOut.st + p.carryforwardOut.lt;

/** One-line verdict on the comparison, as text with money slots (so hide-amounts can mask them). */
export function summarize(oldest: SalePlan, lowest: SalePlan): Segment[] {
  const out: Segment[] = [];
  const carryDiff = carriedOut(lowest) - carriedOut(oldest);
  if (oldest.totalTaxCents <= 0 && lowest.totalTaxCents <= 0) {
    out.push('Neither choice owes tax this year. ');
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
  return rough === 0 ? 'All coins used are Documented.' : `Part of the sale uses Estimated or Unknown cost (up to ${shortPercentFromBp(rough)}): confirm with your CPA.`;
}

/** The exchange follows its own default (oldest first) unless told which coins to sell. */
export function needsBrokerInstruction(plan: SalePlan): boolean {
  return plan.brokerInstructionNeeded;
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
