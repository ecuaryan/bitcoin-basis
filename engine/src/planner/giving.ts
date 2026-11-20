/** Giving: on one sale, and what is due for a year. */
import { sum } from '../book.ts';
import { mulDivRoundHalfUp, type Cents } from '../money.ts';
import { yearSummary } from '../reports.ts';
import { incrementalTax } from '../tax/tax.ts';
import type { GivingPaid, IncomeItem, LedgerState, Settings } from '../types.ts';
import { taxContext, taxInput } from './context.ts';

export interface GivingOnSaleInput {
  /** In 1/10000ths (1000 = 10%). */
  readonly percent: number;
  /** Net gain of the coins sold (negative for a loss). */
  readonly gains: Cents;
  readonly mode: 'before-tax' | 'after-tax';
  /** The sale's estimated tax; subtracted first in after-tax mode. */
  readonly estimatedTax: Cents;
}

/** percent × max(0, net gain), half-up to cents. After-tax mode subtracts the sale's estimated tax first. */
export function givingOnSale(input: GivingOnSaleInput): Cents {
  const net = input.mode === 'after-tax' ? input.gains - input.estimatedTax : input.gains;
  return mulDivRoundHalfUp(Math.max(0, net), input.percent, 10_000);
}

/** The settings' giving percent in 1/10000ths (stored that way: 1000 = 10%). */
export function givingPercentBp(settings: Pick<Settings, 'givingPercentBp'>): number {
  return settings.givingPercentBp;
}

export interface GivingSale {
  readonly entryId: string;
  readonly date: string;
  readonly gainCents: Cents;
  readonly estimatedTaxCents: Cents;
  readonly givingCents: Cents;
}

export interface GivingDue {
  readonly year: number;
  readonly enabled: boolean;
  readonly name: string;
  readonly sales: GivingSale[];
  /** Giving owed on the year's logged sales. */
  readonly dueCents: Cents;
  readonly paidCents: Cents;
  /** dueCents − paidCents (negative if paid ahead). */
  readonly owedCents: Cents;
  /** Income received that year (promos, rewards, mining), listed on its own and never tithed. */
  readonly income: IncomeItem[];
  readonly incomeCents: Cents;
  readonly paidEntries: GivingPaid[];
}

/** Giving due from the year's logged sales and spending, minus `giving-paid` entries; income is listed separately. */
export function givingDue(state: LedgerState, settings: Settings, year: number): GivingDue {
  const summary = yearSummary(state, year);
  const paidEntries = state.givingPaid.filter((g) => g.year === year);
  // Decision 16: spending BTC realizes a gain just like a sale, so both count; network fees do not.
  const sells = summary.disposals.filter((d) => d.kind === 'sell' || d.kind === 'spend');
  const sales: GivingSale[] = [];
  if (settings.givingEnabled) {
    const percent = givingPercentBp(settings);
    const ctx = taxContext(state, settings, year, `${year}-12-31`);
    // Everything realized that year except the logged sales is the base; sales then stack in replay order.
    const sellSt = sum(sells.map((d) => d.stGainCents));
    const sellLt = sum(sells.map((d) => d.ltGainCents));
    let st = summary.stGainCents - sellSt;
    let lt = summary.ltGainCents - sellLt;
    for (const d of sells) {
      let estimatedTaxCents = 0;
      if (settings.givingMode === 'after-tax') {
        estimatedTaxCents = incrementalTax(taxInput({ ...ctx, ytdStCents: 0, ytdLtCents: 0 }, st, lt), taxInput({ ...ctx, ytdStCents: 0, ytdLtCents: 0 }, st + d.stGainCents, lt + d.ltGainCents)).total;
      }
      st += d.stGainCents;
      lt += d.ltGainCents;
      sales.push({ entryId: d.entryId, date: d.date, gainCents: d.gainCents, estimatedTaxCents, givingCents: givingOnSale({ percent, gains: d.gainCents, mode: settings.givingMode, estimatedTax: estimatedTaxCents }) });
    }
  }
  const dueCents = sum(sales.map((s) => s.givingCents));
  const paidCents = sum(paidEntries.map((g) => g.cents));
  return { year, enabled: settings.givingEnabled, name: settings.givingName, sales, dueCents, paidCents, owedCents: dueCents - paidCents, income: summary.income, incomeCents: summary.incomeCents, paidEntries };
}
