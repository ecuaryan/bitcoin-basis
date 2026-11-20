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
      return line('⇩', 'Imported lot', `${w(e.wallet)} · ${e.origin}`, { summary: 'Imported coins', sats: e.sats, sign: '+', cents: e.costCents, centsLabel: 'cost' });
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
      return line('×', 'Deleted', e.reason, { summary: 'Removed an entry' });
  }
}
