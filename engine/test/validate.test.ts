import { describe, expect, test } from 'vitest';
import type { Entry } from '../src/types.ts';
import { parseEntry } from '../src/validate.ts';
import { TZ } from './helpers.ts';

const base = { at: '2026-01-02T03:04:05Z', tz: TZ };
const picks = [{ lotId: 'L1', sats: 10 }];

/** One valid example of every kind. */
const VALID: Entry[] = [
  { ...base, id: 'a', kind: 'wallet', wallet: 'w', name: 'Coinbase', type: 'exchange', defaultProof: '' },
  { ...base, id: 'b', kind: 'wallet-update', wallet: 'w', name: 'CB', archived: true },
  { ...base, id: 'c', kind: 'wallet-freeze', wallet: 'w' },
  { ...base, id: 'd', kind: 'wallet-close-out', wallet: 'w', lossDate: '2026-01-01', reason: 'Plan effective' },
  { ...base, id: 'e', kind: 'opening-lot', wallet: 'w', acquiredAt: '2020-01-01T00:00:00Z', sats: 5, costCents: 0, tier: 'unknown', origin: 'Old spreadsheet' },
  { ...base, id: 'f', kind: 'buy', wallet: 'w', sats: 5, costCents: 100, tier: 'documented', note: 'n', proof: 'p' },
  { ...base, id: 'g', kind: 'receive', wallet: 'w', sats: 5, valueCents: 100, source: { type: 'income', description: 'Promo' }, tier: 'estimated' },
  { ...base, id: 'g2', kind: 'receive', wallet: 'w', sats: 5, valueCents: 100, source: { type: 'gift', giverCostCents: 50, giverAcquiredAt: '2020-01-01T00:00:00Z' } },
  { ...base, id: 'g3', kind: 'receive', wallet: 'w', sats: 5, valueCents: 100, source: { type: 'inherited' } },
  { ...base, id: 'g4', kind: 'receive', wallet: 'w', sats: 5, valueCents: 100, source: { type: 'frozen-payout', fromWallet: 'x' } },
  { ...base, id: 'h', kind: 'move', from: 'w', to: 'v', sats: 10, feeSats: 0, feeValueCents: 0, picks },
  { ...base, id: 'i', kind: 'sell', wallet: 'w', sats: 10, proceedsCents: 5, picks, spent: true, description: 'Coffee' },
  { ...base, id: 'j', kind: 'give', wallet: 'w', sats: 10, valueCents: 5, to: 'charity', recipient: 'Church', picks },
  { ...base, id: 'k', kind: 'lost', wallet: 'w', sats: 10, cause: 'scam', picks },
  { ...base, id: 'l', kind: 'balance-confirm', wallet: 'w', sats: 0 },
  { ...base, id: 'm', kind: 'retirement-snapshot', wallet: 'w', sats: 0 },
  {
    ...base,
    id: 'n',
    kind: 'settings',
    patch: {
      filingStatus: 'married-joint',
      wagesCents: 13_000_000,
      state: { kind: 'custom', rate: 530 },
      carryforwardStCents: 0,
      carryforwardLtCents: 1,
      givingEnabled: true,
      givingName: 'Tithe',
      givingPercentBp: 1000,
      givingMode: 'after-tax',
      earlierMoneyInCents: 5,
      timeZone: 'UTC',
    },
  },
  { ...base, id: 'n2', kind: 'settings', patch: { state: { kind: 'none' } } },
  { ...base, id: 'n3', kind: 'settings', patch: { state: { kind: 'flat', state: 'ID' } } },
  { ...base, id: 'o', kind: 'close-year', year: 2025 },
  { ...base, id: 'p', kind: 'unlock-year', year: 2025, reason: 'Amended return' },
  { ...base, id: 'q', kind: 'giving-paid', year: 2025, cents: 100 },
  { ...base, id: 'r', kind: 'delete', replaces: 'f', reason: 'duplicate' },
  { ...base, id: 's', kind: 'buy', wallet: 'w', sats: 5, costCents: 100, tier: 'documented', replaces: 'f', reason: 'fix' },
];

const byId = (id: string): Record<string, unknown> => ({ ...(VALID.find((e) => e.id === id) as Entry) });

