import { describe, expect, test } from 'vitest';
import { lowestTaxOrder, oldestFirst, oldestFirstOrder, picksAfterMove, picksFor, splitCost, splitMovePicks, termFor, validatePicks } from '../src/picks.ts';
import { replay } from '../src/replay.ts';
import type { Lot } from '../src/types.ts';
import { buy, noon, pick, receive, sats, testBook, wallet } from './helpers.ts';

const lot = (id: string, acquiredDate: string, s: number, cost: number, extra: Partial<Lot> = {}): Lot => ({
  id,
  wallet: 'ex',
  sats: s,
  costCents: cost,
  acquiredDate,
  acquiredAt: `${acquiredDate}T12:00:00Z`,
  tier: 'documented',
  proof: '',
  originEntryId: id,
  alwaysLongTerm: false,
  tz: 'America/Boise',
  lossBasis: null,
  ...extra,
});

describe('oldest first', () => {
  test('by acquired date, then acquired instant, then id; only open lots in the wallet', () => {
    const lots = [
      lot('c', '2024-01-01', 1, 1, { acquiredAt: '2024-01-01T12:00:00.500Z' }),
      lot('b', '2024-01-01', 1, 1, { acquiredAt: '2024-01-01T12:00:00Z' }),
      lot('a', '2024-01-01', 1, 1, { acquiredAt: '2024-01-01T12:00:00Z' }),
      lot('z', '2023-06-01', 1, 1),
      lot('other', '2020-01-01', 1, 1, { wallet: 'cold' }),
      lot('empty', '2019-01-01', 0, 0),
    ];
    expect(oldestFirstOrder(lots, 'ex').map((l) => l.id)).toEqual(['z', 'a', 'b', 'c']);
  });
  test('picks across lots; not enough is an error', () => {
    const lots = replay(testBook()).lots;
    expect(oldestFirst(lots, 'ex', sats('0.6'))).toEqual({ ok: true, value: [pick('L1', '0.5'), pick('L2', '0.1')] });
    expect(oldestFirst(lots, 'ex', sats('1.2'))).toEqual({ ok: true, value: [pick('L1', '0.5'), pick('L2', '0.4'), pick('L3', '0.2'), pick('L4', '0.1')] });
    expect(oldestFirst(lots, 'ex', sats('1.2') + 1)).toEqual({ ok: false, error: { code: 'insufficient-sats', message: 'short by 1 sats' } });
  });
  test('picksFor rejects bad amounts and skips empty lots', () => {
    expect(picksFor([lot('a', '2024-01-01', 0, 0), lot('b', '2024-01-01', 5, 5)], 3)).toEqual({ ok: true, value: [{ lotId: 'b', sats: 3 }] });
    expect(picksFor([], 0).ok).toBe(false);
    expect(picksFor([], 1.5).ok).toBe(false);
  });
});

describe('lowest tax this year', () => {
  const options = { priceCents: 7_500_000, stRate: 0.273, ltRate: 0.203, onDate: '2026-11-15' };
  test('documentation tiers come first, whatever the tax', () => {
    const lots = [
      lot('unknown-loss', '2025-01-01', 100, 1_000_000, { tier: 'unknown' }),
      lot('est', '2025-01-01', 100, 0, { tier: 'estimated' }),
      lot('recon', '2025-01-01', 100, 0, { tier: 'reconstructed' }),
      lot('doc-gain', '2020-01-01', 100, 0),
    ];
    expect(lowestTaxOrder(lots, 'ex', options).map((l) => l.id)).toEqual(['doc-gain', 'recon', 'est', 'unknown-loss']);
  });
  test('within a tier: estimated tax per sat, using the short or long rate', () => {
    // Same loss per sat; the short-term loss saves more tax at 27.3% than the long-term one at 20.3%.
    const lots = [lot('lt-loss', '2024-01-01', 100, 10_000), lot('st-loss', '2026-06-01', 100, 10_000), lot('small-gain', '2020-01-01', 100, 7_000), lot('big-gain', '2020-01-01', 100, 0)];
    expect(lowestTaxOrder(lots, 'ex', options).map((l) => l.id)).toEqual(['st-loss', 'lt-loss', 'small-gain', 'big-gain']);
  });
  test('ties keep oldest-first order; inherited lots use the long-term rate', () => {
    const lots = [lot('b', '2026-06-02', 100, 0, { alwaysLongTerm: true }), lot('a', '2026-06-01', 100, 0, { alwaysLongTerm: true })];
    expect(lowestTaxOrder(lots, 'ex', options).map((l) => l.id)).toEqual(['a', 'b']);
    const mixed = [lot('inh', '2026-06-01', 100, 0, { alwaysLongTerm: true }), lot('st', '2026-06-01', 100, 0)];
    expect(lowestTaxOrder(mixed, 'ex', options).map((l) => l.id)).toEqual(['inh', 'st']);
  });
});

