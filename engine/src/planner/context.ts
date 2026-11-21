/** Shared tax context for planners: the settings plus the year's already-realized gains. */
import { yearSummary } from '../reports.ts';
import { carryforwardFor, stateChoiceFromSettings } from '../tax/settings.ts';
import type { Carryforward, StateChoice, TaxInput } from '../tax/tax.ts';
import type { Cents } from '../money.ts';
import type { FilingStatus, LedgerState, LocalDate, Settings } from '../types.ts';

export interface TaxContext {
  /** Tax year of the planned sale. */
  readonly year: number;
  /** Local date of the planned sale (decides each lot's holding period). */
  readonly onDate: LocalDate;
  readonly filingStatus: FilingStatus;
  readonly wagesCents: Cents;
  readonly state: StateChoice;
  /** Losses from past years that apply to this year. */
  readonly carryforward: Carryforward;
  /** Gains already realized that year (negative for a loss). */
  readonly ytdStCents: Cents;
  readonly ytdLtCents: Cents;
}

/** Tax context from the settings and the ledger's already-realized gains for `year`. */
export function taxContext(state: LedgerState, settings: Settings, year: number, onDate: LocalDate): TaxContext {
  const y = yearSummary(state, year);
  return {
    year,
    onDate,
    filingStatus: settings.filingStatus,
    wagesCents: settings.wagesCents,
    state: stateChoiceFromSettings(settings),
    carryforward: carryforwardFor(settings, year),
    ytdStCents: y.stGainCents,
    ytdLtCents: y.ltGainCents,
  };
}

/** The year's tax input with `st`/`lt` added on top of the already-realized gains. */
export function taxInput(ctx: TaxContext, addSt: Cents, addLt: Cents): TaxInput {
  return {
    year: ctx.year,
    filingStatus: ctx.filingStatus,
    wages: ctx.wagesCents,
    st: ctx.ytdStCents + addSt,
    lt: ctx.ytdLtCents + addLt,
    carryforward: ctx.carryforward,
    state: ctx.state,
  };
}
