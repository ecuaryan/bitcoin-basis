import { formatAprPercent, RETIRED_SETTINGS, type Cents, type Entry, type Sats, type Wallet } from '@bitcoin-basis/engine';
import { longDate } from './format.ts';

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
  /** The wallets it touches, by name, for a Wallet column: one, or from and to for a move. Empty for loan, settings and year records. */
  wallets: string[];
  /** Context without the wallet (`Design work`, `Hotel`, a loan's name). Empty when there is none. */
  note: string;
  /** A move's network fee (paid on top of `sats`, which is what arrived). Null for anything else. */
  feeSats: Sats | null;
}

const SOURCE_TITLE = { income: 'income', gift: 'gift', inherited: 'inherited', 'frozen-payout': 'payout from a frozen wallet' } as const;

const SETTING_LABELS: Record<string, string> = {
  filingStatus: 'filing status',
  wagesCents: 'wages',
  state: 'state',
  carryforwardStCents: 'short-term losses from past years',
  carryforwardLtCents: 'long-term losses from past years',
  carryforwardYear: 'year of losses from past years',
  timeZone: 'time zone',
};
/** One changed setting in words, e.g. `Time zone America/Boise`. */
export function describeSettingChange(key: string, value: unknown): string {
  switch (key) {
    case 'timeZone':
      return `Time zone ${String(value).replaceAll('_', ' ')}`;
    default: {
      const label = settingLabel(key);
      return `${label.charAt(0).toUpperCase()}${label.slice(1)} changed`;
    }
  }
}
export const settingLabel = (key: string): string => SETTING_LABELS[key] ?? key;

