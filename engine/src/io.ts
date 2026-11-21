/**
 * Imports and exports: opening-lots CSV, full entries JSON, Form 8949-style CSV and the
 * income list CSV. Imports return typed problems instead of throwing.
 */
import { neutralizeFormula, parseCsv, restoreFormula, toCsv } from './csv.ts';
import { isValidInstant, isValidLocalDate, isValidTimeZone } from './dates.ts';
import { formatBtc, formatCents, parseBtc, parseDollars } from './format.ts';
import { sum } from './book.ts';
import { MAX_ENTRY_CENTS, MAX_ENTRY_SATS, type Cents } from './money.ts';
import { compareLotsOldestFirst, compareStrings } from './order.ts';
import { splitByWeights } from './loans.ts';
import { averageCostPerBtc } from './reports.ts';
import { originLotId } from './trace.ts';
import { err, ok } from './result.ts';
import { TIERS, type Entry, type EntryId, type LedgerState, type LocalDate, type Loan, type LoanDraw, type LoanId, type LoanLinkEntry, type Lot, type LotId, type OpeningLotEntry, type Result, type RetirementBuyEntry, type Tier, type Wallet, type WalletId } from './types.ts';
import { parseEntry } from './validate.ts';

// ---------------------------------------------------------------------------------------------
// Opening-lots CSV
// ---------------------------------------------------------------------------------------------

/** Required columns. Export adds an optional trailing `tz` column (the lot's time zone). */
export const OPENING_LOT_COLUMNS = ['wallet', 'acquired_utc', 'btc', 'sats', 'cost_usd', 'cost_per_btc', 'tier', 'origin'] as const;
export const OPENING_LOT_TZ_COLUMN = 'tz';
/**
 * Optional loan columns (docs/loans-spec.md), exported only when some lot was paid with a loan: the loan's name and id,
 * this row's part of the purchase's draw and the draw date, and the purchase it came from (rows with the same
 * `origin_id` and loan re-import as one link with the whole draw).
 */
export const OPENING_LOT_LOAN_COLUMNS = ['funded_by', 'funded_by_id', 'funded_draw_usd', 'funded_draw_date', 'origin_id'] as const;
/** The loan-name column (the first of `OPENING_LOT_LOAN_COLUMNS`). */
export const OPENING_LOT_FUNDED_BY_COLUMN = 'funded_by';
type OpeningLotColumn = (typeof OPENING_LOT_COLUMNS)[number] | typeof OPENING_LOT_TZ_COLUMN | (typeof OPENING_LOT_LOAN_COLUMNS)[number];

/** Loan columns that a row for a retirement wallet must leave empty. */
const RETIREMENT_FORBIDDEN = ['funded_by', 'funded_by_id', 'funded_draw_usd', 'funded_draw_date'] as const;

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
  /**
   * Loans the loan columns may name: the ledger's, plus any created in the same import preview. `funded_by_id` wins
   * when it is one of these; otherwise `funded_by` is matched by name (ignoring case and outer spaces, preferring
   * open loans). An unknown name is a row error; loans are never created here.
   */
  readonly loans?: readonly Pick<Loan, 'id' | 'name' | 'closed'>[];
}

export interface OpeningLotsImport {
  entries: OpeningLotEntry[];
  /**
   * Rows naming a retirement wallet: recorded as retirement purchases (`origin` becomes the purchase's `proof`), never
   * as lots. Their tier must be empty and loan columns are not allowed on them.
   */
  retirementBuys: RetirementBuyEntry[];
  /** One `loan-link` per loan-funded purchase (rows sharing `origin_id` and loan form one); save them with the lots. */
  links: LoanLinkEntry[];
  /** Non-fatal notes, e.g. a `btc` value that disagrees with `sats` (sats win). */
  warnings: CsvProblem[];
}

const tierLabel = (t: Tier): string => t.charAt(0).toUpperCase() + t.slice(1);

function parseAcquired(text: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  return isValidInstant(iso) ? iso : null;
}

