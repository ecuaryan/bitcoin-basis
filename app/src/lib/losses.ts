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

/**
 * `year` has no losses saved for it while an earlier year has some: ask the person to update them (`savedFor` is the
 * latest such year). Older books without a per-year list fall back to the year saved with the plain fields.
 */
export function staleLosses(settings: Settings, year: number): { savedFor: number } | null {
  const byYear = settings.carryforwardByYear ?? {};
  if (Object.keys(byYear).length > 0) {
    if (byYear[String(year)] !== undefined) return null;
    const earlier = Object.entries(byYear)
      .filter(([y, v]) => Number(y) < year && v.st + v.lt > 0)
      .map(([y]) => Number(y))
      .sort((a, b) => b - a);
    return earlier[0] === undefined ? null : { savedFor: earlier[0] };
  }
  const savedFor = settings.carryforwardYear;
  if (savedFor === undefined || savedFor >= year || settings.carryforwardStCents + settings.carryforwardLtCents === 0) return null;
  return { savedFor };
}
