import { importEntriesJson, importOpeningLotsCsv, OPENING_LOT_COLUMNS, parseCsv, taxYear, toCsv, type CsvProblem, type Entry, type OpeningLotEntry, type Tier, type Wallet, type WalletEntry, type WalletType } from '@bitcoin-basis/engine';

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

export interface ImportPreview extends LotsPreview {
  newWallets: NewWallet[];
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
export function previewImport(text: string, wallets: readonly Wallet[], tz: string, newId: () => string, closedYears: readonly number[]): ImportPreview {
  const plan = planWallets(text, wallets);
  const newWallets: NewWallet[] = plan.created.map((c) => {
    const entryId = newId();
    return { id: `${slugOf(c.name)}-${entryId.slice(-6)}`, name: c.name, coins: c.coins, guessedType: guessWalletType(c.name), entryId };
  });
  const pretend: Wallet[] = newWallets.map((w) => ({ id: w.id, name: w.name, type: w.guessedType, defaultProof: '', archived: false, frozen: false, closeOutEntryId: null, recoveredCents: 0 }));
  const p = previewLots(plan.text, [...wallets, ...pretend], tz, newId);
  const tiers: Partial<Record<Tier, number>> = {};
  for (const e of p.entries) tiers[e.tier] = (tiers[e.tier] ?? 0) + e.sats;
  const years = new Set(p.entries.map((e) => taxYear(e.at, e.tz)).filter((y) => closedYears.includes(y)));
  return {
    ...p,
    newWallets,
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
