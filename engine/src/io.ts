/**
 * Imports and exports: opening-lots CSV, full entries JSON, Form 8949-style CSV and the
 * income list CSV. Imports return typed problems instead of throwing.
 */
import { neutralizeFormula, parseCsv, restoreFormula, toCsv } from './csv.ts';
import { isValidInstant, isValidTimeZone } from './dates.ts';
import { formatBtc, formatCents, parseBtc, parseDollars } from './format.ts';
import { MAX_ENTRY_CENTS, MAX_ENTRY_SATS } from './money.ts';
import { compareLotsOldestFirst, compareStrings } from './order.ts';
import { averageCostPerBtc } from './reports.ts';
import { err, ok } from './result.ts';
import { TIERS, type Entry, type EntryId, type LedgerState, type LocalDate, type OpeningLotEntry, type Result, type Tier, type Wallet, type WalletId } from './types.ts';
import { parseEntry } from './validate.ts';

// ---------------------------------------------------------------------------------------------
// Opening-lots CSV
// ---------------------------------------------------------------------------------------------

/** Required columns. Export adds an optional trailing `tz` column (the lot's time zone). */
export const OPENING_LOT_COLUMNS = ['wallet', 'acquired_utc', 'btc', 'sats', 'cost_usd', 'cost_per_btc', 'tier', 'origin'] as const;
export const OPENING_LOT_TZ_COLUMN = 'tz';
type OpeningLotColumn = (typeof OPENING_LOT_COLUMNS)[number] | typeof OPENING_LOT_TZ_COLUMN;

/** Rows to CSV with every text column made safe for spreadsheets (numeric columns untouched). */
function exportCsv(columns: readonly string[], numeric: readonly string[], rows: readonly string[][]): string {
  const isNumeric = columns.map((c) => numeric.includes(c));
  return toCsv([[...columns], ...rows.map((r) => r.map((cell, i) => (isNumeric[i] ? cell : neutralizeFormula(cell))))]);
}

/** A problem with one CSV row (row 1 is the header). */
export interface CsvProblem {
  row: number;
  message: string;
}

export interface OpeningLotsImportOptions {
  /** Existing wallets; the CSV's `wallet` column matches a name (ignoring case and outer spaces). */
  readonly wallets: readonly Wallet[];
  /** Time zone for rows without a `tz` column value (decides each lot's acquired local date). */
  readonly tz: string;
  /** Id generator for new entries (e.g. `uuidv7`). */
  readonly newId: () => EntryId;
}

export interface OpeningLotsImport {
  entries: OpeningLotEntry[];
  /** Non-fatal notes, e.g. a `btc` value that disagrees with `sats` (sats win). */
  warnings: CsvProblem[];
}

const tierLabel = (t: Tier): string => t.charAt(0).toUpperCase() + t.slice(1);

function parseAcquired(text: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  return isValidInstant(iso) ? iso : null;
}

/** Wallets matching a CSV name (ignoring case and outer spaces), preferring non-archived ones. */
function walletsNamed(wallets: readonly Wallet[], name: string): Wallet[] {
  const key = name.trim().toLowerCase();
  const all = wallets.filter((w) => w.name.trim().toLowerCase() === key);
  const active = all.filter((w) => !w.archived);
  return active.length > 0 ? active : all;
}

/**
 * Parse an opening-lots CSV (`wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin`, optional `tz`)
 * into `opening-lot` entries. `sats` is authoritative; `btc` and `cost_per_btc` are checks only.
 * `cost_usd` is parsed to cents with string math. All row problems are returned together.
 */