/** The one place that turns an entry into words. `loans` names loan records' loans (loan id to name). */
export function describeEntry(e: Entry, wallets: ReadonlyMap<string, Wallet>, loans: ReadonlyMap<string, string> = new Map()): EntryLine {
  const w = (id: string): string => wallets.get(id)?.name ?? 'Unknown wallet';
  const ln = (id: string): string => loans.get(id) ?? 'A loan';
  type Opts = { summary?: string; sats?: Sats | null; sign?: EntryLine['sign']; cents?: Cents | null; centsLabel?: string; wallets?: string[]; note?: string; feeSats?: Sats | null };
  const line = (glyph: string, title: string, detail: string, o: Opts = {}): EntryLine => ({
    glyph,
    title,
    detail,
    summary: o.summary ?? title,
    sats: o.sats ?? null,
    sign: o.sign ?? '',
    cents: o.cents ?? null,
    centsLabel: o.centsLabel ?? '',
    wallets: o.wallets ?? [],
    note: o.note ?? '',
    feeSats: o.feeSats ?? null,
  });
  switch (e.kind) {
    case 'buy':
      return line('+', 'Bought', w(e.wallet), { wallets: [w(e.wallet)], sats: e.sats, sign: '+', cents: e.costCents, centsLabel: 'paid' });
    case 'receive': {
      const s = e.source;
      const extra = s.type === 'income' && s.description ? ` · ${s.description}` : '';
      const summary = s.type === 'income' ? 'Received income' : s.type === 'gift' ? 'Received a gift' : s.type === 'inherited' ? 'Inherited' : `Payout from ${w(s.fromWallet)}`;
      return line('↓', `Received: ${SOURCE_TITLE[s.type]}`, `${w(e.wallet)}${extra}`, { summary, wallets: [w(e.wallet)], note: s.type === 'income' ? (s.description ?? '') : s.type === 'frozen-payout' ? `From ${w(s.fromWallet)}` : '', sats: e.sats, sign: '+', cents: e.valueCents, centsLabel: 'worth' });
    }
    case 'move':
      return line('→', 'Moved', `${w(e.from)} to ${w(e.to)}`, { summary: `Moved ${w(e.from)} to ${w(e.to)}`, wallets: [w(e.from), w(e.to)], sats: e.sats, feeSats: e.feeSats });
    case 'sell':
      return line('↑', e.spent ? 'Spent' : 'Sold', `${w(e.wallet)}${e.description ? ` · ${e.description}` : ''}`, { wallets: [w(e.wallet)], note: e.description ?? '', sats: e.sats, sign: '−', cents: e.proceedsCents, centsLabel: e.spent ? 'worth' : 'received' });
    case 'give': {
      // "Gave to Mom" reads as one thought; the wallet it left goes with the date ("Strike · Nov 21, 2026").
      const to = e.to === 'person' ? `Gave to ${e.recipient}` : `Gave to ${e.recipient} (charity)`;
      return line('♥', to, w(e.wallet), {
        summary: to,
        wallets: [w(e.wallet)],
        sats: e.sats,
        sign: '−',
        cents: e.valueCents,
        centsLabel: 'worth',
      });
    }
    case 'lost':
      return line('!', 'Lost', `${w(e.wallet)} · ${e.cause.replace('-', ' ')}`, { summary: 'Lost or stolen', wallets: [w(e.wallet)], note: e.cause.replace('-', ' '), sats: e.sats, sign: '−' });
    case 'opening-lot':
      return line('⇩', 'Imported lot', `${w(e.wallet)} · ${e.origin}`, { summary: 'Imported a lot', wallets: [w(e.wallet)], note: e.origin, sats: e.sats, sign: '+', cents: e.costCents, centsLabel: 'cost' });
    case 'balance-confirm':
      return line('✓', 'Balance confirmed', w(e.wallet), { summary: 'Checked the balance', wallets: [w(e.wallet)], sats: e.sats });
    case 'retirement-snapshot':
      return line('✓', 'Retirement balance', w(e.wallet), { summary: 'Retirement balance noted', wallets: [w(e.wallet)], sats: e.sats });
    case 'retirement-buy':
      return line('+', 'Bought (retirement)', w(e.wallet), { summary: 'Bought in a retirement wallet', wallets: [w(e.wallet)], sats: e.sats, sign: '+', cents: e.costCents, centsLabel: 'paid' });
    case 'wallet':
      return line('◇', 'Wallet added', `${e.name} · ${e.type === 'self-custody' ? 'self-custody' : e.type}`, { summary: `Added ${e.name}`, wallets: [e.name], note: e.type === 'self-custody' ? 'self-custody' : e.type });
    case 'wallet-update': {
      const title = e.archived === true ? 'Wallet archived' : e.archived === false ? 'Wallet restored' : 'Wallet renamed';
      const summary = e.archived === true ? 'Archived' : e.archived === false ? 'Brought back from the archive' : `Renamed to ${e.name ?? ''}`;
      return line('◇', title, e.name ?? w(e.wallet), { summary, wallets: [w(e.wallet)], note: e.archived === undefined && e.name !== undefined ? summary : '' });
    }
    case 'wallet-freeze':
      return line('◇', 'Wallet frozen', w(e.wallet), { summary: 'Marked frozen', wallets: [w(e.wallet)] });
    case 'wallet-close-out':
      return line('◇', 'Frozen wallet closed out', w(e.wallet), { summary: 'Closed out', wallets: [w(e.wallet)] });
    case 'settings': {
      const changed = Object.keys(e.patch).filter((k) => !(RETIRED_SETTINGS as readonly string[]).includes(k)).map(settingLabel).join(', ');
      return line('⚙', 'Settings changed', changed, { note: changed });
    }
    case 'close-year':
      return line('◼', `Year ${e.year} closed`, 'Filed', { note: 'Filed' });
    case 'unlock-year':
      return line('◻', `Year ${e.year} unlocked`, e.reason, { note: e.reason });
    case 'giving-paid': // an older version's record, never listed (see entry-list)
      return line('·', 'Older record', `For ${e.year}`, { summary: 'Older record, no longer used', note: `For ${e.year}` });
    // Loan records (tracking only: they never change coins, cost or taxes).
    case 'loan':
      return line('⌂', 'Loan added', `${e.name} · ${formatAprPercent(e.aprMillionths)}`, { summary: `Started tracking ${e.name}`, note: `${e.name} · ${formatAprPercent(e.aprMillionths)}` });
    case 'loan-update': {
      const title = e.closed === true ? 'Loan closed' : e.closed === false ? 'Loan reopened' : e.aprMillionths !== undefined ? 'Rate changed' : e.name !== undefined ? 'Loan renamed' : 'Loan settings changed';
      const detail = e.aprMillionths !== undefined ? `${ln(e.loan)} · ${formatAprPercent(e.aprMillionths)}${e.rateFrom ? ` from ${longDate(e.rateFrom)}` : ''}` : (e.name ?? ln(e.loan));
      return line('⌂', title, detail, { note: detail });
    }
    case 'loan-draw':
      return line('⌂', 'Money drawn', ln(e.loan), { note: ln(e.loan), cents: e.cents, centsLabel: 'drawn' });
    case 'loan-link':
      return line('⌂', 'Purchase linked', `Paid with ${ln(e.loan)}`, { summary: `Paid with ${ln(e.loan)}`, note: ln(e.loan) });
    case 'loan-payment':
      return line('⌂', 'Loan payment', ln(e.loan), { summary: `Paid ${ln(e.loan)}`, note: ln(e.loan), cents: e.interestCents + e.principalCents, centsLabel: 'paid' });
    case 'loan-statement':
      return line('⌂', 'Statement checked', ln(e.loan), { note: ln(e.loan), cents: e.balanceCents, centsLabel: 'owed' });
    case 'delete':
      return line('×', 'Removed', e.reason, { summary: 'Removed an entry', note: e.reason });
  }
}

/** What one entry is called in an action label: `Edit purchase`, `Remove this balance check`. */
export function entryNoun(e: Entry): string {
  switch (e.kind) {
    case 'buy':
    case 'retirement-buy':
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
    case 'loan':
      return 'loan';
    case 'loan-update':
      return 'loan change';
    case 'loan-draw':
      return 'draw';
    case 'loan-link':
      return 'link to the loan';
    case 'loan-payment':
      return 'payment';
    case 'loan-statement':
      return 'statement check';
    default:
      return 'entry';
  }
}