/** Loans matching a CSV name (ignoring case and outer spaces), preferring open ones. */
function loansNamed(loans: readonly Pick<Loan, 'id' | 'name' | 'closed'>[], name: string): Pick<Loan, 'id' | 'name' | 'closed'>[] {
  const key = name.trim().toLowerCase();
  const all = loans.filter((l) => l.name.trim().toLowerCase() === key);
  const open = all.filter((l) => !l.closed);
  return open.length > 0 ? open : all;
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
 * `cost_usd` is parsed to cents with string math. All row problems are returned together. A row whose wallet is a
 * retirement wallet becomes a `retirement-buy` instead (its tier must be empty; a tier or loan columns are a row problem). Wallets are
 * never created here.
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
  const retirementBuys: RetirementBuyEntry[] = [];
  const funded: Funded[] = [];
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
    const retirement = matches.length === 1 && (matches[0] as Wallet).type === 'retirement';
    // A retirement row must leave the tier empty, so a taxable lot can never slip out of the tax book by its wallet's name.
    if (retirement && cell('tier') !== '') rowProblems.push(`${cell('wallet')} is a retirement wallet; leave tier empty for retirement purchases`);
    const tier = retirement ? 'documented' : TIERS.find((t) => t === cell('tier').toLowerCase());
    if (tier === undefined) rowProblems.push(`tier "${cell('tier')}" is not Documented, Reconstructed, Estimated or Unknown`);
    if (retirement && RETIREMENT_FORBIDDEN.some((c) => cell(c) !== '')) rowProblems.push(`${cell('wallet')} is a retirement wallet; leave the funded_by columns empty`);
    const fundedBy = retirement ? '' : cell('funded_by');
    const byId = (options.loans ?? []).filter((l) => l.id === cell('funded_by_id'));
    const loans = fundedBy === '' ? [] : byId.length > 0 ? byId : loansNamed(options.loans ?? [], fundedBy);
    if (fundedBy !== '' && loans.length !== 1) rowProblems.push(loans.length === 0 ? `no loan named "${fundedBy}" (add the loan first)` : `more than one loan is named "${fundedBy}"`);
    const drawText = retirement ? '' : cell('funded_draw_usd');
    const drawCents = drawText === '' ? null : parseDollars(drawText);
    if (drawCents === null && drawText !== '') rowProblems.push(`funded_draw_usd "${drawText}" is not a dollar amount`);
    const drawDate = retirement || cell('funded_draw_date') === '' ? null : cell('funded_draw_date');
    if (drawDate !== null && !isValidLocalDate(drawDate)) rowProblems.push(`funded_draw_date "${drawDate}" is not a date like 2025-01-31`);
    if (rowProblems.length > 0 || acquiredAt === null || costCents === null || tier === undefined) {
      problems.push(...rowProblems.map((message) => ({ row, message })));
      return;
    }
    const btc = cell('btc');
    if (btc !== '' && parseBtc(btc) !== sats) warnings.push({ row, message: `btc ${btc} disagrees with sats ${sats}; using sats` });
    if (retirement) {
      retirementBuys.push({ id: options.newId(), kind: 'retirement-buy', at: acquiredAt, tz, wallet: (matches[0] as Wallet).id, sats, costCents, ...(cell('origin') === '' ? {} : { proof: cell('origin') }) });
      return;
    }
    const lot: OpeningLotEntry = { id: options.newId(), kind: 'opening-lot', at: acquiredAt, tz, wallet: (matches[0] as Wallet).id, acquiredAt, sats, costCents, tier, origin: cell('origin') };
    entries.push(lot);
    const loan = loans[0];
    if (loan !== undefined) funded.push({ key: JSON.stringify([loan.id, cell('origin_id') === '' ? lot.id : cell('origin_id')]), loan: loan.id, lot, drawCents, drawDate });
  });
  return problems.length > 0 ? err(problems) : ok({ entries, retirementBuys, links: linksFor(funded, options.newId), warnings });
}

/** A loan-funded row of an opening-lots import. */
interface Funded {
  /** Loan and purchase: rows with the same key are one purchase. */
  key: string;
  loan: LoanId;
  lot: OpeningLotEntry;
  drawCents: Cents | null;
  drawDate: LocalDate | null;
}

/** One link per purchase: its first lot, the rest as `alsoLots`, the rows' draws added up (if every row has one). */
function linksFor(funded: readonly Funded[], newId: () => EntryId): LoanLinkEntry[] {
  const groups = new Map<string, Funded[]>();
  for (const f of funded) groups.set(f.key, [...(groups.get(f.key) ?? []), f]);
  return [...groups.values()].map((g) => {
    const [first, ...rest] = g as [Funded, ...Funded[]];
    const draws = g.map((f) => f.drawCents);
    const drawDate = g.map((f) => f.drawDate).find((d): d is LocalDate => d !== null);
    return {
      id: newId(),
      kind: 'loan-link',
      at: first.lot.at,
      tz: first.lot.tz,
      loan: first.loan,
      lot: first.lot.id,
      ...(rest.length > 0 ? { alsoLots: rest.map((f) => f.lot.id) } : {}),
      ...(draws.every((c) => c !== null) ? { drawCents: sum(draws as Cents[]) } : {}),
      ...(drawDate === undefined ? {} : { drawDate }),
    };
  });
}

