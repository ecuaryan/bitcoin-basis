/** Loan records next to coin records: edits, ids, name and statement-day timelines, platform payouts (synthetic data). */
import { describe, expect, test } from 'vitest';
import { loanPurchases, loanSummary, suggestLoanPayment } from '../src/loans.ts';
import { holdings, yearSummary } from '../src/reports.ts';
import { replay } from '../src/replay.ts';
import { traceCoins } from '../src/trace.ts';
import type { Entry, LedgerState } from '../src/types.ts';
import { buy, cents, errorCodes, noon, receive, sats, TZ, wallet } from './helpers.ts';
import { link, loan, payment } from './loan-helpers.ts';

const taxView = (s: LedgerState): unknown => ({ lots: s.lots, holdings: holdings(s), y: [2024, 2025, 2026].map((y) => yearSummary(s, y)), d: s.disposals });

describe('loan records can never change coin records', () => {
  test('a coin entry cannot continue a loan record’s chain, even through a delete', () => {
    const K = link('K', 'h', 'nothing');
    const D: Entry = { id: 'K1del', kind: 'delete', at: noon('2025-02-01'), tz: TZ, replaces: 'K', reason: 'unlink' };
    const B2: Entry = { ...buy('K2buy', 'ex', '2025-03-01', '1', '50000'), replaces: 'K1del', reason: 'hostile' };
    const withLoan = replay([wallet('ex'), loan('h', '2025-01-01', 65_000), K, D, B2]);
    expect(errorCodes(withLoan)['K2buy']).toBe('cannot-replace');
    expect(taxView(withLoan)).toEqual(taxView(replay([wallet('ex'), D, B2])));
  });

  test('a loan record cannot continue a coin entry’s chain through a delete either', () => {
    const del: Entry = { id: 'Bdel', kind: 'delete', at: noon('2025-02-01'), tz: TZ, replaces: 'B', reason: 'mistake' };
    const back: Entry = { ...payment('P', 'h', '2025-02-02', '1'), replaces: 'Bdel', reason: 'hostile' };
    const restore: Entry = { ...buy('B2', 'ex', '2025-01-10', '2', '1'), replaces: 'Bdel', reason: 'restore' };
    const state = replay([wallet('ex'), buy('B', 'ex', '2025-01-10', '1', '50000'), loan('h', '2025-01-01', 65_000), del, back]);
    expect(errorCodes(state)['P']).toBe('cannot-replace');
    expect(replay([wallet('ex'), buy('B', 'ex', '2025-01-10', '1', '50000'), del, restore]).lots.map((l) => [l.id, l.sats])).toEqual([['B', sats('2')]]);
  });

  test('a loan record that reuses a coin entry’s id is ignored; the coin entry stays', () => {
    const coins: Entry[] = [wallet('ex'), buy('B', 'ex', '2025-01-10', '1', '50000')];
    const hostile: Entry = { id: 'B', kind: 'loan-statement', at: noon('2025-02-01'), tz: TZ, loan: 'h', balanceCents: 1 };
    const state = replay([...coins, loan('h', '2025-01-01', 65_000), hostile]);
    expect(taxView(state)).toEqual(taxView(replay(coins)));
    expect(state.errors).toEqual([{ entryId: 'B', code: 'duplicate-id', message: 'a loan record reused the id of a coin record; the loan record is ignored' }]);
    // Two different coin entries with one id are still both rejected.
    expect(replay([...coins, buy('B', 'ex', '2025-01-11', '1', '1'), hostile]).lots).toEqual([]);
  });
});

