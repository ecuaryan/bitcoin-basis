import { DEFAULT_SETTINGS, RETIRED_SETTINGS, taxYear, type Entry, type EntryKind, type Wallet } from '@bitcoin-basis/engine';
import { describeEntry, describeSettingChange } from './describe-entry.ts';

/**
 * The one source for every list of entries (Records' recent and all entries, a wallet's entries): versions folded into
 * one item, settings changes and loan records hidden unless asked for, settings changes in a row collapsed (`×3`), balance confirmations never listed. Counts shown anywhere are the
 * number of rows the list shows.
 */

/** The reason saved when the same balance is confirmed again on a later day (an edit of the last check, not a user edit). */
export const RECHECK_REASON = 'Re-checked';
export const isRecheck = (e: Entry): boolean => e.kind === 'balance-confirm' && e.reason === RECHECK_REASON;

export interface EntryItem {
  /** Id of the first version. */
  id: string;
  /** Oldest to newest. */
  versions: Entry[];
  /** The newest version that is not a delete: what the entry says now. */
  current: Entry;
  deleted: boolean;
  /** Two versions replace the same one: none applies until it is resolved. */
  conflict: boolean;
}

/** Group entries into items with their histories (edits are new entries that `replaces` an older one). */
export function buildItems(entries: readonly Entry[]): EntryItem[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const kids = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.replaces === undefined || !byId.has(e.replaces)) continue;
    const list = kids.get(e.replaces);
    if (list) list.push(e);
    else kids.set(e.replaces, [e]);
  }
  const items: EntryItem[] = [];
  for (const root of entries) {
    if (root.replaces !== undefined && byId.has(root.replaces)) continue;
    const versions: Entry[] = [root];
    let conflict = false;
    const seen = new Set([root.id]);
    for (let at = root; ; ) {
      const next = (kids.get(at.id) ?? []).filter((k) => !seen.has(k.id));
      if (next.length === 0) break;
      if (next.length > 1) {
        conflict = true;
        versions.push(...next.sort((a, b) => (a.id < b.id ? -1 : 1)));
        break;
      }
      const n = next[0] as Entry;
      seen.add(n.id);
      versions.push(n);
      at = n;
    }
    const last = versions[versions.length - 1] as Entry;
    const deleted = !conflict && last.kind === 'delete';
    const current = [...versions].reverse().find((v) => v.kind !== 'delete') ?? root;
    items.push({ id: root.id, versions, current, deleted, conflict });
  }
  return items.sort((a, b) => (a.current.at === b.current.at ? (a.id < b.id ? 1 : -1) : a.current.at < b.current.at ? 1 : -1));
}

export type KindGroup = 'bought' | 'received' | 'moved' | 'sold' | 'gave' | 'lost' | 'imported' | 'retirement' | 'wallets' | 'checks' | 'settings' | 'years' | 'loans';
export const KIND_GROUPS: readonly { value: KindGroup; label: string }[] = [
  { value: 'bought', label: 'Bought' },
  { value: 'received', label: 'Received' },
  { value: 'moved', label: 'Moved' },
  { value: 'sold', label: 'Sold or spent' },
  { value: 'gave', label: 'Gave' },
  { value: 'lost', label: 'Lost' },
  { value: 'imported', label: 'Imported' },
  { value: 'retirement', label: 'Retirement purchases' },
  { value: 'wallets', label: 'Wallet changes' },
  { value: 'checks', label: 'Retirement balances' },
  { value: 'settings', label: 'Settings' },
  { value: 'years', label: 'Year closings' },
  { value: 'loans', label: 'Loan' },
];

export function kindGroup(kind: EntryKind): KindGroup {
  switch (kind) {
    case 'buy':
      return 'bought';
    case 'receive':
      return 'received';
    case 'move':
      return 'moved';
    case 'sell':
      return 'sold';
    case 'give':
      return 'gave';
    case 'lost':
      return 'lost';
    case 'opening-lot':
      return 'imported';
    case 'retirement-buy':
      return 'retirement';
    case 'balance-confirm':
    case 'retirement-snapshot':
      return 'checks';
    case 'settings':
      return 'settings';
    case 'close-year':
    case 'unlock-year':
      return 'years';
    case 'loan':
    case 'loan-update':
    case 'loan-draw':
    case 'loan-link':
    case 'loan-payment':
    case 'loan-statement':
      return 'loans';
    default:
      return 'wallets';
  }
}

export interface EntryFilter {
  text: string;
  wallet: string;
  group: KindGroup | '';
  year: string;
}

/** Wallet ids an entry touches (a payout from a frozen wallet touches both). */
export function walletsOf(e: Entry): string[] {
  if (e.kind === 'move') return [e.from, e.to];
  if (e.kind === 'receive' && e.source.type === 'frozen-payout') return [e.wallet, e.source.fromWallet];
  if ('wallet' in e) return [e.wallet];
  return [];
}

