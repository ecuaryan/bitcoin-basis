import type { FederalTable } from '../types.ts';
import { FEDERAL_2025 } from './federal-2025.ts';
import { FEDERAL_2026 } from './federal-2026.ts';
import { FEDERAL_2027 } from './federal-2027.ts';

/** Every published federal table, oldest first. */
export const FEDERAL_TABLES: readonly FederalTable[] = [FEDERAL_2025, FEDERAL_2026, FEDERAL_2027];

export interface TableLookup {
  readonly table: FederalTable;
  /** True when no table exists for the requested year and the latest one was used instead. */
  readonly fellBack: boolean;
}

/** The table for `year`, or the latest table (flagged) when that year has none. */
export function federalTableFor(year: number): TableLookup {
  const exact = FEDERAL_TABLES.find((t) => t.year === year);
  if (exact) return { table: exact, fellBack: false };
  return { table: FEDERAL_TABLES[FEDERAL_TABLES.length - 1] as FederalTable, fellBack: true };
}
