/** Builders for synthetic test entries. All data here is made up. */
import { parseBtc, parseDollars } from '../src/format.ts';
import type {
  BuyEntry,
  Entry,
  GiveEntry,
  LostEntry,
  LotPick,
  MoveEntry,
  ReceiveEntry,
  ReceiveSource,
  SellEntry,
  Tier,
  WalletEntry,
  WalletType,
} from '../src/types.ts';

export const TZ = 'America/Boise';

/** BTC text to sats (test convenience). */
export function sats(btc: string): number {
  const s = parseBtc(btc);
  if (s === null) throw new Error(`bad btc ${btc}`);
  return s;
}

/** Dollar text to cents (test convenience). */
export function cents(dollars: string): number {
  const negative = dollars.startsWith('-');
  const c = parseDollars(negative ? dollars.slice(1) : dollars);
  if (c === null) throw new Error(`bad dollars ${dollars}`);
  return negative ? -c : c;
}

/** Noon in Boise (19:00 UTC) on a local date. */
export function noon(date: string): string {
  return `${date}T19:00:00Z`;
}

export function wallet(id: string, type: WalletType = 'exchange', name: string = id): WalletEntry {
  return { id: `w-${id}`, kind: 'wallet', at: '2015-01-01T00:00:00Z', tz: TZ, wallet: id, name, type, defaultProof: 'Email receipt' };
}

export function buy(id: string, walletId: string, date: string, btc: string, dollars: string, tier: Tier = 'documented'): BuyEntry {
  return { id, kind: 'buy', at: noon(date), tz: TZ, wallet: walletId, sats: sats(btc), costCents: cents(dollars), tier };
}

export function receive(id: string, walletId: string, date: string, btc: string, dollars: string, source: ReceiveSource): ReceiveEntry {
  return { id, kind: 'receive', at: noon(date), tz: TZ, wallet: walletId, sats: sats(btc), valueCents: cents(dollars), source };
}

export function sell(id: string, walletId: string, date: string, picks: readonly LotPick[], dollars: string, spent = false): SellEntry {
  const total = picks.reduce((s, p) => s + p.sats, 0);
  return { id, kind: 'sell', at: noon(date), tz: TZ, wallet: walletId, sats: total, proceedsCents: cents(dollars), picks, spent };
}

export function move(id: string, from: string, to: string, date: string, movedSats: number, feeSats: number, feeDollars: string, picks: readonly LotPick[]): MoveEntry {
  return { id, kind: 'move', at: noon(date), tz: TZ, from, to, sats: movedSats, feeSats, feeValueCents: cents(feeDollars), picks };
}

export function give(id: string, walletId: string, date: string, picks: readonly LotPick[], dollars: string, to: 'person' | 'charity', recipient: string): GiveEntry {
  const total = picks.reduce((s, p) => s + p.sats, 0);
  return { id, kind: 'give', at: noon(date), tz: TZ, wallet: walletId, sats: total, valueCents: cents(dollars), to, recipient, picks };
}

export function lost(id: string, walletId: string, date: string, picks: readonly LotPick[]): LostEntry {
  const total = picks.reduce((s, p) => s + p.sats, 0);
  return { id, kind: 'lost', at: noon(date), tz: TZ, wallet: walletId, sats: total, cause: 'lost-keys', picks };
}

export function pick(lotId: string, btc: string): LotPick {
  return { lotId, sats: sats(btc) };
}

/** The spec's test book: one exchange wallet, lots L1-L4. */
export function testBook(): Entry[] {
  return [
    wallet('ex'),
    buy('L1', 'ex', '2021-03-15', '0.5', '28000'),
    buy('L2', 'ex', '2023-01-20', '0.4', '9000'),
    buy('L3', 'ex', '2025-02-10', '0.2', '19500'),
    buy('L4', 'ex', '2025-12-20', '0.1', '8800'),
  ];
}

/** Returns a copy of `entry` with fields changed (for edits). */
export function edit<E extends Entry>(entry: E, changes: Partial<E> & { id: string; reason: string }): E {
  return { ...entry, ...changes, replaces: entry.id };
}

/** Error codes by entry id, for compact assertions. */
export function errorCodes(state: { errors: readonly { entryId: string; code: string }[] }): Record<string, string> {
  return Object.fromEntries(state.errors.map((e) => [e.entryId, e.code]));
}
