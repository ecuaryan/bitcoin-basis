import type { Cents } from '../money.ts';
import type { Settings } from '../types.ts';
import type { StateCode } from './tables/state.ts';
import type { StateChoice } from './tax.ts';

/** The tax module's state choice for the ledger's state setting (flat codes are validated on entry). */
export function stateChoiceFromSettings(settings: Pick<Settings, 'state'>): StateChoice {
  const s = settings.state;
  if (s.kind === 'none') return { customRate: 0 };
  if (s.kind === 'flat') return { code: s.state as StateCode };
  return { customRate: s.rate };
}

/**
 * The losses from past years that apply to `year`: the figure saved for that year in `carryforwardByYear` (none if that
 * year has none). Replay keeps every saved year there, so nothing else is read for replayed settings. Only settings
 * built by hand without any per-year figure use the single-year fields: they apply to `carryforwardYear`, else to
 * `fallbackYear` (the current year), else to any year.
 */
export function carryforwardFor(settings: Pick<Settings, 'carryforwardStCents' | 'carryforwardLtCents' | 'carryforwardYear'> & { readonly carryforwardByYear?: Settings['carryforwardByYear'] }, year: number, fallbackYear?: number): { st: Cents; lt: Cents } {
  const byYear = settings.carryforwardByYear ?? {};
  if (Object.keys(byYear).length > 0) {
    const saved = byYear[String(year)];
    return saved === undefined ? { st: 0, lt: 0 } : { st: saved.st, lt: saved.lt };
  }
  const forYear = settings.carryforwardYear ?? fallbackYear;
  if (forYear !== undefined && forYear !== year) return { st: 0, lt: 0 };
  return { st: settings.carryforwardStCents, lt: settings.carryforwardLtCents };
}
