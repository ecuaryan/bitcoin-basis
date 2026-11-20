/** Tax math against hand-computed figures, date edges, gifts and frozen platforms (from an adversarial review). Synthetic data only. */
import { describe, expect, test } from 'vitest';
import { taxForYear } from '../src/tax/tax.ts';
import { isLongTerm, localDate } from '../src/dates.ts';
import { replay } from '../src/replay.ts';
import { cents, errorCodes, move, noon, pick, receive, sats, sell, TZ, wallet } from './helpers.ts';
import type { Entry } from '../src/types.ts';

const none = { customRate: 0 };
const cf0 = { st: 0, lt: 0 };

describe('hand-computed federal figures (2026, Rev. Proc. 2025-32)', () => {
  test('single, no wages, $60,000 LT gain: taxable $43,900 all in the 0% band', () => {
    const r = taxForYear({ year: 2026, filingStatus: 'single', wages: 0, st: 0, lt: cents('60000'), carryforward: cf0, state: none });
    expect(r.federal).toBe(0);
  });
  test('MFS: $10,000 ST loss deducts $1,500 and carries $8,500 short', () => {
    const r = taxForYear({ year: 2026, filingStatus: 'married-separate', wages: cents('100000'), st: cents('-10000'), lt: 0, carryforward: cf0, state: none });
    expect(r.netting.lossDeduction).toBe(cents('1500'));
    expect(r.carryforwardOut).toEqual({ st: cents('8500'), lt: 0 });
  });
  test('NIIT applies to short-term gain: single $190,000 wages + $20,000 ST → NIIT $380', () => {
    const r = taxForYear({ year: 2026, filingStatus: 'single', wages: cents('190000'), st: cents('20000'), lt: 0, carryforward: cf0, state: none });
    expect(r.federalParts.niit).toBe(cents('380'));
  });
  test('carryforward keeps character: $5,000 ST cf + $2,000 LT cf, $1,000 LT gain, wages $50k single', () => {
    const r = taxForYear({ year: 2026, filingStatus: 'single', wages: cents('50000'), st: 0, lt: cents('1000'), carryforward: { st: cents('5000'), lt: cents('2000') }, state: none });
    expect(r.carryforwardOut).toEqual({ st: cents('2000'), lt: cents('1000') });
  });
  test('wages below the standard deduction: none of the loss is "used" (§1212(b)(2)), all carries', () => {
    const r = taxForYear({ year: 2026, filingStatus: 'single', wages: cents('10000'), st: cents('-4000'), lt: 0, carryforward: cf0, state: none });
    expect(r.carryforwardOut).toEqual({ st: cents('4000'), lt: 0 });
  });
});

describe('holding period and local-date edges', () => {
  test('anniversary short, day after long; Feb 29 → Feb 28 short, Mar 1 long', () => {
    expect(isLongTerm('2025-01-15', '2026-01-15')).toBe(false);
    expect(isLongTerm('2025-01-15', '2026-01-16')).toBe(true);
    expect(isLongTerm('2024-02-29', '2025-02-28')).toBe(false);
    expect(isLongTerm('2024-02-29', '2025-03-01')).toBe(true);
    expect(isLongTerm('2023-03-01', '2024-03-01')).toBe(false);
  });
  test('23:30 Dec 31 in Boise is the old year; Kiritimati (UTC+14) and Pago Pago (UTC−11) edges', () => {
    expect(localDate('2026-01-01T06:30:00Z', 'America/Boise')).toBe('2025-12-31');
    expect(localDate('2025-12-31T10:30:00Z', 'Pacific/Kiritimati')).toBe('2026-01-01');
    expect(localDate('2026-01-01T10:30:00Z', 'Pacific/Pago_Pago')).toBe('2025-12-31');
  });
  test('DST fall-back hour in Boise stays on the same local date', () => {
    expect(localDate('2025-11-02T07:30:00Z', 'America/Boise')).toBe('2025-11-02');
    expect(localDate('2025-11-02T08:30:00Z', 'America/Boise')).toBe('2025-11-02');
  });
});

