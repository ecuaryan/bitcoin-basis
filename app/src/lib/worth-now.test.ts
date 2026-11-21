import { describe, expect, it } from 'vitest';
import { entryWorth, sumWorth, worthNow } from './worth-now.ts';

const P = 10_000_000; // $100,000.00 per BTC, in cents

describe('worthNow', () => {
  it('shows a gain and a loss in cents, with the percent toward zero', () => {
    const gain = worthNow(1_000_000, 72_000, P); // 0.01 BTC = $1,000.00 against $720.00
    expect(gain).toMatchObject({ gainCents: 28_000, percent: 38 }); // 38.88 -> 38
    const loss = worthNow(1_000_000, 104_000, P);
    expect(loss).toMatchObject({ gainCents: -4_000, percent: -3 }); // -3.85 -> -3
  });
  it('rounds the value half-up and never uses floats for money', () => {
    expect(worthNow(5, 0, 10_000_000).valueCents).toBe(1); // 0.5 cent
    expect(worthNow(4, 0, 10_000_000).valueCents).toBe(0);
  });
  it('has no value, gain or percent without a price, and no percent without a cost', () => {
    expect(worthNow(1000, 5, null)).toEqual({ sats: 1000, costCents: 5, valueCents: null, gainCents: null, percent: null });
    expect(worthNow(1_000_000, 0, P)).toMatchObject({ valueCents: 100_000, gainCents: 100_000, percent: null });
  });
});

describe('sumWorth', () => {
  it('values each coin on its own so the lines add up', () => {
    const w = sumWorth([{ sats: 5, costCents: 0 }, { sats: 5, costCents: 0 }], 10_000_000);
    expect(w.valueCents).toBe(2);
    expect(worthNow(10, 0, 10_000_000).valueCents).toBe(1);
  });
  it('is empty-safe', () => {
    expect(sumWorth([], P)).toMatchObject({ sats: 0, valueCents: 0, gainCents: 0, percent: null });
  });
});

const lot = (id: string, wallet: string, sats: number, costCents: number, originEntryId: string) => ({ id, wallet, sats, costCents, originEntryId });
const pick = (lotId: string, sats: number) => ({ lotId, sats });

function ledger(over: Record<string, unknown>) {
  return { wallets: [{ id: 'w1', frozen: false }, { id: 'w2', frozen: false }, { id: 'fz', frozen: true }], lots: [], disposals: [], gifts: [], lost: [], ...over } as never;
}

describe('entryWorth', () => {
  it('follows pieces moved to another wallet and ignores other entries', () => {
    const state = ledger({
      lots: [lot('A', 'w1', 600_000, 50_000, 'A'), lot('A:A', 'w2', 400_000, 33_000, 'A'), lot('B', 'w1', 1_000_000, 90_000, 'B')],
    });
    const w = entryWorth(state, ['A'], P);
    expect(w.held).toMatchObject({ sats: 1_000_000, costCents: 83_000, valueCents: 100_000, gainCents: 17_000, percent: 20 });
    expect(w.gone).toEqual([]);
  });
  it('lists the part that was sold, spent, paid in fees, given or lost, including from moved pieces', () => {
    const state = ledger({
      lots: [lot('A', 'w1', 500_000, 40_000, 'A2')],
      disposals: [
        { kind: 'sell', date: '2026-11-20', picks: [pick('A:A', 20_000), pick('Z', 99)] },
        { kind: 'spend', date: '2026-11-21', picks: [pick('A', 1_000)] },
        { kind: 'fee', date: '2026-10-01', picks: [pick('A', 5)] },
        { kind: 'sell', date: '2026-11-22', picks: [pick('Z', 5)] },
      ],
      gifts: [{ date: '2026-09-01', picks: [pick('A', 7)] }],
      lost: [{ date: '2026-08-01', picks: [pick('A', 3)] }],
    });
    const w = entryWorth(state, ['A', 'A2'], P);
    expect(w.held.sats).toBe(500_000);
    expect(w.gone.map((g) => [g.kind, g.sats, g.date])).toEqual([
      ['lost', 3, '2026-08-01'],
      ['given', 7, '2026-09-01'],
      ['fees', 5, '2026-10-01'],
      ['sold', 20_000, '2026-11-20'],
      ['spent', 1_000, '2026-11-21'],
    ]);
  });
  it('works for gift and inherited coins (carried cost) and skips frozen wallets', () => {
    const state = ledger({ lots: [lot('G', 'w1', 100_000, 0, 'G'), lot('G:G', 'fz', 100_000, 0, 'G')] });
    expect(entryWorth(state, ['G'], P).held).toMatchObject({ sats: 100_000, costCents: 0, valueCents: 10_000, percent: null });
  });
  it('is masked-agnostic and shows no value without a price', () => {
    const state = ledger({ lots: [lot('A', 'w1', 1, 1, 'A')] });
    expect(entryWorth(state, ['A'], null).held).toMatchObject({ valueCents: null, gainCents: null });
  });
});
