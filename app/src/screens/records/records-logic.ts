import { taxYear, type Cents, type Entry, type EntryKind, type Sats, type Wallet } from '@bitcoin-basis/engine';

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

export type KindGroup = 'bought' | 'received' | 'moved' | 'sold' | 'gave' | 'lost' | 'imported' | 'wallets' | 'checks' | 'settings' | 'years' | 'giving';
export const KIND_GROUPS: readonly { value: KindGroup; label: string }[] = [
  { value: 'bought', label: 'Bought' },
  { value: 'received', label: 'Received' },
  { value: 'moved', label: 'Moved' },
  { value: 'sold', label: 'Sold or spent' },
  { value: 'gave', label: 'Gave' },
  { value: 'lost', label: 'Lost' },
  { value: 'imported', label: 'Imported lots' },
  { value: 'wallets', label: 'Wallet changes' },
  { value: 'checks', label: 'Balance checks' },
  { value: 'settings', label: 'Settings' },
  { value: 'years', label: 'Year closings' },
  { value: 'giving', label: 'Giving paid' },
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
    case 'balance-confirm':
    case 'retirement-snapshot':
      return 'checks';
    case 'settings':
      return 'settings';
    case 'close-year':
    case 'unlock-year':
      return 'years';
    case 'giving-paid':
      return 'giving';
    default:
      return 'wallets';
  }
}

export interface EntryLine {
  glyph: string;
  title: string;
  /** Wallet and context, without the date. */
  detail: string;
  sats: Sats | null;
  /** `+` coins in, `−` coins out, empty when neither. */
  sign: '+' | '−' | '';
  cents: Cents | null;
}

const SOURCE_TITLE = { income: 'income', gift: 'gift', inherited: 'inherited', 'frozen-payout': 'payout from a frozen wallet' } as const;

export function describe(e: Entry, wallets: ReadonlyMap<string, Wallet>): EntryLine {
  const w = (id: string): string => wallets.get(id)?.name ?? 'Unknown wallet';
  const line = (glyph: string, title: string, detail: string, sats: Sats | null = null, sign: EntryLine['sign'] = '', cents: Cents | null = null): EntryLine => ({ glyph, title, detail, sats, sign, cents });
  switch (e.kind) {
    case 'buy':
      return line('+', 'Bought', w(e.wallet), e.sats, '+', e.costCents);
    case 'receive': {
      const extra = e.source.type === 'income' && e.source.description ? ` · ${e.source.description}` : '';
      return line('↓', `Received: ${SOURCE_TITLE[e.source.type]}`, `${w(e.wallet)}${extra}`, e.sats, '+', e.valueCents);
    }
    case 'move':
      return line('→', 'Moved', `${w(e.from)} to ${w(e.to)}`, e.sats, '', null);
    case 'sell':
      return line('↑', e.spent ? 'Spent' : 'Sold', `${w(e.wallet)}${e.description ? ` · ${e.description}` : ''}`, e.sats, '−', e.proceedsCents);
    case 'give':
      return line('♥', 'Gave', `${w(e.wallet)} · to ${e.recipient}`, e.sats, '−', e.valueCents);
    case 'lost':
      return line('!', 'Lost', `${w(e.wallet)} · ${e.cause.replace('-', ' ')}`, e.sats, '−');
    case 'opening-lot':
      return line('⇩', 'Imported lot', `${w(e.wallet)} · ${e.origin}`, e.sats, '+', e.costCents);
    case 'balance-confirm':
      return line('✓', 'Balance confirmed', w(e.wallet), e.sats);
    case 'retirement-snapshot':
      return line('✓', 'Retirement balance', w(e.wallet), e.sats);
    case 'wallet':
      return line('◇', 'Wallet added', `${e.name} · ${e.type === 'self-custody' ? 'self-custody' : e.type}`);
    case 'wallet-update':
      return line('◇', e.archived === true ? 'Wallet archived' : e.archived === false ? 'Wallet restored' : 'Wallet renamed', e.name ?? w(e.wallet));
    case 'wallet-freeze':
      return line('◇', 'Wallet frozen', w(e.wallet));
    case 'wallet-close-out':
      return line('◇', 'Frozen wallet closed out', w(e.wallet));
    case 'settings':
      return line('⚙', 'Settings changed', Object.keys(e.patch).map(settingLabel).join(', '));
    case 'close-year':
      return line('◼', `Year ${e.year} closed`, 'Filed');
    case 'unlock-year':
      return line('◻', `Year ${e.year} unlocked`, e.reason);
    case 'giving-paid':
      return line('♥', 'Giving paid', `For ${e.year}`, null, '', e.cents);
    case 'delete':
      return line('×', 'Deleted', e.reason);
  }
}

const SETTING_LABELS: Record<string, string> = {
  filingStatus: 'filing status',
  wagesCents: 'wages',
  state: 'state',
  carryforwardStCents: 'short-term carryforward',
  carryforwardLtCents: 'long-term carryforward',
  givingEnabled: 'giving on or off',
  givingName: 'giving name',
  givingPercentBp: 'giving percent',
  givingMode: 'giving before or after tax',
  earlierMoneyInCents: 'earlier money in',
  timeZone: 'time zone',
};
export const settingLabel = (key: string): string => SETTING_LABELS[key] ?? key;

export interface EntryFilter {
  text: string;
  wallet: string;
  group: KindGroup | '';
  year: string;
}

/** Wallet ids an entry touches. */
export function walletsOf(e: Entry): string[] {
  if (e.kind === 'move') return [e.from, e.to];
  if ('wallet' in e) return [e.wallet];
  return [];
}

export function matches(item: EntryItem, f: EntryFilter, wallets: ReadonlyMap<string, Wallet>): boolean {
  const e = item.current;
  if (f.group !== '' && kindGroup(e.kind) !== f.group) return false;
  if (f.wallet !== '' && !item.versions.some((v) => walletsOf(v).includes(f.wallet))) return false;
  if (f.year !== '' && String(taxYear(e.at, e.tz)) !== f.year) return false;
  const q = f.text.trim().toLowerCase();
  if (q === '') return true;
  const line = describe(e, wallets);
  const hay = [line.title, line.detail, e.note ?? '', e.proof ?? '', e.reason ?? '', e.id, ...walletsOf(e).map((id) => wallets.get(id)?.name ?? '')].join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/** Years that have entries, newest first. */
export function entryYears(items: readonly EntryItem[]): number[] {
  return [...new Set(items.map((i) => taxYear(i.current.at, i.current.tz)))].sort((a, b) => b - a);
}