/** Changed by the person after it was first saved (a re-checked balance is not an edit). */
export function userEdited(item: EntryItem): boolean {
  return !item.deleted && !item.conflict && item.versions.slice(1).some((v) => v.kind !== 'delete' && !isRecheck(v));
}

export const NO_FILTER: EntryFilter = { text: '', wallet: '', group: '', year: '' };

/** The rows a list shows: `items` (all of them, newest first) filtered, then look-alike runs collapsed. */
export function entryRows(items: readonly EntryItem[], filter: EntryFilter, wallets: ReadonlyMap<string, Wallet>): EntryRun[] {
  return collapseRuns(
    items.filter((i) => matches(i, filter, wallets)),
    items,
  );
}

/** A settings change that touches only settings the app no longer has (giving, dollars put in before). */
function retiredOnly(e: Entry): boolean {
  if (e.kind !== 'settings') return false;
  const keys = Object.keys(e.patch);
  return keys.length > 0 && keys.every((k) => (RETIRED_SETTINGS as readonly string[]).includes(k));
}

export function matches(item: EntryItem, f: EntryFilter, wallets: ReadonlyMap<string, Wallet>): boolean {
  const e = item.current;
  // Balance confirmations are never listed: they show only as "Confirmed Nov 21" on the wallet. Records from features
  // the app no longer has (giving paid, and settings changes of only those features) are kept but never listed.
  if (e.kind === 'balance-confirm' || e.kind === 'giving-paid' || retiredOnly(e)) return false;
  // Settings changes and loan records are noise in the everyday list: they show under Kind = Settings or Loan
  // (a loan's own page lists its payments, and a purchase paid with a loan carries its badge).
  if (f.group === '' && (kindGroup(e.kind) === 'settings' || kindGroup(e.kind) === 'loans')) return false;
  if (f.group !== '' && kindGroup(e.kind) !== f.group) return false;
  if (f.wallet !== '' && !item.versions.some((v) => walletsOf(v).includes(f.wallet))) return false;
  if (f.year !== '' && String(taxYear(e.at, e.tz)) !== f.year) return false;
  const q = f.text.trim().toLowerCase();
  if (q === '') return true;
  const line = describeEntry(e, wallets);
  const hay = [line.title, line.detail, e.note ?? '', e.proof ?? '', e.reason ?? '', e.id, ...walletsOf(e).map((id) => wallets.get(id)?.name ?? '')].join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/** Years that have entries, newest first. */
export function entryYears(items: readonly EntryItem[]): number[] {
  return [...new Set(items.map((i) => taxYear(i.current.at, i.current.tz)))].sort((a, b) => b - a);
}

/** One row of the entries list: a run of look-alike entries shown as one. */
export interface EntryRun {
  item: EntryItem;
  count: number;
  /** Every item in the run, newest first. */
  items: EntryItem[];
  /** What the run changed in all, when it is a run of settings changes. */
  net: string | null;
}

/** Back-to-back settings changes become one row. `all` is every item, newest first. */
export function collapseRuns(list: readonly EntryItem[], all: readonly EntryItem[]): EntryRun[] {
  const keyOf = (i: EntryItem): string | null => {
    const e = i.current;
    if (i.deleted || i.conflict) return null;
    if (e.kind === 'settings') return 'settings';
    return null;
  };
  const runs: { items: EntryItem[]; key: string | null }[] = [];
  for (const item of list) {
    const key = keyOf(item);
    const last = runs.at(-1);
    if (key !== null && last !== undefined && last.key === key) last.items.push(item);
    else runs.push({ items: [item], key });
  }
  return runs.map(({ items, key }) => ({ item: items[0] as EntryItem, count: items.length, items, net: key === 'settings' && items.length > 1 ? netSettings(items, all) : null }));
}

function netSettings(run: readonly EntryItem[], all: readonly EntryItem[]): string {
  const patchOf = (i: EntryItem): Record<string, unknown> => (i.current.kind === 'settings' && !i.deleted ? (i.current.patch as Record<string, unknown>) : {});
  const oldest = run[run.length - 1] as EntryItem;
  const older = all.slice(all.findIndex((i) => i.id === oldest.id) + 1).reverse();
  const before: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const i of older) Object.assign(before, patchOf(i));
  const after = { ...before };
  for (const i of [...run].reverse()) Object.assign(after, patchOf(i));
  const changed = Object.keys(after).filter((k) => !(RETIRED_SETTINGS as readonly string[]).includes(k) && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  return changed.length === 0 ? 'No net change' : changed.map((k) => describeSettingChange(k, after[k])).join(' · ');
}

