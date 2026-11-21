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
 * The losses from past years that apply to `year`. They are saved for one year (`carryforwardYear`); any other year gets
 * none. Older settings have no year: they apply to `fallbackYear` (the current year), or to any year when none is given.
 */
export function carryforwardFor(settings: Pick<Settings, 'carryforwardStCents' | 'carryforwardLtCents' | 'carryforwardYear'>, year: number, fallbackYear?: number): { st: Cents; lt: Cents } {
  const forYear = settings.carryforwardYear ?? fallbackYear;
  if (forYear !== undefined && forYear !== year) return { st: 0, lt: 0 };
  return { st: settings.carryforwardStCents, lt: settings.carryforwardLtCents };
}
