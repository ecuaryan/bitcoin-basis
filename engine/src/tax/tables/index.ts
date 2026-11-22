import type { FederalTable } from '../types.ts';
import { FEDERAL_2025 } from './federal-2025.ts';
import { FEDERAL_2026 } from './federal-2026.ts';
import { FEDERAL_2027 } from './federal-2027.ts';
import { earlierGiftExclusion } from './gift-exclusion.ts';

/** Every published federal table, oldest first. */
export const FEDERAL_TABLES: readonly FederalTable[] = [FEDERAL_2025, FEDERAL_2026, FEDERAL_2027];

export interface TableLookup {
  readonly table: FederalTable;
  /** True when no table exists for the requested year and the nearest one was used instead. */
  readonly fellBack: boolean;
}

/**
 * The table for `year`; else the earliest table for years before it, or the latest for years after (flagged).
 * A year before the earliest table keeps its own gift annual exclusion (published for every year), so a
 * 2024 gift is judged against $18,000, not 2025's $19,000.
 */
export function federalTableFor(year: number): TableLookup {
  const exact = FEDERAL_TABLES.find((t) => t.year === year);
  if (exact) return { table: exact, fellBack: false };
  const earliest = FEDERAL_TABLES[0] as FederalTable;
  if (year < earliest.year) return { table: { ...earliest, giftAnnualExclusion: earlierGiftExclusion(year) }, fellBack: true };
  return { table: FEDERAL_TABLES[FEDERAL_TABLES.length - 1] as FederalTable, fellBack: true };
}

/** The gift tax annual exclusion per recipient for `year`, in cents. */
export function giftAnnualExclusionFor(year: number): number {
  return federalTableFor(year).table.giftAnnualExclusion;
}
