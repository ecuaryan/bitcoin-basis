import { importEntriesJson, importOpeningLotsCsv, localDate, OPENING_LOT_COLUMNS, OPENING_LOT_FUNDED_BY_COLUMN, parseAprPercent, parseCsv, taxYear, toCsv, type CsvProblem, type Entry, type Loan, type LoanEntry, type LoanLinkEntry, type OpeningLotEntry, type Tier, type Wallet, type WalletEntry, type WalletType } from '@bitcoin-basis/engine';

/** The loans a `funded_by` cell may name: the book's, plus any the preview will create. */
export type LoanRef = Pick<Loan, 'id' | 'name' | 'closed'>;

export interface LotsPreview {
  entries: OpeningLotEntry[];
  /** One link per row with a `funded_by` loan (saved after the coins). */
  links: LoanLinkEntry[];
  warnings: CsvProblem[];
  problems: CsvProblem[];
  /** Rows that are fine when some rows are not (they can still be added on their own). */
  goodRows: number;
}

/**
 * Read an opening-lots CSV. When some rows have problems, `entries` holds nothing and `problems` lists each
 * row; `goodRows` says how many rows were fine so the caller can offer to add just those.
 */
export function previewLots(text: string, wallets: readonly Wallet[], tz: string, newId: () => string, loans: readonly LoanRef[] = []): LotsPreview {
  const r = importOpeningLotsCsv(text, { wallets, tz, newId, loans });
  if (r.ok) return { entries: r.value.entries, links: r.value.links, warnings: r.value.warnings, problems: [], goodRows: r.value.entries.length };
  const parsed = parseCsv(text);
  const rows = parsed.ok ? parsed.value.length - 1 : 0;
  const bad = new Set(r.error.map((p) => p.row));
  return { entries: [], links: [], warnings: [], problems: r.error, goodRows: bad.has(0) || bad.has(1) ? 0 : Math.max(0, rows - bad.size) };
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

/** A blank spreadsheet with the importer's exact columns and one made-up example row to copy. */
export function lotsTemplateCsv(walletName: string, tz: string): string {
  const example = [walletName, '2023-01-20 14:02:11', '0.01000000', '1000000', '230.00', '23000.00', 'Documented', 'Email receipt', tz];
  return toCsv([[...OPENING_LOT_COLUMNS, 'tz'], example]);
}

// ---------------------------------------------------------------------------------------------
// Wallets named in the file that do not exist yet
// ---------------------------------------------------------------------------------------------

const SELF_CUSTODY_WORDS = ['cold', 'multisig', 'vault', 'hardware', 'ledger', 'trezor', 'coldcard', 'self'];

/** A guess for a new wallet: names that sound like your own keys are Self-custody, anything else is an Exchange. */
export function guessWalletType(name: string): Exclude<WalletType, 'retirement'> {
  const n = name.toLowerCase();
  return SELF_CUSTODY_WORDS.some((w) => n.includes(w)) ? 'self-custody' : 'exchange';
}

/** A name for comparing: outer and repeated spaces gone, case ignored. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface NewWallet {
  /** Id the wallet will get; the coins already point at it. */
  id: string;
  name: string;
  coins: number;
  guessedType: Exclude<WalletType, 'retirement'>;
  /** The wallet entry's id, made now so it sorts before the coins. */
  entryId: string;
}

export interface WalletMatch {
  /** The name as written in the file. */
  from: string;
  /** The wallet you already have. */
  to: string;
}

export interface WalletPlan {
  created: { name: string; coins: number }[];
  /** File names that differ from an existing wallet only by case or spacing. */
  matched: WalletMatch[];
  /** The file with those names rewritten to the exact name, ready for the importer. */
  text: string;
}

/**
 * Sort the wallet names in a file into ones you have (exactly), ones you have but spelled a little
 * differently (matched, and reported), and ones that do not exist yet. Existing wallets win over new ones.
 */
export function planWallets(text: string, wallets: readonly Wallet[]): WalletPlan {
  const none: WalletPlan = { created: [], matched: [], text };
  const parsed = parseCsv(text);
  if (!parsed.ok) return none;
  const [header, ...rows] = parsed.value;
  const col = header?.findIndex((h) => h.trim().toLowerCase() === 'wallet') ?? -1;
  if (header === undefined || col < 0) return none;
  const exact = new Set(wallets.map((w) => w.name.trim()));
  const byKey = new Map<string, Wallet>();
  for (const w of wallets) if (!byKey.has(nameKey(w.name)) || byKey.get(nameKey(w.name))?.archived) byKey.set(nameKey(w.name), w);
  const created = new Map<string, { name: string; coins: number }>();
  const matched = new Map<string, WalletMatch>();
  const out = rows.map((cells) => {
    const raw = (cells[col] ?? '').trim();
    if (raw === '' || exact.has(raw)) return cells;
    const key = nameKey(raw);
    const have = byKey.get(key);
    if (have) {
      if (!matched.has(raw)) matched.set(raw, { from: raw, to: have.name.trim() });
      const next = [...cells];
      next[col] = have.name.trim();
      return next;
    }
    const first = created.get(key) ?? { name: raw.replace(/\s+/g, ' '), coins: 0 };
    first.coins += 1;
    created.set(key, first);
    const next = [...cells];
    next[col] = first.name;
    return next;
  });
  return { created: [...created.values()], matched: [...matched.values()], text: toCsv([header, ...out]) };
}

/** A loan named in the `funded_by` column that the book does not have yet: created with the coins (name and rate). */
export interface NewLoan {
  id: string;
  /** The loan entry's id, made now so it sorts before the coins. */
  entryId: string;
  name: string;
  coins: number;
  /** The earliest purchase it paid for (the loan's start). */
  opened: string;
}