export interface OpeningLotsExport {
  csv: string;
  /** Lots whose details the CSV cannot carry (inherited coins' always-long-term status, a gift's dual basis). */
  warnings: string[];
}

/**
 * Export open lots (all wallets) as an opening-lots CSV, by wallet then oldest first, then the retirement purchases by
 * wallet (empty tier; re-importing them needs the retirement wallet added first, or the empty tier is a row problem).
 */
export function exportOpeningLotsCsv(state: LedgerState): OpeningLotsExport {
  const walletOrder = new Map(state.wallets.map((w, i) => [w.id, i]));
  const names = walletNames(state);
  const lots = [...state.lots].sort((a, b) => (walletOrder.get(a.wallet) as number) - (walletOrder.get(b.wallet) as number) || compareLotsOldestFirst(a, b));
  // Each loan-funded purchase's draw, split across the lots that still hold its coins by cost (by sats if all cost $0).
  const drawFor = new Map<LotId, { loan: Loan; draw: LoanDraw }>();
  for (const loan of state.loans) for (const draw of loan.draws) for (const id of draw.lotIds) drawFor.set(id, { loan, draw });
  const pieces = new Map<LoanDraw, Lot[]>();
  for (const l of lots) {
    const f = drawFor.get(originLotId(l.id));
    if (f !== undefined) pieces.set(f.draw, [...(pieces.get(f.draw) ?? []), l]);
  }
  const drawShare = new Map<LotId, Cents>();
  for (const [draw, held] of pieces) {
    const byCost = held.some((l) => l.costCents > 0);
    splitByWeights(draw.cents, held.map((l) => BigInt(byCost ? l.costCents : l.sats))).forEach((c, i) => drawShare.set((held[i] as Lot).id, c));
  }
  const funded = pieces.size > 0;
  const rows = lots.map((l) => {
    const perBtc = averageCostPerBtc(l.costCents, l.sats);
    const row = [names(l.wallet), l.acquiredAt.replace('T', ' ').replace('Z', ''), formatBtc(l.sats), String(l.sats), formatCents(l.costCents), perBtc === null ? '' : formatCents(perBtc), tierLabel(l.tier), l.proof, l.tz];
    if (!funded) return row;
    const f = drawFor.get(originLotId(l.id));
    return f === undefined ? [...row, '', '', '', '', ''] : [...row, f.loan.name, f.loan.id, formatCents(drawShare.get(l.id) as Cents), f.draw.date, f.draw.lotId as LotId];
  });
  // Retirement purchases after the lots, under their wallet's name: no tier (import does not use one), no loan columns.
  const retirementRows = [...state.retirementBuys]
    .sort((a, b) => (walletOrder.get(a.wallet) as number) - (walletOrder.get(b.wallet) as number))
    .map((b) => {
      const perBtc = averageCostPerBtc(b.costCents, b.sats);
      const row = [names(b.wallet), b.at.replace('T', ' ').replace('Z', ''), formatBtc(b.sats), String(b.sats), formatCents(b.costCents), perBtc === null ? '' : formatCents(perBtc), '', b.proof, b.tz];
      return funded ? [...row, '', '', '', '', ''] : row;
    });
  const goneDraws = state.loans.flatMap((loan) => loan.draws.filter((d) => d.lotId !== null && !pieces.has(d)).map((d) => ({ loan, d })));
  const warnings = [
    ...goneDraws.map(({ loan, d }) => `Purchase ${d.lotId as LotId} was paid with ${loan.name}, but none of its coins are left, so the CSV cannot carry its $${formatCents(d.cents)} draw. Use the entries JSON.`),
    ...lots.filter((l) => l.alwaysLongTerm).map((l) => `Lot ${l.id} is inherited (always long-term); the CSV cannot record that.`),
    ...lots.filter((l) => l.lossBasis !== null).map((l) => `Lot ${l.id} is a gift worth less than the giver's cost (dual basis); the CSV cannot record that.`),
  ];
  const columns = [...OPENING_LOT_COLUMNS, OPENING_LOT_TZ_COLUMN, ...(funded ? OPENING_LOT_LOAN_COLUMNS : [])];
  return { csv: exportCsv(columns, ['btc', 'sats', 'cost_usd', 'cost_per_btc'], [...rows, ...retirementRows]), warnings };
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