export function importOpeningLotsCsv(text: string, options: OpeningLotsImportOptions): Result<OpeningLotsImport, CsvProblem[]> {
  const parsed = parseCsv(text);
  if (!parsed.ok) return err([{ row: 0, message: parsed.error }]);
  const [header, ...rows] = parsed.value;
  if (header === undefined) return err([{ row: 1, message: 'the file is empty' }]);
  const names = header.map((h) => h.trim().toLowerCase());
  const missing = OPENING_LOT_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length > 0) return err([{ row: 1, message: `missing columns: ${missing.join(', ')}` }]);

  const problems: CsvProblem[] = [];
  const warnings: CsvProblem[] = [];
  const entries: OpeningLotEntry[] = [];
  rows.forEach((cells, index) => {
    const row = index + 2;
    const cell = (c: OpeningLotColumn): string => restoreFormula(cells[names.indexOf(c)] ?? '').trim();
    const rowProblems: string[] = [];
    const matches = walletsNamed(options.wallets, cell('wallet'));
    if (matches.length !== 1) rowProblems.push(matches.length === 0 ? `no wallet named "${cell('wallet')}"` : `more than one wallet is named "${cell('wallet')}"`);
    const acquiredAt = parseAcquired(cell('acquired_utc'));
    if (acquiredAt === null) rowProblems.push(`acquired_utc "${cell('acquired_utc')}" is not a date like 2023-01-20 14:02:11`);
    const sats = /^\d+$/.test(cell('sats')) ? Number(cell('sats')) : NaN;
    if (!(sats > 0 && sats <= MAX_ENTRY_SATS)) rowProblems.push(`sats "${cell('sats')}" is not a whole number from 1 to 21,000,000 BTC`);
    const costCents = parseDollars(cell('cost_usd'));
    if (costCents === null || costCents > MAX_ENTRY_CENTS) rowProblems.push(`cost_usd "${cell('cost_usd')}" is not a dollar amount up to $1 trillion`);
    const tz = cell('tz') === '' ? options.tz : cell('tz');
    if (!isValidTimeZone(tz)) rowProblems.push(`tz "${tz}" is not a time zone like America/Boise`);
    const tier = TIERS.find((t) => t === cell('tier').toLowerCase());
    if (tier === undefined) rowProblems.push(`tier "${cell('tier')}" is not Documented, Reconstructed, Estimated or Unknown`);
    if (rowProblems.length > 0 || acquiredAt === null || costCents === null || tier === undefined) {
      problems.push(...rowProblems.map((message) => ({ row, message })));
      return;
    }
    const btc = cell('btc');
    if (btc !== '' && parseBtc(btc) !== sats) warnings.push({ row, message: `btc ${btc} disagrees with sats ${sats}; using sats` });
    entries.push({ id: options.newId(), kind: 'opening-lot', at: acquiredAt, tz, wallet: (matches[0] as Wallet).id, acquiredAt, sats, costCents, tier, origin: cell('origin') });
  });
  return problems.length > 0 ? err(problems) : ok({ entries, warnings });
}

export interface OpeningLotsExport {
  csv: string;
  /** Lots whose details the CSV cannot carry (inherited coins' always-long-term status, a gift's dual basis). */
  warnings: string[];
}

/** Export open lots (all wallets) as an opening-lots CSV, by wallet then oldest first. */
export function exportOpeningLotsCsv(state: LedgerState): OpeningLotsExport {
  const walletOrder = new Map(state.wallets.map((w, i) => [w.id, i]));
  const names = walletNames(state);
  const lots = [...state.lots].sort((a, b) => (walletOrder.get(a.wallet) as number) - (walletOrder.get(b.wallet) as number) || compareLotsOldestFirst(a, b));
  const rows = lots.map((l) => {
    const perBtc = averageCostPerBtc(l.costCents, l.sats);
    return [names(l.wallet), l.acquiredAt.replace('T', ' ').replace('Z', ''), formatBtc(l.sats), String(l.sats), formatCents(l.costCents), perBtc === null ? '' : formatCents(perBtc), tierLabel(l.tier), l.proof, l.tz];
  });
  const warnings = [
    ...lots.filter((l) => l.alwaysLongTerm).map((l) => `Lot ${l.id} is inherited (always long-term); the CSV cannot record that.`),
    ...lots.filter((l) => l.lossBasis !== null).map((l) => `Lot ${l.id} is a gift worth less than the giver's cost (dual basis); the CSV cannot record that.`),
  ];
  return { csv: exportCsv([...OPENING_LOT_COLUMNS, OPENING_LOT_TZ_COLUMN], ['btc', 'sats', 'cost_usd', 'cost_per_btc'], rows), warnings };
}

// ---------------------------------------------------------------------------------------------
// Entries JSON
// ---------------------------------------------------------------------------------------------

export const ENTRIES_FORMAT = 'bitcoin-basis-entries';
export const ENTRIES_FORMAT_VERSION = 1;

/** A problem with an entries file; `index` is the entry's position, or null for the whole file. */
export interface JsonImportProblem {
  index: number | null;
  message: string;
}

/** Every entry (all versions, deletes included) as JSON, sorted by id. Import reproduces every number. */
export function exportEntriesJson(entries: readonly Entry[]): string {
  const sorted = [...entries].sort((a, b) => compareStrings(a.id, b.id));
  return JSON.stringify({ format: ENTRIES_FORMAT, version: ENTRIES_FORMAT_VERSION, entries: sorted }, null, 2);
}