describe('parseEntry', () => {
  test.each(VALID.map((e) => [e.id, e.kind, e] as const))('valid %s (%s)', (_id, _kind, e) => {
    expect(parseEntry(e)).toEqual({ ok: true, value: e });
  });

  test('not an object or unknown kind', () => {
    expect(parseEntry(null)).toEqual({ ok: false, error: 'entry must be an object' });
    expect(parseEntry([1])).toEqual({ ok: false, error: 'entry must be an object' });
    expect(parseEntry('x').ok).toBe(false);
    expect(parseEntry({ ...base, id: 'z', kind: 'mint' })).toEqual({ ok: false, error: 'unknown kind "mint"' });
    expect(parseEntry({ ...base, id: 'z' })).toEqual({ ok: false, error: 'unknown kind "undefined"' });
    expect(parseEntry({ ...base, id: 'z', kind: 'toString' }).ok).toBe(false);
  });

  const cases: [string, string, Record<string, unknown>][] = [
    ['unknown field', 'unknown field "costcents"', { ...byId('f'), costcents: 1 }],
    ['missing field', 'missing "tier"', { ...byId('f'), tier: undefined }],
    ['empty id', 'invalid "id"', { ...byId('f'), id: ' ' }],
    ['id with a colon (lot ids derive from ids)', 'invalid "id"', { ...byId('f'), id: 'M:0' }],
    ['id over 64 characters', 'invalid "id"', { ...byId('f'), id: 'x'.repeat(65) }],
    ['replaces with a colon', 'invalid "replaces"', { ...byId('s'), replaces: 'a:b' }],
    ['delete of a bad id', 'invalid "replaces"', { ...byId('r'), replaces: 'a b' }],
    ['more than 21M BTC', 'invalid "sats"', { ...byId('f'), sats: 2_100_000_000_000_001 }],
    ['cost over $1 trillion', 'invalid "costCents"', { ...byId('f'), costCents: 100_000_000_000_001 }],
    ['wages over $1 trillion', 'invalid "patch"', { ...byId('n'), patch: { wagesCents: 100_000_000_000_001 } }],
    ['pick of a malformed lot id', 'invalid "picks"', { ...byId('h'), picks: [{ lotId: 'M::1', sats: 1 }] }],
    ['pick lot id too long', 'invalid "picks"', { ...byId('h'), picks: [{ lotId: Array.from({ length: 70 }, () => 'x'.repeat(64)).join(':'), sats: 1 }] }],
    ['bad at', 'invalid "at"', { ...byId('f'), at: '2026-01-02' }],
    ['bad tz', 'invalid "tz"', { ...byId('f'), tz: 'Nowhere/City' }],
    ['tz not a string', 'invalid "tz"', { ...byId('f'), tz: 5 }],
    ['at not a string', 'invalid "at"', { ...byId('f'), at: 5 }],
    ['zero sats', 'invalid "sats"', { ...byId('f'), sats: 0 }],
    ['fractional sats', 'invalid "sats"', { ...byId('f'), sats: 1.5 }],
    ['negative cost', 'invalid "costCents"', { ...byId('f'), costCents: -1 }],
    ['string cost', 'invalid "costCents"', { ...byId('f'), costCents: '100' }],
    ['bad tier', 'invalid "tier"', { ...byId('f'), tier: 'gold' }],
    ['note not string', 'invalid "note"', { ...byId('f'), note: 1 }],
    ['bad wallet type', 'invalid "type"', { ...byId('a'), type: 'bank' }],
    ['archived not boolean', 'invalid "archived"', { ...byId('b'), archived: 'yes' }],
    ['bad loss date', 'invalid "lossDate"', { ...byId('d'), lossDate: '2026-02-30' }],
    ['loss date not string', 'invalid "lossDate"', { ...byId('d'), lossDate: 20260101 }],
    ['close-out without reason', 'missing "reason"', { ...byId('d'), reason: undefined }],
    ['bad source type', 'invalid "source"', { ...byId('g'), source: { type: 'airdrop' } }],
    ['source not object', 'invalid "source"', { ...byId('g'), source: 'income' }],
    ['source type not string', 'invalid "source"', { ...byId('g'), source: { type: 1 } }],
    ['source extra field', 'invalid "source"', { ...byId('g'), source: { type: 'inherited', x: 1 } }],
    ['gift cost negative', 'invalid "source"', { ...byId('g2'), source: { type: 'gift', giverCostCents: -5 } }],
    ['payout without wallet', 'invalid "source"', { ...byId('g4'), source: { type: 'frozen-payout' } }],
    ['empty picks', 'invalid "picks"', { ...byId('h'), picks: [] }],
    ['picks not array', 'invalid "picks"', { ...byId('h'), picks: {} }],
    ['pick with zero sats', 'invalid "picks"', { ...byId('h'), picks: [{ lotId: 'L1', sats: 0 }] }],
    ['pick with extra field', 'invalid "picks"', { ...byId('h'), picks: [{ lotId: 'L1', sats: 1, x: 1 }] }],
    ['pick not object', 'invalid "picks"', { ...byId('h'), picks: [5] }],
    ['spent missing', 'missing "spent"', { ...byId('i'), spent: undefined }],
    ['give to whom', 'invalid "to"', { ...byId('j'), to: 'dog' }],
    ['empty recipient', 'invalid "recipient"', { ...byId('j'), recipient: '' }],
    ['bad cause', 'invalid "cause"', { ...byId('k'), cause: 'oops' }],
    ['negative balance', 'invalid "sats"', { ...byId('l'), sats: -1 }],
    ['year too early', 'invalid "year"', { ...byId('o'), year: 1969 }],
    ['year too late', 'invalid "year"', { ...byId('o'), year: 10000 }],
    ['year fractional', 'invalid "year"', { ...byId('o'), year: 2025.5 }],
    ['unlock without reason', 'missing "reason"', { ...byId('p'), reason: undefined }],
    ['delete without target', 'missing "replaces"', { ...byId('r'), replaces: undefined }],
    ['patch not object', 'invalid "patch"', { ...byId('n'), patch: null }],
    ['patch unknown key', 'invalid "patch"', { ...byId('n'), patch: { wages: 1 } }],
    ['patch bad status', 'invalid "patch"', { ...byId('n'), patch: { filingStatus: 'joint' } }],
    ['patch bad rate', 'invalid "patch"', { ...byId('n'), patch: { state: { kind: 'custom', rate: 5.3 } } }],
    ['patch rate not number', 'invalid "patch"', { ...byId('n'), patch: { state: { kind: 'custom', rate: '0.05' } } }],
    ['patch negative rate', 'invalid "patch"', { ...byId('n'), patch: { state: { kind: 'custom', rate: -1 } } }],
    ['patch rate over 100%', 'invalid "patch"', { ...byId('n'), patch: { state: { kind: 'custom', rate: 10_001 } } }],
    ['patch unknown state code', 'invalid "patch"', { ...byId('n'), patch: { state: { kind: 'flat', state: 'ZZ' } } }],
    ['patch NaN rate', 'invalid "patch"', { ...byId('n'), patch: { state: { kind: 'custom', rate: Number.NaN } } }],
    ['patch percent over 100%', 'invalid "patch"', { ...byId('n'), patch: { givingPercentBp: 10_001 } }],
    ['patch percent negative', 'invalid "patch"', { ...byId('n'), patch: { givingPercentBp: -1 } }],
    ['patch percent not whole basis points', 'invalid "patch"', { ...byId('n'), patch: { givingPercentBp: 100.5 } }],
    ['patch percent not number', 'invalid "patch"', { ...byId('n'), patch: { givingPercentBp: '10' } }],
    ['patch bad state kind', 'invalid "patch"', { ...byId('n'), patch: { state: { kind: 'flat' } } }],
    ['patch bad zone', 'invalid "patch"', { ...byId('n'), patch: { timeZone: 'Nowhere' } }],
    ['edit without reason', 'an edit or delete needs a reason', { ...byId('s'), reason: undefined }],
    ['replaces itself', 'an entry cannot replace itself', { ...byId('s'), replaces: 's' }],
    ['close-year edits', 'closing or unlocking a year cannot be edited', { ...byId('o'), replaces: 'x', reason: 'r' }],
    ['unlock-year edits', 'closing or unlocking a year cannot be edited', { ...byId('p'), replaces: 'x' }],
    ['move to same wallet', 'a move needs two different wallets', { ...byId('h'), to: 'w' }],
    ['fee value without fee', 'fee value without fee sats', { ...byId('h'), feeValueCents: 5 }],
    ['gift acquired after receipt', "the giver's acquisition is after the gift", { ...byId('g2'), source: { type: 'gift', giverAcquiredAt: '2027-01-01T00:00:00Z' } }],
  ];
  test.each(cases)('%s', (_name, message, value) => {
    expect(parseEntry(value)).toEqual({ ok: false, error: message });
  });

  test('ids: letters, digits, _ and - up to 64; picks may name move pieces', () => {
    expect(parseEntry({ ...byId('f'), id: '0' }).ok).toBe(true);
    expect(parseEntry({ ...byId('f'), id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }).ok).toBe(true);
    expect(parseEntry({ ...byId('f'), id: 'x'.repeat(64) }).ok).toBe(true);
    expect(parseEntry({ ...byId('f'), sats: 2_100_000_000_000_000, costCents: 100_000_000_000_000 }).ok).toBe(true);
    expect(parseEntry({ ...byId('h'), picks: [{ lotId: 'M2:M_1:L-1', sats: 1 }] }).ok).toBe(true);
  });

  test('fee with value is fine; gift without dates is fine', () => {
    expect(parseEntry({ ...byId('h'), feeSats: 100, feeValueCents: 5 }).ok).toBe(true);
    expect(parseEntry({ ...byId('g2'), source: { type: 'gift' } }).ok).toBe(true);
    expect(parseEntry({ ...byId('g2'), source: { type: 'gift', giverAcquiredAt: base.at } }).ok).toBe(true);
  });
});