describe('gifts and inheritance', () => {
  test('inherited coins sold 3 weeks later are long-term (example 22)', () => {
    const s = replay([wallet('ex'), receive('I', 'ex', '2026-01-01', '0.5', '40000', { type: 'inherited' }), sell('S', 'ex', '2026-01-22', [pick('I', '0.5')], '41000')]);
    expect(s.disposals[0]?.ltGainCents).toBe(cents('1000'));
  });

  // Dual basis (Treas. Reg. 1.1015-1(a)): giver's cost $10,000 (2022-01-01); value at the gift $6,000 (2026-01-10).
  const gift = receive('G', 'ex', '2026-01-10', '0.1', '6000', { type: 'gift', giverCostCents: cents('10000'), giverAcquiredAt: noon('2022-01-01') });
  const soldFor = (dollars: string): Entry[] => [wallet('ex'), gift, sell('S', 'ex', '2026-06-01', [pick('G', '0.1')], dollars)];
  test('both bases are stored on the lot', () => {
    expect(replay([wallet('ex'), gift]).lots[0]).toMatchObject({ costCents: cents('10000'), acquiredDate: '2022-01-01', lossBasis: { costCents: cents('6000'), acquiredDate: '2026-01-10' } });
  });
  test("sold above the giver's cost: gain from the giver's cost and date (long-term)", () => {
    const p = replay(soldFor('12000')).disposals[0]?.picks[0];
    expect(p).toMatchObject({ costCents: cents('10000'), acquiredDate: '2022-01-01', term: 'long', gainCents: cents('2000') });
  });
  test('sold between the value at the gift and the cost: no gain and no loss', () => {
    const d = replay(soldFor('8000')).disposals[0];
    expect(d).toMatchObject({ gainCents: 0, costCents: cents('8000'), stGainCents: 0, ltGainCents: 0 });
  });
  test('sold below the value at the gift: loss from that value, holding period from the gift date', () => {
    const d = replay(soldFor('5000')).disposals[0];
    expect(d).toMatchObject({ stGainCents: cents('-1000'), ltGainCents: 0 });
    expect(d?.picks[0]).toMatchObject({ acquiredDate: '2026-01-10', term: 'short', costCents: cents('6000') });
  });
  test('a loss more than a year after the gift is long-term', () => {
    const late = replay([wallet('ex'), gift, sell('S', 'ex', '2027-02-01', [pick('G', '0.1')], '5000')]).disposals[0];
    expect(late).toMatchObject({ ltGainCents: cents('-1000'), stGainCents: 0 });
  });
  test('partial sales and moves split both bases', () => {
    const entries: Entry[] = [
      wallet('ex'), wallet('cold', 'self-custody'), gift,
      move('M', 'ex', 'cold', '2026-02-01', sats('0.04'), 0, '0', [pick('G', '0.04')]),
      sell('S', 'ex', '2026-06-01', [pick('G', '0.06')], '3000'),
    ];
    const state = replay(entries);
    expect(state.lots.map((l) => [l.id, l.costCents, l.lossBasis?.costCents])).toEqual([['M:0', cents('4000'), cents('2400')]]);
    expect(state.disposals[0]).toMatchObject({ stGainCents: cents('-600'), costCents: cents('3600') });
  });
});

describe('frozen platform', () => {
  test('close-out lossDate earlier than the coins were bought is refused', () => {
    const entries: Entry[] = [
      wallet('cel'),
      { id: 'B', kind: 'buy', at: noon('2025-06-01'), tz: TZ, wallet: 'cel', sats: 1000, costCents: 100, tier: 'documented' },
      { id: 'F', kind: 'wallet-freeze', at: noon('2025-07-01'), tz: TZ, wallet: 'cel' },
      { id: 'C', kind: 'wallet-close-out', at: noon('2026-01-01'), tz: TZ, wallet: 'cel', lossDate: '2020-01-01', reason: 'x' },
    ];
    expect(errorCodes(replay(entries))).toEqual({ C: 'invalid-loss-date' });
  });
  test('a dual-basis gift on a failed platform: the loss is measured from the value at the gift', () => {
    const entries: Entry[] = [
      wallet('cel'), receive('G', 'cel', '2025-01-10', '0.1', '6000', { type: 'gift', giverCostCents: cents('10000'), giverAcquiredAt: noon('2022-01-01') }),
      { id: 'F', kind: 'wallet-freeze', at: noon('2025-07-01'), tz: TZ, wallet: 'cel' },
      { id: 'C', kind: 'wallet-close-out', at: noon('2025-12-01'), tz: TZ, wallet: 'cel', reason: 'x' },
    ];
    expect(replay(entries).closeOuts[0]).toMatchObject({ costCents: cents('6000'), stGainCents: cents('-6000'), ltGainCents: 0 });
  });
});
