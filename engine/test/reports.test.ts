import { describe, expect, test } from 'vitest';
import { averageCostPerBtc, giftsOverExclusion, giftTotalsByRecipient, holdings, yearSummary } from '../src/reports.ts';
import { replay } from '../src/replay.ts';
import { canSellFrom } from '../src/sell-guard.ts';
import type { Entry, Wallet } from '../src/types.ts';
import { buy, cents, give, lost, move, noon, pick, receive, sats, sell, testBook, TZ, wallet } from './helpers.ts';

describe('holdings', () => {
  test('per wallet, totals excluding frozen and retirement, documentation mix, money put in', () => {
    const state = replay([
      wallet('ex'),
      wallet('lend'),
      wallet('ira', 'retirement'),
      wallet('ira2', 'retirement'),
      buy('B1', 'ex', '2024-01-01', '0.3', '9000', 'documented'),
      buy('B2', 'ex', '2024-02-01', '0.1', '1000', 'estimated'),
      receive('R', 'ex', '2024-03-01', '0.1', '100', { type: 'gift' }),
      buy('B3', 'lend', '2024-01-01', '1', '40000'),
      { id: 'F', kind: 'wallet-freeze', at: noon('2024-06-01'), tz: TZ, wallet: 'lend' },
      { id: 'S1', kind: 'retirement-snapshot', at: noon('2024-06-01'), tz: TZ, wallet: 'ira', sats: 5 },
      { id: 'S2', kind: 'retirement-snapshot', at: noon('2024-07-01'), tz: TZ, wallet: 'ira', sats: 7 },
      { id: 'set', kind: 'settings', at: noon('2024-01-01'), tz: TZ, patch: { earlierMoneyInCents: cents('500') } },
    ]);
    const h = holdings(state);
    expect(h.wallets.map((w) => [w.wallet, w.sats, w.costCents, w.frozen])).toEqual([
      ['ex', sats('0.5'), cents('10000'), false],
      ['lend', sats('1'), cents('40000'), true],
    ]);
    expect(h.wallets[0]?.averageCostCentsPerBtc).toBe(cents('20000'));
    expect(h.totalSats).toBe(sats('0.5'));
    expect(h.totalCostCents).toBe(cents('10000'));
    expect(h.documentationMix).toEqual({ documented: sats('0.3'), reconstructed: 0, estimated: sats('0.1'), unknown: sats('0.1') });
    expect(h.moneyPutInCents).toBe(cents('50500'));
    expect(h.retirement).toEqual([
      { wallet: 'ira', name: 'ira', archived: false, sats: 7, balanceFrom: 'snapshot', purchaseCount: 0, purchaseSats: 0, costCents: 0, averageCostCentsPerBtc: null, snapshot: { entryId: 'S2', date: '2024-07-01', sats: 7, purchasedSats: 0, differenceSats: 7, matches: false } },
      { wallet: 'ira2', name: 'ira2', archived: false, sats: 0, balanceFrom: 'none', purchaseCount: 0, purchaseSats: 0, costCents: 0, averageCostCentsPerBtc: null, snapshot: null },
    ]);
  });
  test('average cost is null when nothing is held', () => {
    expect(averageCostPerBtc(0, 0)).toBeNull();
    expect(holdings(replay([wallet('ex')])).averageCostCentsPerBtc).toBeNull();
    expect(averageCostPerBtc(cents('65300'), sats('1.2'))).toBe(cents('54416.67'));
  });
});

