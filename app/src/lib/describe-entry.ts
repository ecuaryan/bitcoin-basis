import type { Cents, Entry, Sats, Wallet } from '@bitcoin-basis/engine';

/** One entry in words, for history lists and review rows. Amounts stay numbers so screens can mask them. */
export interface EntryLine {
  glyph: string;
  /** Short kind, e.g. `Bought`. Wallet and context are in `detail`. */
  title: string;
  /** Wallet and context, without the date. */
  detail: string;
  /** Title and the wallets together on one line, e.g. `Moved Strike to River`. */
  summary: string;
  sats: Sats | null;
  /** `+` coins in, `−` coins out, empty when neither. */
  sign: '+' | '−' | '';
  cents: Cents | null;
  /** What the cents are: paid, worth, received. Empty when there are none. */
  centsLabel: string;
}

const SOURCE_TITLE = { income: 'income', gift: 'gift', inherited: 'inherited', 'frozen-payout': 'payout from a frozen wallet' } as const;

const SETTING_LABELS: Record<string, string> = {
  filingStatus: 'filing status',
  wagesCents: 'wages',
  state: 'state',
  carryforwardStCents: 'short-term losses from past years',
  carryforwardLtCents: 'long-term losses from past years',
  carryforwardYear: 'year of losses from past years',
  givingEnabled: 'giving on or off',
  givingName: 'giving name',
  givingPercentBp: 'giving percent',
  givingMode: 'giving before or after tax',
  earlierMoneyInCents: 'earlier money in',
  timeZone: 'time zone',
};
/** One changed setting in words, e.g. `Giving turned on`. */
export function describeSettingChange(key: string, value: unknown): string {
  switch (key) {
    case 'givingEnabled':
      return value === true ? 'Giving turned on' : 'Giving turned off';
    case 'givingMode':
      return value === 'before-tax' ? 'before tax' : 'after tax';
    case 'givingName':
      return `Giving called ${String(value)}`;
    case 'givingPercentBp':
      return `Giving ${Number(value) / 100}%`;
    case 'timeZone':
      return `Time zone ${String(value).replaceAll('_', ' ')}`;
    default: {
      const label = settingLabel(key);
      return `${label.charAt(0).toUpperCase()}${label.slice(1)} changed`;
    }
  }
}
export const settingLabel = (key: string): string => SETTING_LABELS[key] ?? key;

/** The one place that turns an entry into words. */
export function describeEntry(e: Entry, wallets: ReadonlyMap<string, Wallet>): EntryLine {
  const w = (id: string): string => wallets.get(id)?.name ?? 'Unknown wallet';
  const line = (glyph: string, title: string, detail: string, o: { summary?: string; sats?: Sats | null; sign?: EntryLine['sign']; cents?: Cents | null; centsLabel?: string } = {}): EntryLine => ({
    glyph,
    title,
    detail,
    summary: o.summary ?? title,
    sats: o.sats ?? null,
    sign: o.sign ?? '',
    cents: o.cents ?? null,
    centsLabel: o.centsLabel ?? '',
  });
  switch (e.kind) {
    case 'buy':
      return line('+', 'Bought', w(e.wallet), { sats: e.sats, sign: '+', cents: e.costCents, centsLabel: 'paid' });
    case 'receive': {
      const s = e.source;
      const extra = s.type === 'income' && s.description ? ` · ${s.description}` : '';
      const summary = s.type === 'income' ? 'Received income' : s.type === 'gift' ? 'Received a gift' : s.type === 'inherited' ? 'Inherited' : `Payout from ${w(s.fromWallet)}`;
      return line('↓', `Received: ${SOURCE_TITLE[s.type]}`, `${w(e.wallet)}${extra}`, { summary, sats: e.sats, sign: '+', cents: e.valueCents, centsLabel: 'worth' });
    }
    case 'move':
      return line('→', 'Moved', `${w(e.from)} to ${w(e.to)}`, { summary: `Moved ${w(e.from)} to ${w(e.to)}`, sats: e.sats });
    case 'sell':
      return line('↑', e.spent ? 'Spent' : 'Sold', `${w(e.wallet)}${e.description ? ` · ${e.description}` : ''}`, { sats: e.sats, sign: '−', cents: e.proceedsCents, centsLabel: e.spent ? 'worth' : 'received' });
    case 'give':
      return line('♥', 'Gave', `${w(e.wallet)} · to ${e.recipient}`, {
        summary: e.to === 'person' ? `Gave to ${e.recipient}` : `Gave to ${e.recipient} (charity)`,
        sats: e.sats,
        sign: '−',
        cents: e.valueCents,
        centsLabel: 'worth',
      });
    case 'lost':
      return line('!', 'Lost', `${w(e.wallet)} · ${e.cause.replace('-', ' ')}`, { summary: 'Lost or stolen', sats: e.sats, sign: '−' });
    case 'opening-lot':
      return line('⇩', 'Imported coins', `${w(e.wallet)} · ${e.origin}`, { summary: 'Imported coins', sats: e.sats, sign: '+', cents: e.costCents, centsLabel: 'cost' });
    case 'balance-confirm':
      return line('✓', 'Balance confirmed', w(e.wallet), { summary: 'Checked the balance', sats: e.sats });
    case 'retirement-snapshot':
      return line('✓', 'Retirement balance', w(e.wallet), { summary: 'Retirement balance noted', sats: e.sats });
    case 'wallet':
      return line('◇', 'Wallet added', `${e.name} · ${e.type === 'self-custody' ? 'self-custody' : e.type}`, { summary: `Added ${e.name}` });
    case 'wallet-update': {
      const title = e.archived === true ? 'Wallet archived' : e.archived === false ? 'Wallet restored' : 'Wallet renamed';
      return line('◇', title, e.name ?? w(e.wallet), { summary: e.archived === true ? 'Archived' : e.archived === false ? 'Brought back from the archive' : `Renamed to ${e.name ?? ''}` });
    }
    case 'wallet-freeze':
      return line('◇', 'Wallet frozen', w(e.wallet), { summary: 'Marked frozen' });
    case 'wallet-close-out':
      return line('◇', 'Frozen wallet closed out', w(e.wallet), { summary: 'Closed out' });
    case 'settings':
      return line('⚙', 'Settings changed', Object.keys(e.patch).map(settingLabel).join(', '));
    case 'close-year':
      return line('◼', `Year ${e.year} closed`, 'Filed');
    case 'unlock-year':
      return line('◻', `Year ${e.year} unlocked`, e.reason);
    case 'giving-paid':
      return line('♥', 'Giving paid', `For ${e.year}`, { cents: e.cents });
    case 'delete':
      return line('×', 'Removed', e.reason, { summary: 'Removed an entry' });
  }
}

/** What one entry is called in an action label: `Edit purchase`, `Remove this balance check`. */
export function entryNoun(e: Entry): string {
  switch (e.kind) {
    case 'buy':
      return 'purchase';
    case 'receive':
      return e.source.type === 'income' ? 'income' : e.source.type === 'gift' ? 'gift received' : e.source.type === 'inherited' ? 'inheritance' : 'payout';
    case 'move':
      return 'move';
    case 'sell':
      return e.spent ? 'spending' : 'sale';
    case 'give':
      return 'gift';
    case 'lost':
      return 'loss';
    case 'balance-confirm':
      return 'balance check';
    case 'retirement-snapshot':
      return 'balance note';
    default:
      return 'entry';
  }
}
