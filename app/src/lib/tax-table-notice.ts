import { federalTableFor } from '@bitcoin-basis/engine';

/** One quiet line when `year` has no federal table of its own and the nearest one is used; otherwise null. */
export function taxTableNotice(year: number): string | null {
  const { table, fellBack } = federalTableFor(year);
  return fellBack ? `Using ${table.year} tax rates; ${year} rates aren't in the app yet.` : null;
}
