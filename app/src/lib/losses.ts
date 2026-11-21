import { carryforwardFor, yearOf, type Settings } from '@bitcoin-basis/engine';

export const LOSSES_TITLE = 'Losses from past years';
export const LOSSES_HELP = "Unused losses from earlier tax returns (for example a frozen-platform loss). They cancel out future gains first, so those sales owe less tax. Copy them from last year's return: your CPA has them (Schedule D, capital loss carryover). The app can't see your returns.";
export const LOSSES_CHECK = 'Check against your filed return. Losses or gains outside Bitcoin (like stocks) change it.';

/** The losses from past years that count in `year` (saved ones apply to their own year; older ones to the current year). */
export function lossesForYear(settings: Settings, year: number, today: string): { st: number; lt: number } {
  return carryforwardFor(settings, year, yearOf(today));
}

/** Do losses from past years apply to `year` (and are there any)? */
export function hasLosses(settings: Settings, year: number, today: string): boolean {
  const l = lossesForYear(settings, year, today);
  return l.st + l.lt > 0;
}

/** Saved losses that are for an earlier year than `year`: ask the person to update them. */
export function staleLosses(settings: Settings, year: number): { savedFor: number } | null {
  const savedFor = settings.carryforwardYear;
  if (savedFor === undefined || savedFor >= year || settings.carryforwardStCents + settings.carryforwardLtCents === 0) return null;
  return { savedFor };
}
