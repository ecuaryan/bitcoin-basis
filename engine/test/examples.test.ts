/** Worked examples from docs/engine-spec.md (ledger side). Numbers must match exactly. */
import { describe, expect, test } from 'vitest';
import { holdings } from '../src/reports.ts';
import { lowestTaxOrder, oldestFirst, picksFor } from '../src/picks.ts';
import { replay } from '../src/replay.ts';
import { canSellFrom } from '../src/sell-guard.ts';
import { localDate, taxYear } from '../src/dates.ts';
import type { Entry } from '../src/types.ts';
import { buy, cents, edit, give, lost, move, noon, pick, receive, sats, sell, testBook, TZ, wallet } from './helpers.ts';

const SALE_DATE = '2026-11-15';
const PRICE = cents('75000');

function valueAt75k(s: number): number {
  return (s * PRICE) / 100_000_000;
}

describe('worked examples', () => {
  test('1: sell 0.25 oldest first → L1 only, cost $14,000.00, long-term gain $4,750.00', () => {
    const book = testBook();
    const picks = oldestFirst(replay(book).lots, 'ex', sats('0.25'));
    expect(picks).toEqual({ ok: true, value: [{ lotId: 'L1', sats: sats('0.25') }] });
    if (!picks.ok) return;
    const state = replay([...book, sell('S1', 'ex', SALE_DATE, picks.value, '18750')]);
    expect(state.errors).toEqual([]);
    const [d] = state.disposals;
    expect(d).toMatchObject({ kind: 'sell', costCents: cents('14000'), proceedsCents: cents('18750'), gainCents: cents('4750'), ltGainCents: cents('4750'), stGainCents: 0, year: 2026 });
    expect(d?.picks).toEqual([
      { lotId: 'L1', sats: sats('0.25'), costCents: cents('14000'), acquiredDate: '2021-03-15', tier: 'documented', term: 'long', proceedsCents: cents('18750'), gainCents: cents('4750') },
    ]);
    expect(state.lots.find((l) => l.id === 'L1')).toMatchObject({ sats: sats('0.25'), costCents: cents('14000') });
  });

  test('2: sell 0.25 lowest tax → all of L3 (−$4,500.00 long) and 0.05 of L4 (−$650.00 short)', () => {
    const book = testBook();
    const order = lowestTaxOrder(replay(book).lots, 'ex', { priceCents: PRICE, stRate: 0.273, ltRate: 0.203, onDate: SALE_DATE });
    expect(order.map((l) => l.id)).toEqual(['L3', 'L4', 'L1', 'L2']);
    const picks = picksFor(order, sats('0.25'));
    expect(picks).toEqual({ ok: true, value: [pick('L3', '0.2'), pick('L4', '0.05')] });
    if (!picks.ok) return;
    const state = replay([...book, sell('S2', 'ex', SALE_DATE, picks.value, '18750')]);
    const d = state.disposals[0];
    expect(d?.picks.map((p) => [p.lotId, p.term, p.proceedsCents, p.costCents, p.gainCents])).toEqual([
      ['L3', 'long', cents('15000'), cents('19500'), cents('-4500')],
      ['L4', 'short', cents('3750'), cents('4400'), cents('-650')],
    ]);
    expect(d).toMatchObject({ ltGainCents: cents('-4500'), stGainCents: cents('-650'), gainCents: cents('-5150') });
  });

  test('4: move 0.6 with a 2,000-sat fee, oldest first', () => {
    const book: Entry[] = [...testBook(), wallet('cold', 'self-custody')];
    const picks = oldestFirst(replay(book).lots, 'ex', sats('0.6') + 2000);
    expect(picks).toEqual({ ok: true, value: [pick('L1', '0.5'), { lotId: 'L2', sats: sats('0.1') + 2000 }] });
    if (!picks.ok) return;
    const state = replay([...book, move('M', 'ex', 'cold', SALE_DATE, sats('0.6'), 2000, '1.50', picks.value)]);
    expect(state.errors).toEqual([]);
    // Moved: L1 whole and 0.1 of L2 ($2,250.00), as new lots in the destination keeping their dates.
    expect(state.lots.filter((l) => l.wallet === 'cold')).toEqual([
      { id: 'M:0', wallet: 'cold', sats: sats('0.5'), costCents: cents('28000'), acquiredDate: '2021-03-15', acquiredAt: noon('2021-03-15'), tier: 'documented', proof: 'Email receipt', originEntryId: 'L1', alwaysLongTerm: false },
      { id: 'M:1', wallet: 'cold', sats: sats('0.1'), costCents: cents('2250'), acquiredDate: '2023-01-20', acquiredAt: noon('2023-01-20'), tier: 'documented', proof: 'Email receipt', originEntryId: 'L2', alwaysLongTerm: false },
    ]);
    // Fee: cost $0.45, value $1.50, gain $1.05.
    expect(state.disposals).toHaveLength(1);
    expect(state.disposals[0]).toMatchObject({ kind: 'fee', sats: 2000, costCents: 45, proceedsCents: 150, gainCents: 105, ltGainCents: 105 });
    expect(state.disposals[0]?.picks.map((p) => p.lotId)).toEqual(['L2']);
    // L2 left: 0.29998000 at $6,749.55. L1 is gone from the exchange.
    expect(state.lots.find((l) => l.id === 'L2')).toMatchObject({ sats: 29_998_000, costCents: cents('6749.55') });
    expect(state.lots.find((l) => l.id === 'L1')).toBeUndefined();
  });

  test('5: gift 0.01 from L2 → no gain, recipient cost $225.00 dated 2023-01-20, value $750.00', () => {
    const state = replay([...testBook(), give('G', 'ex', SALE_DATE, [pick('L2', '0.01')], '750', 'person', 'Sam')]);
    expect(state.disposals).toEqual([]);
    expect(state.gifts).toHaveLength(1);
    expect(state.gifts[0]).toMatchObject({ recipient: 'Sam', costCents: cents('225'), valueCents: cents('750'), year: 2026 });
    expect(state.gifts[0]?.picks).toEqual([{ lotId: 'L2', sats: sats('0.01'), costCents: cents('225'), acquiredDate: '2023-01-20', tier: 'documented', term: 'long', valueCents: cents('750') }]);
  });

  test('12: average cost of the test book is $54,416.67 per BTC', () => {
    const h = holdings(replay(testBook()));
    expect(h.totalSats).toBe(sats('1.2'));
    expect(h.totalCostCents).toBe(cents('65300'));
    expect(h.averageCostCentsPerBtc).toBe(cents('54416.67'));
  });

  test('14: a forgotten 2020 purchase added after example 1 leaves the saved sale unchanged', () => {
    const book = testBook();
    const sale = sell('S1', 'ex', SALE_DATE, [pick('L1', '0.25')], '18750');
    const before = replay([...book, sale]);
    const forgotten = buy('zz-forgotten', 'ex', '2020-06-01', '0.3', '2700');
    const after = replay([...book, sale, forgotten]);
    expect(after.disposals).toEqual(before.disposals);
    // Re-picking now would choose the 2020 lot; replay never re-picks.
    const repick = oldestFirst(after.lots, 'ex', sats('0.25'));
    expect(repick.ok && repick.value[0]?.lotId).toBe('zz-forgotten');
  });

  test('15: $25 of promo sats → income $25.00, lot cost $25.00', () => {
    const state = replay([wallet('ex'), receive('P', 'ex', '2026-04-02', '0.0003', '25', { type: 'income', description: 'Card rewards' })]);
    expect(state.income).toEqual([{ entryId: 'P', wallet: 'ex', date: '2026-04-02', year: 2026, sats: 30_000, valueCents: 2500, description: 'Card rewards' }]);
    expect(state.lots[0]).toMatchObject({ id: 'P', costCents: 2500, sats: 30_000 });
  });

  test('17: a buy at 23:30 Dec 31 local belongs to that tax year', () => {
    const at = '2026-01-01T06:30:00Z'; // 23:30 on 2025-12-31 in Boise (UTC−7)
    expect(localDate(at, TZ)).toBe('2025-12-31');
    expect(taxYear(at, TZ)).toBe(2025);
    const state = replay([wallet('ex'), { ...buy('B', 'ex', '2026-01-01', '0.01', '900'), at }, { ...receive('R', 'ex', '2026-01-01', '0.001', '90', { type: 'income' }), at }]);
    expect(state.lots[0]?.acquiredDate).toBe('2025-12-31');
    expect(state.income[0]?.year).toBe(2025);
  });

  test('18: selling from a self-custody wallet in the planner is refused with prepare-sale guidance', () => {
    const state = replay([wallet('cold', 'self-custody', 'Cold storage')]);
    const result = canSellFrom(state.wallets[0] as (typeof state.wallets)[number]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('prepare-sale');
    expect(result.error.message).toContain('Cold storage');
  });

  test('19: two entries replace the same entry → conflict showing both, neither applied', () => {
    const original = buy('B', 'ex', '2024-05-01', '0.1', '6000');
    const phone = edit(original, { id: 'B-phone', reason: 'typo', costCents: cents('6100') });
    const mac = edit(original, { id: 'B-mac', reason: 'fee added', costCents: cents('6050') });
    const state = replay([wallet('ex'), original, phone, mac]);
    expect(state.conflicts).toEqual([{ targetId: 'B', versions: [mac, phone] }]);
    expect(state.lots.map((l) => [l.id, l.costCents])).toEqual([['B', cents('6000')]]);
  });

  test('20: frozen wallet close-out loss, then a recovery gain after close-out', () => {
    const entries: Entry[] = [
      wallet('ex'),
      wallet('lend', 'exchange', 'Lender'),
      buy('C1', 'lend', '2021-01-10', '1', '40000'),
      { id: 'F', kind: 'wallet-freeze', at: noon('2022-07-13'), tz: TZ, wallet: 'lend' },
      receive('P1', 'ex', '2023-03-01', '0.5', '12000', { type: 'frozen-payout', fromWallet: 'lend' }),
      { id: 'X', kind: 'wallet-close-out', at: noon('2024-01-15'), tz: TZ, wallet: 'lend', reason: 'Bankruptcy plan effective' },
      receive('P2', 'ex', '2025-06-01', '0.02', '1500', { type: 'frozen-payout', fromWallet: 'lend' }),
    ];
    const state = replay(entries);
    expect(state.errors).toEqual([]);
    expect(state.lots.find((l) => l.id === 'P1')?.costCents).toBe(cents('12000'));
    expect(state.closeOuts).toHaveLength(1);
    expect(state.closeOuts[0]).toMatchObject({ wallet: 'lend', lossDate: '2024-01-15', year: 2024, costCents: cents('40000'), recoveredCents: cents('12000'), gainCents: cents('-28000'), ltGainCents: cents('-28000'), stGainCents: 0, recoveryTerm: 'long' });
    expect(state.lots.filter((l) => l.wallet === 'lend')).toEqual([]);
    expect(state.recoveries).toEqual([{ entryId: 'P2', wallet: 'ex', fromWallet: 'lend', closeOutEntryId: 'X', date: '2025-06-01', year: 2025, sats: sats('0.02'), gainCents: cents('1500'), term: 'long' }]);
    expect(state.lots.find((l) => l.id === 'P2')?.costCents).toBe(cents('1500'));
    expect(state.income).toEqual([]);
  });

  test('21: lost 0.1 BTC that cost $3,000 → holdings −0.1 BTC, no loss recorded, flagged for CPA', () => {
    const base: Entry[] = [wallet('ex'), buy('B', 'ex', '2024-01-05', '0.3', '9000')];
    const before = holdings(replay(base));
    const state = replay([...base, lost('LOST', 'ex', '2026-02-01', [pick('B', '0.1')])]);
    expect(holdings(state).totalSats).toBe(before.totalSats - sats('0.1'));
    expect(state.disposals).toEqual([]);
    expect(state.lost[0]).toMatchObject({ sats: sats('0.1'), costCents: cents('3000'), cause: 'lost-keys', year: 2026 });
    expect(state.cpaFlags).toEqual([{ entryId: 'LOST', code: 'lost-coins', message: expect.stringContaining('CPA') as string }]);
  });

  test('22: inherited 0.5 BTC worth $40,000, sold 3 weeks later for $41,000 → long-term gain $1,000.00', () => {
    const state = replay([wallet('ex'), receive('I', 'ex', '2026-03-01', '0.5', '40000', { type: 'inherited' }), sell('S', 'ex', '2026-03-22', [pick('I', '0.5')], '41000')]);
    expect(state.disposals[0]).toMatchObject({ gainCents: cents('1000'), ltGainCents: cents('1000'), stGainCents: 0 });
    expect(state.income).toEqual([]);
  });

  test('23: gave 0.1 BTC held over a year (cost $2,000, worth $9,000) to a church', () => {
    const state = replay([wallet('ex'), buy('B', 'ex', '2024-01-05', '0.1', '2000'), give('G', 'ex', '2026-03-01', [pick('B', '0.1')], '9000', 'charity', 'Church')]);
    expect(state.disposals).toEqual([]);
    expect(state.charityGifts[0]).toMatchObject({ recipient: 'Church', costCents: cents('2000'), valueCents: cents('9000'), deductionCents: cents('9000'), appraisalFlag: true });
    expect(state.cpaFlags.map((f) => f.code)).toEqual(['qualified-appraisal']);
  });

  test('R: a $100.00 lot of 1 BTC sold in thirds costs $33.33, $33.33, $33.34', () => {
    const state = replay([
      wallet('ex'),
      buy('B', 'ex', '2024-01-05', '1', '100'),
      sell('S1', 'ex', '2026-01-01', [{ lotId: 'B', sats: 33_333_333 }], '50'),
      sell('S2', 'ex', '2026-01-02', [{ lotId: 'B', sats: 33_333_333 }], '50'),
      sell('S3', 'ex', '2026-01-03', [{ lotId: 'B', sats: 33_333_334 }], '50'),
    ]);
    expect(state.disposals.map((d) => d.costCents)).toEqual([3333, 3333, 3334]);
    expect(state.lots).toEqual([]);
  });

  test('sale proceeds check: 0.25 BTC at $75,000 is $18,750.00', () => {
    expect(valueAt75k(sats('0.25'))).toBe(cents('18750'));
  });
});