/** Parse an entries JSON file, validating every entry. */
export function importEntriesJson(text: string): Result<Entry[], JsonImportProblem[]> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err([{ index: null, message: 'not valid JSON' }]);
  }
  const file = data as { format?: unknown; version?: unknown; entries?: unknown } | null;
  if (typeof file !== 'object' || file === null || file.format !== ENTRIES_FORMAT || !Array.isArray(file.entries)) {
    return err([{ index: null, message: 'not a Bitcoin Basis entries file' }]);
  }
  if (file.version !== ENTRIES_FORMAT_VERSION) return err([{ index: null, message: `unsupported version ${String(file.version)}` }]);
  const entries: Entry[] = [];
  const problems: JsonImportProblem[] = [];
  file.entries.forEach((raw: unknown, index: number) => {
    const parsed = parseEntry(raw);
    if (parsed.ok) entries.push(parsed.value);
    else problems.push({ index, message: parsed.error });
  });
  return problems.length > 0 ? err(problems) : ok(entries);
}

// ---------------------------------------------------------------------------------------------
// Tax-year reports
// ---------------------------------------------------------------------------------------------

function walletNames(state: LedgerState): (id: WalletId) => string {
  const map = new Map(state.wallets.map((w) => [w.id, w.name]));
  return (id) => map.get(id) as string;
}

/** `YYYY-MM-DD` → `MM/DD/YYYY`, as on Form 8949. */
function formDate(date: LocalDate): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
}

export const FORM_8949_COLUMNS = ['term', 'description', 'date_acquired', 'date_sold', 'proceeds', 'cost', 'gain', 'kind', 'wallet', 'tier', 'entry_id'] as const;

const MONEY_COLUMNS = ['proceeds', 'cost', 'gain'];

/** Form 8949 column (b): "INHERITED" for inherited coins, else MM/DD/YYYY. */
function acquiredCell(p: { inherited: boolean; acquiredDate: LocalDate }): string {
  return p.inherited ? 'INHERITED' : formDate(p.acquiredDate);
}

/**
 * Form 8949-style rows for one tax year: one row per lot piece of every sale, spending and fee,
 * every close-out loss piece and each term of every post-close recovery. Short-term rows first, then by date.
 */
export function form8949Csv(state: LedgerState, year: number): string {
  const name = walletNames(state);
  type Row = { term: string; dateSold: LocalDate; entryId: EntryId; cells: string[] };
  const rows: Row[] = [];
  for (const d of state.disposals) {
    if (d.year !== year) continue;
    for (const p of d.picks) {
      rows.push({ term: p.term, dateSold: d.date, entryId: d.entryId, cells: [p.term, `${formatBtc(p.sats)} BTC`, acquiredCell(p), formDate(d.date), formatCents(p.proceedsCents), formatCents(p.costCents), formatCents(p.gainCents), d.kind, name(d.wallet), tierLabel(p.tier), d.entryId] });
    }
  }
  for (const c of state.closeOuts) {
    if (c.year !== year) continue;
    for (const p of c.pieces) {
      rows.push({ term: p.term, dateSold: c.lossDate, entryId: c.entryId, cells: [p.term, `${formatBtc(p.sats)} BTC (platform loss)`, acquiredCell(p), formDate(c.lossDate), formatCents(p.recoveredCents), formatCents(p.costCents), formatCents(p.gainCents), 'close-out', name(c.wallet), tierLabel(p.tier), c.entryId] });
    }
  }
  for (const r of state.recoveries) {
    if (r.year !== year) continue;
    for (const [term, gain] of [['short', r.stGainCents], ['long', r.ltGainCents]] as const) {
      if (gain === 0) continue;
      rows.push({ term, dateSold: r.date, entryId: r.entryId, cells: [term, `Recovery from ${name(r.fromWallet)}`, 'VARIOUS', formDate(r.date), formatCents(gain), formatCents(0), formatCents(gain), 'recovery', name(r.wallet), '', r.entryId] });
    }
  }
  const termRank = (t: string): number => (t === 'short' ? 0 : 1);
  rows.sort((a, b) => termRank(a.term) - termRank(b.term) || compareStrings(a.dateSold, b.dateSold) || compareStrings(a.entryId, b.entryId));
  return exportCsv(FORM_8949_COLUMNS, MONEY_COLUMNS, rows.map((r) => r.cells));
}

export const INCOME_COLUMNS = ['date', 'wallet', 'sats', 'btc', 'value_usd', 'description', 'entry_id'] as const;

/** Income received in one tax year (promos, rewards, mining), in date order. */
export function incomeCsv(state: LedgerState, year: number): string {
  const name = walletNames(state);
  const rows = state.income
    .filter((i) => i.year === year)
    .map((i) => [i.date, name(i.wallet), String(i.sats), formatBtc(i.sats), formatCents(i.valueCents), i.description ?? '', i.entryId]);
  return exportCsv(INCOME_COLUMNS, ['sats', 'btc', 'value_usd'], rows);
}
