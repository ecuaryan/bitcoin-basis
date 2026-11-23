import { holdings, replay, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook } from '../demo/demo-data.ts';
import { describeEntry } from './describe-entry.ts';
import { buildItems, entryRows, NO_FILTER } from './entry-list.ts';
import { rowLine } from './entry-row.ts';

const tz = 'America/Boise';
const at = (d: string) => `${d}T18:00:00Z`;
const book: Entry[] = [
  { id: 'w1', kind: 'wallet', at: at('2026-01-01'), tz, wallet: 'ex', name: 'Strike', type: 'exchange', defaultProof: '' },
  { id: 'w2', kind: 'wallet', at: at('2026-01-01'), tz, wallet: 'cold', name: 'Cold card', type: 'self-custody', defaultProof: '' },
  { id: 'w3', kind: 'wallet', at: at('2026-01-01'), tz, wallet: 'ira', name: 'Fidelity IRA', type: 'retirement', defaultProof: '' },
  { id: 'b1', kind: 'buy', at: at('2026-02-01'), tz, wallet: 'ex', sats: 10_000_000, costCents: 900_000, tier: 'documented' },
  { id: 'r1', kind: 'receive', at: at('2026-03-01'), tz, wallet: 'ex', sats: 1_200_000, valueCents: 123_600, source: { type: 'income', description: 'Design work' } },
  { id: 'm1', kind: 'move', at: at('2026-04-01'), tz, from: 'ex', to: 'cold', sats: 5_000_000, feeSats: 1_840, feeValueCents: 170, picks: [{ lotId: 'b1', sats: 5_001_840 }] },
  { id: 's1', kind: 'sell', at: at('2026-05-01'), tz, wallet: 'ex', sats: 450_000, proceedsCents: 52_000, spent: true, description: 'Hotel', picks: [{ lotId: 'b1', sats: 450_000 }] },
  { id: 'g1', kind: 'give', at: at('2026-06-01'), tz, wallet: 'cold', sats: 1_000_000, valueCents: 92_000, to: 'person', recipient: 'Mom', picks: [{ lotId: 'm1:b1', sats: 1_000_000 }] },
  { id: 'rb', kind: 'retirement-buy', at: at('2026-07-01'), tz, wallet: 'ira', sats: 10_000_000, costCents: 1_150_000 },
];
const state = replay(book);
const wallets = new Map(state.wallets.map((w) => [w.id, w]));
const loans = new Map<string, string>();
const byId = (id: string): Entry => book.find((e) => e.id === id) as Entry;

describe('describeEntry: the columns of a list', () => {
  it('splits the wallet from the note', () => {
    expect(describeEntry(byId('r1'), wallets)).toMatchObject({ wallets: ['Strike'], note: 'Design work', detail: 'Strike · Design work' });
    expect(describeEntry(byId('s1'), wallets)).toMatchObject({ wallets: ['Strike'], note: 'Hotel' });
    expect(describeEntry(byId('b1'), wallets)).toMatchObject({ wallets: ['Strike'], note: '', feeSats: null });
  });
  it('names both wallets of a move and keeps its fee apart from what arrived', () => {
    expect(describeEntry(byId('m1'), wallets)).toMatchObject({ wallets: ['Strike', 'Cold card'], sats: 5_000_000, sign: '', feeSats: 1_840 });
  });
  it('gives loan records no wallet, the loan in the note', () => {
    const pay: Entry = { id: 'lp', kind: 'loan-payment', at: at('2026-08-01'), tz, loan: 'heloc', interestCents: 1_000, principalCents: 84_000 };
    expect(describeEntry(pay, wallets, new Map([['heloc', 'Home equity line']]))).toMatchObject({ wallets: [], note: 'Home equity line', sats: null, cents: 85_000, centsLabel: 'paid' });
  });
});

describe('rowLine', () => {
  it('says the dollars of a gift or income were worth that much then', () => {
    expect(rowLine(byId('g1'), wallets, loans).centsWord).toBe('worth then');
    expect(rowLine(byId('r1'), wallets, loans).centsWord).toBe('worth then');
    expect(rowLine(byId('b1'), wallets, loans).centsWord).toBe('paid');
    expect(rowLine(byId('m1'), wallets, loans).centsWord).toBe('');
  });
  it('titles a retirement purchase Bought, with its tag', () => {
    expect(rowLine(byId('rb'), wallets, loans)).toMatchObject({ title: 'Bought', retirement: true });
  });
  it('on all entries, a move is unsigned with its fee under it', () => {
    expect(rowLine(byId('m1'), wallets, loans)).toMatchObject({ title: 'Moved', sats: 5_000_000, sign: '', feeSats: 1_840, arrivedSats: null });
  });
  it('on the wallet it left, a move shows what left: what arrived plus the fee', () => {
    expect(rowLine(byId('m1'), wallets, loans, 'ex')).toMatchObject({ title: 'Moved to Cold card', wallets: ['Strike'], sats: 5_001_840, sign: '−', arrivedSats: 5_000_000, feeSats: 1_840 });
  });
  it('on the wallet it reached, a move shows what arrived', () => {
    expect(rowLine(byId('m1'), wallets, loans, 'cold')).toMatchObject({ title: 'Moved from Strike', wallets: ['Cold card'], sats: 5_000_000, sign: '+', arrivedSats: null, feeSats: null });
  });
  it('a move without a fee shows no fee', () => {
    const free: Entry = { ...(byId('m1') as Extract<Entry, { kind: 'move' }>), feeSats: 0, feeValueCents: 0 };
    expect(rowLine(free, wallets, loans, 'ex')).toMatchObject({ sats: 5_000_000, arrivedSats: null, feeSats: null });
  });
  it('a payout from a frozen wallet does not change that wallet', () => {
    const payout: Entry = { id: 'p1', kind: 'receive', at: at('2026-09-01'), tz, wallet: 'ex', sats: 100, valueCents: 10, source: { type: 'frozen-payout', fromWallet: 'cold' } };
    expect(rowLine(payout, wallets, loans, 'cold')).toMatchObject({ title: 'Paid out to Strike', sign: '' });
    expect(rowLine(payout, wallets, loans, 'ex')).toMatchObject({ sign: '+', note: 'From Cold card' });
  });
  it("adds up to each wallet's balance (signed rows, removed ones left out)", () => {
    for (const entries of [book, buildDemoBook().entries]) {
      const s = replay(entries);
      const ws = new Map(s.wallets.map((w) => [w.id, w]));
      const items = buildItems(entries);
      for (const w of s.wallets) {
        if (w.type === 'retirement' || w.frozen) continue;
        const rows = entryRows(items, { ...NO_FILTER, wallet: w.id }, ws).filter((r) => !r.item.deleted && !r.item.conflict);
        let sum = 0;
        for (const r of rows) {
          const l = rowLine(r.item.current, ws, loans, w.id);
          if (l.sats !== null && l.sign !== '') sum += l.sign === '+' ? l.sats : -l.sats;
        }
        const held = holdings(s).wallets.find((h) => h.wallet === w.id)?.sats ?? 0;
        expect(sum, w.name).toBe(held);
      }
    }
  });
});
