/**
 * Decides which entries replay applies: validation, duplicate ids, closed years, and edit/delete
 * chains (`replaces`) including conflicts between two devices.
 *
 * Version model: entries that replace X are X's newer versions. With one newer version, the
 * newest version along the chain applies (a `delete` at the end removes the item). With two or
 * more, that is a conflict: none of them applies and X stays as it was, until all but one of
 * them is discarded by deleting it (a delete that replaces a version, not X itself).
 */
import { localDate, taxYear, yearOf } from './dates.ts';
import { compareStrings } from './order.ts';
import type { CloseYearEntry, Conflict, Entry, EntryId, EntryKind, LedgerError, UnlockYearEntry } from './types.ts';
import { parseEntry } from './validate.ts';

export interface Resolution {
  /** Entries to replay (any order). */
  applied: Entry[];
  /** For each applied entry, the root (first version) of its chain; lots created by it keep that id. */
  roots: Map<EntryId, EntryId>;
  conflicts: Conflict[];
  closedYears: number[];
  errors: LedgerError[];
}

/** Kinds that change lots or tax results; they cannot be added to or edited in a closed year. */
const TAX_KINDS: ReadonlySet<EntryKind> = new Set<EntryKind>(['buy', 'receive', 'move', 'sell', 'give', 'lost', 'wallet-close-out', 'wallet-freeze']);

/**
 * Years an entry touches for the closed-year rule. Opening lots arrive in closed years, so a new one is
 * exempt, but editing or deleting one (`asTarget`, or an opening lot that is itself an edit) is not.
 */
function lockedYears(e: Entry, asTarget: boolean): number[] {
  if (e.kind === 'opening-lot') return asTarget || e.replaces !== undefined ? [taxYear(e.at, e.tz), taxYear(e.acquiredAt, e.tz)] : [];
  if (!TAX_KINDS.has(e.kind)) return [];
  const years = [taxYear(e.at, e.tz)];
  if (e.kind === 'wallet-close-out' && e.lossDate !== undefined) years.push(yearOf(e.lossDate));
  return years;
}

/** Wallets an entry names (other than the wallet entry that creates one). */
function walletsUsed(e: Entry): string[] {
  switch (e.kind) {
    case 'wallet':
      return [];
    case 'move':
      return [e.from, e.to];
    case 'receive':
      return e.source.type === 'frozen-payout' ? [e.wallet, e.source.fromWallet] : [e.wallet];
    default:
      return 'wallet' in e ? [e.wallet] : [];
  }
}

/** Why `e` may not replace the wallet entry `target`, or null: the wallet id and type are fixed, and a wallet in use cannot be deleted. */
function walletEditProblem(e: Entry, target: Entry, used: ReadonlySet<string>): string | null {
  if (target.kind !== 'wallet') return null;
  if (e.kind === 'delete') return used.has(target.wallet) ? 'a wallet with activity cannot be deleted (archive it instead)' : null;
  if (e.kind !== 'wallet' || e.wallet !== target.wallet || e.type !== target.type) return "a wallet's id and type cannot change; create a new wallet instead";
  return null;
}

/** Stable JSON with sorted keys, to compare two copies of an entry. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const byId = (a: Entry, b: Entry): number => compareStrings(a.id, b.id);

function idOf(raw: unknown): string {
  return typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : '';
}

/** Validate and de-duplicate. Identical copies of one id are fine; different contents reject the id. */
function validEntries(raw: readonly unknown[], errors: LedgerError[]): Map<EntryId, Entry> {
  const entries = new Map<EntryId, Entry>();
  const duplicates = new Set<EntryId>();
  for (const item of raw) {
    const parsed = parseEntry(item);
    if (!parsed.ok) {
      errors.push({ entryId: idOf(item), code: 'invalid-entry', message: parsed.error });
      continue;
    }
    const e = parsed.value;
    const existing = entries.get(e.id);
    if (existing === undefined) entries.set(e.id, e);
    else if (canonicalJson(existing) !== canonicalJson(e)) duplicates.add(e.id);
  }
  for (const id of duplicates) {
    entries.delete(id);
    errors.push({ entryId: id, code: 'duplicate-id', message: 'two different entries share this id' });
  }
  return entries;
}

/** Year closing in creation (id) order: was `year` closed when entry `asOf` was created? */
function yearLocks(entries: Iterable<Entry>): { closedAt: (year: number, asOf: EntryId) => boolean; closedYears: number[] } {
  const events = [...entries].filter((e): e is CloseYearEntry | UnlockYearEntry => e.kind === 'close-year' || e.kind === 'unlock-year').sort(byId);
  const closedAt = (year: number, asOf: EntryId): boolean => {
    let closed = false;
    for (const ev of events) if (ev.year === year && ev.id < asOf) closed = ev.kind === 'close-year';
    return closed;
  };
  const years = [...new Set(events.map((e) => e.year))];
  return { closedAt, closedYears: years.filter((y) => closedAt(y, '￿')).sort((a, b) => a - b) };
}

/** Root (first version) of each entry's edit chain, following `replaces` (stops at a missing target or a cycle). */
function chainRoots(entries: ReadonlyMap<EntryId, Entry>): Map<EntryId, EntryId> {
  const roots = new Map<EntryId, EntryId>();
  for (const e of entries.values()) {
    const seen = new Set<EntryId>([e.id]);
    let cur = e;
    for (let up = entries.get(cur.replaces ?? ''); up !== undefined && !seen.has(up.id); up = entries.get(up.replaces ?? '')) {
      seen.add(up.id);
      cur = up;
    }
    roots.set(e.id, cur.id);
  }
  return roots;
}