/** Names in the `funded_by` column that match no loan in the book (case and outer spaces ignored), first spelling kept. */
export function newLoanNames(text: string, loans: readonly LoanRef[]): string[] {
  const parsed = parseCsv(text);
  if (!parsed.ok) return [];
  const [header, ...rows] = parsed.value;
  const find = (name: string): number => header?.findIndex((h) => h.trim().toLowerCase() === name) ?? -1;
  const col = find(OPENING_LOT_FUNDED_BY_COLUMN);
  const idCol = find('funded_by_id');
  if (col < 0) return [];
  const ids = new Set(loans.map((l) => l.id));
  // Matched the way the importer matches: outer spaces and case ignored.
  const key = (n: string): string => n.trim().toLowerCase();
  const have = new Set(loans.map((l) => key(l.name)));
  const out = new Map<string, string>();
  for (const cells of rows) {
    const raw = (cells[col] ?? '').trim();
    // A row naming a loan the book already has by its id is not a new loan, whatever its name says.
    if (idCol >= 0 && ids.has((cells[idCol] ?? '').trim())) continue;
    if (raw !== '' && !have.has(key(raw)) && !out.has(key(raw))) out.set(key(raw), raw);
  }
  return [...out.values()];
}

/** How many imported rows (lots) these links cover: each link's lot plus the rows of the same purchase. */
export function linkedRows(links: readonly LoanLinkEntry[]): number {
  return links.reduce((n, k) => n + 1 + (k.alsoLots?.length ?? 0), 0);
}

/** The loan entries for new loans, with the rate typed for each (by name). Null while a rate is missing or unreadable. */
export function loanEntries(loans: readonly NewLoan[], rates: Readonly<Record<string, string>>, at: string, tz: string): LoanEntry[] | null {
  const out: LoanEntry[] = [];
  for (const l of loans) {
    const apr = parseAprPercent((rates[l.name] ?? '').trim());
    if (apr === null) return null;
    out.push({ id: l.entryId, kind: 'loan', loan: l.id, name: l.name, opened: l.opened, aprMillionths: apr, at, tz });
  }
  return out;
}

export interface ImportPreview extends LotsPreview {
  newWallets: NewWallet[];
  /** Loans the file names that will be created (each needs its rate). */
  newLoans: NewLoan[];
  matched: WalletMatch[];
  sats: number;
  costCents: number;
  /** Sats by documentation tier (only tiers that appear). */
  tiers: Partial<Record<Tier, number>>;
  /** Years of the coins' dates that are already closed (imported coins are allowed there). */
  closedYears: number[];
  /** The text the importer actually read (names tidied). */
  text: string;
}

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'wallet';
}

/**
 * Read an opening-lots CSV where some wallets may not exist yet. New wallets are described in `newWallets`
 * (the coins already point at their ids) so the caller can add the wallets first, then the coins.
 */
export function previewImport(text: string, wallets: readonly Wallet[], tz: string, newId: () => string, closedYears: readonly number[], loans: readonly LoanRef[] = []): ImportPreview {
  const plan = planWallets(text, wallets);
  const newWallets: NewWallet[] = plan.created.map((c) => {
    const entryId = newId();
    return { id: `${slugOf(c.name)}-${entryId.slice(-6)}`, name: c.name, coins: c.coins, guessedType: guessWalletType(c.name), entryId };
  });
  const pretend: Wallet[] = newWallets.map((w) => ({ id: w.id, name: w.name, type: w.guessedType, defaultProof: '', archived: false, frozen: false, closeOutEntryId: null, recoveredCents: 0 }));
  const planned = newLoanNames(plan.text, loans).map((name) => ({ name, entryId: newId(), id: newId() }));
  const p = previewLots(plan.text, [...wallets, ...pretend], tz, newId, [...loans, ...planned.map((l) => ({ id: l.id, name: l.name, closed: false }))]);
  const lotDate = new Map(p.entries.map((e) => [e.id, localDate(e.acquiredAt, e.tz)]));
  const newLoans: NewLoan[] = planned.flatMap((l) => {
    const mine = p.links.filter((k) => k.loan === l.id);
    const dates = mine.map((k) => k.drawDate ?? lotDate.get(k.lot) ?? '').filter((d) => d !== '').sort();
    return dates.length === 0 ? [] : [{ ...l, coins: linkedRows(mine), opened: dates[0] as string }];
  });
  const tiers: Partial<Record<Tier, number>> = {};
  for (const e of p.entries) tiers[e.tier] = (tiers[e.tier] ?? 0) + e.sats;
  const years = new Set(p.entries.map((e) => taxYear(e.at, e.tz)).filter((y) => closedYears.includes(y)));
  return {
    ...p,
    newWallets,
    newLoans,
    matched: plan.matched,
    sats: p.entries.reduce((s, e) => s + e.sats, 0),
    costCents: p.entries.reduce((s, e) => s + e.costCents, 0),
    tiers,
    closedYears: [...years].sort((a, b) => a - b),
    text: plan.text,
  };
}

/** The wallet entries to add before the coins, with the types the person picked (by wallet name). */
export function walletEntries(wallets: readonly NewWallet[], types: Readonly<Record<string, WalletType>>, at: string, tz: string): WalletEntry[] {
  return wallets.map((w) => ({ id: w.entryId, kind: 'wallet', wallet: w.id, name: w.name, type: types[w.name] ?? w.guessedType, defaultProof: 'Email receipt', at, tz }));
}

/** Entries in chunks, so a big file is written a bit at a time and progress can show. */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
