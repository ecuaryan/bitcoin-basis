import { importEntriesJson, importOpeningLotsCsv, parseCsv, toCsv, type CsvProblem, type Entry, type OpeningLotEntry, type Wallet } from '@bitcoin-basis/engine';

export interface LotsPreview {
  entries: OpeningLotEntry[];
  warnings: CsvProblem[];
  problems: CsvProblem[];
  /** Rows that are fine when some rows are not (they can still be added on their own). */
  goodRows: number;
}

/**
 * Read an opening-lots CSV. When some rows have problems, `entries` holds nothing and `problems` lists each
 * row; `goodRows` says how many rows were fine so the caller can offer to add just those.
 */
export function previewLots(text: string, wallets: readonly Wallet[], tz: string, newId: () => string): LotsPreview {
  const r = importOpeningLotsCsv(text, { wallets, tz, newId });
  if (r.ok) return { entries: r.value.entries, warnings: r.value.warnings, problems: [], goodRows: r.value.entries.length };
  const parsed = parseCsv(text);
  const rows = parsed.ok ? parsed.value.length - 1 : 0;
  const bad = new Set(r.error.map((p) => p.row));
  return { entries: [], warnings: [], problems: r.error, goodRows: bad.has(0) || bad.has(1) ? 0 : Math.max(0, rows - bad.size) };
}

/** The same file without the rows that had problems, so the good rows can be imported on their own. */
export function withoutBadRows(text: string, problems: readonly CsvProblem[]): string {
  const parsed = parseCsv(text);
  if (!parsed.ok) return text;
  const bad = new Set(problems.map((p) => p.row));
  const [header, ...rows] = parsed.value;
  return toCsv([header ?? [], ...rows.filter((_, i) => !bad.has(i + 2))]);
}

export interface JsonPreview {
  entries: Entry[];
  fresh: Entry[];
  problems: { index: number | null; message: string }[];
}

/** Read an entries JSON file and split it into entries already in the book and new ones. */
export function previewJson(text: string, have: ReadonlySet<string>): JsonPreview {
  const r = importEntriesJson(text);
  if (!r.ok) return { entries: [], fresh: [], problems: r.error };
  return { entries: r.value, fresh: r.value.filter((e) => !have.has(e.id)), problems: [] };
}