describe('loan names and statement days follow the timeline', () => {
  test('rename a loan, then create a new loan with its old name: both exist', () => {
    const s = replay([
      loan('a', '2024-01-01', 65_000),
      { id: 'rename-a', kind: 'loan-update', at: noon('2024-06-01'), tz: TZ, loan: 'a', name: 'Old HELOC' },
      loan('b', '2025-01-01', 70_000),
    ]);
    expect(s.errors).toEqual([]);
    expect(s.loans.map((l) => [l.id, l.name])).toEqual([['a', 'Old HELOC'], ['b', 'HELOC']]);
  });

  test('an update dated before its loan was created applies right after the creation; one for a loan that never exists is an error', () => {
    const s = replay([loan('a', '2025-01-01', 65_000, { at: noon('2025-03-01') }), { id: 'early', kind: 'loan-update', at: noon('2025-02-01'), tz: TZ, loan: 'a', aprMillionths: 70_000, rateFrom: '2025-02-01' }, { id: 'none', kind: 'loan-update', at: noon('2025-02-01'), tz: TZ, loan: 'zz', name: 'X' }]);
    expect(errorCodes(s)).toEqual({ none: 'unknown-loan' });
    expect(s.loans[0]?.rates.map((r) => r.aprMillionths)).toEqual([65_000, 70_000]);
  });

  test('changing the statement day later does not move what earlier payments covered', () => {
    const s = replay([
      loan('h', '2025-01-01', 65_000, { statementDay: 15 }),
      { id: 'D', kind: 'loan-draw', at: noon('2025-01-01'), tz: TZ, loan: 'h', cents: 1_000_000 },
      payment('Y1', 'h', '2025-02-20', '10'),
      { id: 'U', kind: 'loan-update', at: noon('2025-06-01'), tz: TZ, loan: 'h', statementDay: 31 },
      payment('Y2', 'h', '2025-07-20', '10'),
      // A second change the same day replaces the first.
      { id: 'U2', kind: 'loan-update', at: '2025-06-01T20:00:00Z', tz: TZ, loan: 'h', statementDay: 30 },
    ]);
    expect(s.loans[0]?.payments.map((p) => p.interestThrough)).toEqual(['2025-02-15', '2025-06-30']);
    expect(s.loans[0]?.statementDay).toBe(30);
    expect(s.loans[0]?.statementDays.map((d) => [d.from, d.day])).toEqual([['2025-01-01', 15], ['2025-06-01', 30]]);
    expect(suggestLoanPayment(s, 'h', '2025-03-20')?.throughDate).toBe('2025-03-15');
  });

  test('a payment made in two parts: the pre-fill offers only what is left of that cycle', () => {
    const base: Entry[] = [loan('h', '2025-01-01', 73_000, { statementDay: 31 }), { id: 'D', kind: 'loan-draw', at: noon('2025-01-01'), tz: TZ, loan: 'h', cents: 1_000_000 }];
    // January: $10,000 × 7.3% × 31 / 365 = $62.00.
    expect(suggestLoanPayment(replay(base), 'h', '2025-02-10')).toMatchObject({ fromDate: '2025-01-01', throughDate: '2025-01-31', interestCents: 6_200, alreadyPaidCents: 0 });
    const part = replay([...base, payment('Y1', 'h', '2025-02-05', '40')]);
    expect(suggestLoanPayment(part, 'h', '2025-02-10')).toMatchObject({ throughDate: '2025-01-31', interestCents: 2_200, alreadyPaidCents: 4_000 });
    const over = replay([...base, payment('Y1', 'h', '2025-02-05', '70')]);
    expect(suggestLoanPayment(over, 'h', '2025-02-10')).toMatchObject({ interestCents: 0, alreadyPaidCents: 7_000 });
  });
});

describe('frozen platforms and loan-funded coins', () => {
  const entries = (): Entry[] => [
    wallet('ex'),
    wallet('bad', 'exchange', 'Bad'),
    buy('A', 'bad', '2024-01-10', '1', '50000'),
    buy('B', 'bad', '2024-01-11', '1', '30000'),
    loan('h', '2024-01-01', 0),
    link('K', 'h', 'A'),
    { id: 'F', kind: 'wallet-freeze', at: noon('2024-03-01'), tz: TZ, wallet: 'bad' },
    receive('P', 'ex', '2024-04-01', '0.5', '32000', { type: 'frozen-payout', fromWallet: 'bad' }),
    { id: 'C', kind: 'wallet-close-out', at: noon('2024-05-01'), tz: TZ, wallet: 'bad', reason: 'platform failed' },
  ];

  test('what the platform paid back by the loss date counts in the result of borrowing to buy', () => {
    const state = replay(entries());
    expect(state.errors).toEqual([]);
    const s = loanSummary(state, 'h', cents('60000'), '2024-06-01');
    // $32,000 recovered, split by cost: A $20,000, B $12,000.
    expect(s).toMatchObject({ recoveredCents: cents('20000'), overallResultCents: -cents('30000'), heldSats: 0, otherGoneSats: sats('1') });
    expect(loanPurchases(state, 'h', cents('60000'), '2024-06-01')[0]).toMatchObject({ sats: sats('1'), recoveredCents: cents('20000') });
  });

  test('payouts after the close-out are shared out the same way and counted too', () => {
    const later = receive('P2', 'ex', '2024-07-01', '0.1', '8000', { type: 'frozen-payout', fromWallet: 'bad' });
    const state = replay([...entries(), later]);
    expect(state.recoveries).toHaveLength(1);
    expect(traceCoins(state, ['A']).recovered).toEqual([{ entryId: 'P2', date: '2024-07-01', lotId: 'A', cents: cents('5000') }]);
    expect(loanSummary(state, 'h', cents('60000'), '2024-08-01')).toMatchObject({ recoveredCents: cents('25000'), overallResultCents: -cents('25000') });
    // All coins cost $0: the payout splits by sats.
    const free = replay([wallet('ex'), wallet('bad'), buy('A', 'bad', '2024-01-10', '1', '0'), buy('B', 'bad', '2024-01-11', '3', '0'), { id: 'F', kind: 'wallet-freeze', at: noon('2024-03-01'), tz: TZ, wallet: 'bad' }, { id: 'C', kind: 'wallet-close-out', at: noon('2024-05-01'), tz: TZ, wallet: 'bad', reason: 'failed' }, later]);
    expect(traceCoins(free, ['A']).recovered.map((r) => r.cents)).toEqual([cents('2000')]);
  });
});