describe('year summary', () => {
  const entries: Entry[] = [
    ...testBook(),
    wallet('cold'),
    wallet('lend'),
    buy('LB', 'lend', '2021-01-01', '1', '40000'),
    { id: 'F', kind: 'wallet-freeze', at: noon('2022-01-01'), tz: TZ, wallet: 'lend' },
    { id: 'X', kind: 'wallet-close-out', at: noon('2026-01-10'), tz: TZ, wallet: 'lend', reason: 'Plan' },
    receive('P', 'ex', '2026-02-01', '0.01', '500', { type: 'frozen-payout', fromWallet: 'lend' }),
    sell('S', 'ex', '2026-11-15', [pick('L3', '0.2'), pick('L4', '0.05')], '18750'),
    move('M', 'ex', 'cold', '2026-11-16', sats('0.1'), 1000, '0.75', [{ lotId: 'L1', sats: sats('0.1') + 1000 }]),
    receive('I', 'ex', '2026-03-01', '0.001', '60', { type: 'income' }),
    give('G', 'ex', '2026-04-01', [pick('L2', '0.01')], '700', 'person', 'Sam'),
    give('C', 'ex', '2026-04-02', [pick('L2', '0.01')], '700', 'charity', 'Church'),
    lost('LO', 'ex', '2026-05-01', [pick('L2', '0.01')]),
    { id: 'GP', kind: 'giving-paid', at: noon('2026-12-01'), tz: TZ, year: 2026, cents: 1234 },
  ];
  test('collects the year and totals short and long gains over disposals, close-outs and recoveries', () => {
    const state = replay(entries);
    expect(state.errors).toEqual([]);
    const y = yearSummary(state, 2026);
    expect(y.disposals.map((d) => d.kind)).toEqual(['sell', 'fee']);
    const fee = y.disposals[1]?.gainCents ?? 0;
    expect(y.stGainCents).toBe(cents('-650'));
    expect(y.ltGainCents).toBe(cents('-4500') + fee + cents('-40000') + cents('500'));
    expect(y.incomeCents).toBe(6000);
    expect([y.gifts.length, y.charityGifts.length, y.lost.length, y.closeOuts.length, y.recoveries.length]).toEqual([1, 1, 1, 1, 1]);
    expect(y.givingPaidCents).toBe(1234);
    expect(y.digitalAssetAnswer).toBe('yes');
  });
  test('a short-term recovery counts as short', () => {
    const state = replay([wallet('ex'), wallet('lend'), buy('B', 'lend', '2025-06-01', '1', '100'), { id: 'F', kind: 'wallet-freeze', at: noon('2025-07-01'), tz: TZ, wallet: 'lend' }, { id: 'X', kind: 'wallet-close-out', at: noon('2025-08-01'), tz: TZ, wallet: 'lend', reason: 'Plan' }, receive('P', 'ex', '2025-09-01', '0.1', '10', { type: 'frozen-payout', fromWallet: 'lend' })]);
    const y = yearSummary(state, 2025);
    expect(y.stGainCents).toBe(-10_000 + 1000);
    expect(y.ltGainCents).toBe(0);
  });
  test('a year with only buys and moves answers no', () => {
    const state = replay([...testBook(), wallet('cold'), move('M', 'ex', 'cold', '2025-06-01', 10, 0, '0', [{ lotId: 'L1', sats: 10 }])]);
    expect(yearSummary(state, 2025).digitalAssetAnswer).toBe('no');
  });
});

describe('gift totals', () => {
  test('per recipient per year, labels matched ignoring case and spaces; over the exclusion flagged', () => {
    const state = replay([
      wallet('ex'),
      buy('B', 'ex', '2020-01-01', '1', '1000'),
      give('G1', 'ex', '2026-01-01', [pick('B', '0.1')], '10000', 'person', 'Sam '),
      give('G2', 'ex', '2026-06-01', [pick('B', '0.1')], '9000.01', 'person', 'sam'),
      give('G3', 'ex', '2026-06-01', [pick('B', '0.1')], '19000', 'person', 'Alex'),
      give('G4', 'ex', '2027-06-01', [pick('B', '0.1')], '50000', 'person', 'Sam'),
    ]);
    expect(giftTotalsByRecipient(state, 2026)).toEqual([
      { recipient: 'Alex', valueCents: cents('19000') },
      { recipient: 'Sam', valueCents: cents('19000.01') },
    ]);
    expect(giftsOverExclusion(state, 2026, cents('19000'))).toEqual([{ recipient: 'Sam', valueCents: cents('19000.01') }]);
  });
});

describe('canSellFrom', () => {
  const w = (type: Wallet['type'], frozen = false): Wallet => ({ id: 'w', name: 'Wallet', type, defaultProof: '', archived: false, frozen, closeOutEntryId: null, recoveredCents: 0 });
  test('exchange ok; self-custody → prepare-sale; frozen and retirement refused', () => {
    expect(canSellFrom(w('exchange'))).toEqual({ ok: true, value: true });
    const sc = canSellFrom(w('self-custody'));
    expect(sc.ok ? null : sc.error.code).toBe('prepare-sale');
    expect(sc.ok || !('steps' in sc.error) ? [] : sc.error.steps).toHaveLength(3);
    const fr = canSellFrom(w('exchange', true));
    expect(fr.ok ? null : fr.error.code).toBe('wallet-frozen');
    const ira = canSellFrom(w('retirement'));
    expect(ira.ok ? null : ira.error.code).toBe('retirement-wallet');
  });
});