/**
 * Years a new opening lot would change: those of its wallet's freezes and close-outs dated on or after
 * it (a close-out sweeps up the lots in the wallet). Edited opening lots are covered by `lockedYears`.
 */
function openingLotYears(e: Entry, entries: ReadonlyMap<EntryId, Entry>): number[] {
  if (e.kind !== 'opening-lot' || e.replaces !== undefined) return [];
  const date = localDate(e.at, e.tz);
  return [...entries.values()]
    .filter((f) => (f.kind === 'wallet-freeze' || f.kind === 'wallet-close-out') && f.wallet === e.wallet && localDate(f.at, f.tz) >= date)
    .flatMap((f) => lockedYears(f, true));
}

/**
 * Reject edits that are never allowed (of year closings; changing a wallet's id or type; deleting a wallet
 * in use), and entries dated in a closed year, or editing one, unless the year was unlocked first. An edit
 * is judged against every version of its chain (root included), since resolving a conflict or replacing a
 * delete can bring any of them back into replay.
 */
function rejectLockedChanges(entries: Map<EntryId, Entry>, closedAt: (year: number, asOf: EntryId) => boolean, errors: LedgerError[]): void {
  const used = new Set([...entries.values()].flatMap(walletsUsed));
  const roots = chainRoots(entries);
  const chain = (root: EntryId): Entry[] => [...entries.values()].filter((v) => roots.get(v.id) === root);
  for (const e of [...entries.values()].sort(byId)) {
    const target = e.replaces === undefined ? undefined : entries.get(e.replaces);
    const cannot = target === undefined ? null : target.kind === 'close-year' || target.kind === 'unlock-year' ? 'closing or unlocking a year cannot be edited' : walletEditProblem(e, target, used);
    if (cannot !== null) {
      entries.delete(e.id);
      errors.push({ entryId: e.id, code: 'cannot-replace', message: cannot });
      continue;
    }
    const versions = target === undefined ? [] : chain(roots.get(e.id) as EntryId).filter((v) => v.id !== e.id);
    const years = [...lockedYears(e, false), ...versions.flatMap((v) => lockedYears(v, true)), ...openingLotYears(e, entries)];
    const closed = years.find((y) => closedAt(y, e.id));
    if (closed !== undefined) {
      entries.delete(e.id);
      errors.push({ entryId: e.id, code: 'closed-year', message: `${closed} is closed; unlock it first` });
    }
  }
}

/** Drop edits whose target is missing (repeatedly, since dropping one can orphan another). */
function rejectOrphans(entries: Map<EntryId, Entry>, errors: LedgerError[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of [...entries.values()].sort(byId)) {
      if (e.replaces !== undefined && !entries.has(e.replaces)) {
        entries.delete(e.id);
        errors.push({ entryId: e.id, code: 'replaces-unknown', message: `replaces ${e.replaces}, which is not in the ledger` });
        changed = true;
      }
    }
  }
}

type Head = { readonly entry: Entry } | { readonly deletedBy: EntryId };

/**
 * Which entries replay applies, given every entry ever written (validated here).
 * Errors cover invalid entries, duplicate ids, closed years, missing targets and cycles.
 */
export function resolveVersions(raw: readonly unknown[]): Resolution {
  const errors: LedgerError[] = [];
  const entries = validEntries(raw, errors);
  const { closedAt, closedYears } = yearLocks(entries.values());
  rejectLockedChanges(entries, closedAt, errors);
  rejectOrphans(entries, errors);

  const children = new Map<EntryId, Entry[]>();
  for (const e of [...entries.values()].sort(byId)) {
    if (e.replaces === undefined) continue;
    const list = children.get(e.replaces);
    if (list === undefined) children.set(e.replaces, [e]);
    else list.push(e);
  }

  const conflicts: Conflict[] = [];
  const visited = new Set<EntryId>();
  const self = (v: Entry): Head => (v.kind === 'delete' ? { deletedBy: v.id } : { entry: v });
  const current = (v: Entry): Head => {
    visited.add(v.id);
    const kids = children.get(v.id) ?? [];
    if (kids.length === 0) return self(v);
    if (kids.length === 1) return current(kids[0] as Entry);
    // A branch is discarded when a later delete removed it (not when it is itself a delete of v).
    const live = kids.map((k) => ({ k, head: current(k) })).filter(({ k, head }) => !('deletedBy' in head && head.deletedBy !== k.id));
    if (live.length === 1) return (live[0] as { head: Head }).head;
    if (live.length > 1) conflicts.push({ targetId: v.id, versions: live.map(({ k, head }) => ('entry' in head ? head.entry : k)) });
    return self(v);
  };

  const applied: Entry[] = [];
  const roots = new Map<EntryId, EntryId>();
  for (const e of [...entries.values()].sort(byId)) {
    if (e.replaces !== undefined) continue;
    const head = current(e);
    if (!('entry' in head)) continue;
    applied.push(head.entry);
    roots.set(head.entry.id, e.id);
  }
  for (const e of [...entries.values()].sort(byId)) {
    if (!visited.has(e.id)) errors.push({ entryId: e.id, code: 'replace-cycle', message: 'its edits form a cycle' });
  }
  errors.sort((a, b) => compareStrings(a.entryId, b.entryId) || compareStrings(a.code, b.code));
  return { applied, roots, conflicts, closedYears, errors };
}
