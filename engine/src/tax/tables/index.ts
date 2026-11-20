import type { FederalTable } from '../types.ts';
import { FEDERAL_2025 } from './federal-2025.ts';
import { FEDERAL_2026 } from './federal-2026.ts';
import { FEDERAL_2027 } from './federal-2027.ts';

/** Every published federal table, oldest first. */
export const FEDERAL_TABLES: readonly FederalTable[] = [FEDERAL_2025, FEDERAL_2026, FEDERAL_2027];

export interface TableLookup {
  readonly table: FederalTable;
  /** True when no table exists for the requested year and the nearest one was used instead. */
  readonly fellBack: boolean;
}

/** The table for `year`; else the earliest table for years before it, or the latest for years after (flagged). */
export function federalTableFor(year: number): TableLookup {
  const exact = FEDERAL_TABLES.find((t) => t.year === year);
  if (exact) return { table: exact, fellBack: false };
  const earliest = FEDERAL_TABLES[0] as FederalTable;
  return { table: year < earliest.year ? earliest : (FEDERAL_TABLES[FEDERAL_TABLES.length - 1] as FederalTable), fellBack: true };
}