describe('hand picks', () => {
  const lots = [lot('a', '2024-01-01', 10, 100), lot('b', '2024-01-02', 10, 100), lot('c', '2024-01-03', 10, 100, { wallet: 'cold' })];
  test('valid picks pass', () => {
    expect(validatePicks(lots, 'ex', [{ lotId: 'b', sats: 4 }, { lotId: 'a', sats: 10 }], 14)).toEqual({ ok: true, value: [{ lotId: 'b', sats: 4 }, { lotId: 'a', sats: 10 }] });
  });
  test.each([
    ['invalid-amount', [{ lotId: 'a', sats: 1 }], 0],
    ['invalid-amount', [{ lotId: 'a', sats: 0 }], 1],
    ['duplicate-pick', [{ lotId: 'a', sats: 1 }, { lotId: 'a', sats: 1 }], 2],
    ['unknown-lot', [{ lotId: 'x', sats: 1 }], 1],
    ['wrong-wallet', [{ lotId: 'c', sats: 1 }], 1],
    ['insufficient-sats', [{ lotId: 'a', sats: 11 }], 11],
    ['picks-sum-mismatch', [{ lotId: 'a', sats: 1 }], 2],
  ] as const)('%s', (code, picks, total) => {
    const r = validatePicks(lots, 'ex', picks, total);
    expect(r.ok ? null : r.error.code).toBe(code);
  });
});

describe('splits and moves', () => {
  test('splitCost: whole lot takes all remaining cost; otherwise half-up share', () => {
    expect(splitCost(3, 100, 3)).toBe(100);
    expect(splitCost(3, 100, 1)).toBe(33);
    expect(splitCost(2, 101, 1)).toBe(51);
  });
  test('move picks: moved sats first, then fee, pick by pick', () => {
    expect(splitMovePicks([{ lotId: 'a', sats: 5 }, { lotId: 'b', sats: 5 }, { lotId: 'c', sats: 2 }], 7)).toEqual({ moved: [5, 2, 0], fee: [0, 3, 2] });
  });
  test('picksAfterMove names the destination lots for a follow-up sale', () => {
    expect(picksAfterMove('M', [{ lotId: 'a', sats: 5 }, { lotId: 'b', sats: 5 }, { lotId: 'c', sats: 2 }], 7)).toEqual([
      { lotId: 'M:a', sats: 5 },
      { lotId: 'M:b', sats: 2 },
    ]);
  });
  test('prepare-sale flow: move chosen lots to the exchange, then sell exactly them', () => {
    const entries = [wallet('ex'), wallet('cold', 'self-custody'), buy('B', 'cold', '2024-01-01', '0.3', '9000'), receive('R', 'cold', '2024-02-01', '0.1', '4000', { type: 'income' })];
    const chosen = [pick('R', '0.05'), pick('B', '0.1')];
    const mv = { id: 'M', kind: 'move' as const, at: noon('2026-01-01'), tz: 'America/Boise', from: 'cold', to: 'ex', sats: sats('0.15'), feeSats: 0, feeValueCents: 0, picks: chosen };
    const state = replay([...entries, mv]);
    expect(validatePicks(state.lots, 'ex', picksAfterMove('M', chosen, sats('0.15')), sats('0.15')).ok).toBe(true);
  });
  test('termFor', () => {
    expect(termFor({ acquiredDate: '2025-01-15', alwaysLongTerm: false }, '2026-01-15')).toBe('short');
    expect(termFor({ acquiredDate: '2025-01-15', alwaysLongTerm: true }, '2025-01-16')).toBe('long');
  });
});
