/**
 * Targeted tests added from mutation testing (`npm run mutate`) for versions.ts: each pins down behavior a
 * surviving mutant changed (closed-year locks, wallet-in-use checks, chain and conflict resolution).
 */
import { describe, expect, test } from 'vitest';
import type { CloseYearEntry, DeleteEntry, Entry, GivingPaidEntry, LoanEntry, LoanPaymentEntry, OpeningLotEntry, UnlockYearEntry } from '../src/types.ts';
import { resolveVersions } from '../src/versions.ts';
import { buy, cents, edit, noon, receive, sats, TZ, wallet } from './helpers.ts';

const del = (id: string, target: string): DeleteEntry => ({ id, kind: 'delete', at: '2026-11-01T00:00:00Z', tz: TZ, replaces: target, reason: 'mistake' });
const closeYear = (id: string, year: number): CloseYearEntry => ({ id, kind: 'close-year', at: '2026-11-01T00:00:00Z', tz: TZ, year });
const unlockYear = (id: string, year: number): UnlockYearEntry => ({ id, kind: 'unlock-year', at: '2026-11-01T00:00:00Z', tz: TZ, year, reason: 'Amending' });
const opening = (id: string, w: string, date: string, acquired: string): OpeningLotEntry => ({ id, kind: 'opening-lot', at: noon(date), tz: TZ, wallet: w, acquiredAt: noon(acquired), sats: sats('1'), costCents: cents('100'), tier: 'estimated', origin: 'note' });
const codes = (r: { errors: readonly { entryId: string; code: string }[] }): [string, string][] => r.errors.map((e) => [e.entryId, e.code]);

describe('closed years and opening lots', () => {
  const base = [wallet('ex'), opening('o1', 'ex', '2024-02-01', '2023-01-01'), closeYear('p-close', 2024)];
  test('a new opening lot is allowed in a closed year, but editing or deleting one is not', () => {
    expect(codes(resolveVersions([...base, opening('q-new', 'ex', '2024-03-01', '2022-01-01')]))).toEqual([]);
    const editOpening: Entry = { ...opening('q-edit', 'ex', '2024-02-01', '2023-01-01'), replaces: 'o1', reason: 'fix' };
    expect(codes(resolveVersions([...base, editOpening]))).toEqual([['q-edit', 'closed-year']]);
    expect(codes(resolveVersions([...base, del('q-del', 'o1')]))).toEqual([['q-del', 'closed-year']]);
  });
  test('an edit that moves an opening lot into a closed year is refused, and one that stays out of it is not blocked by a later freeze', () => {
    const open = [wallet('ex'), opening('o1', 'ex', '2025-02-01', '2025-01-01'), closeYear('p-close', 2024)];
    const movedAt: Entry = { ...opening('q-edit', 'ex', '2024-02-01', '2025-01-01'), replaces: 'o1', reason: 'fix' };
    const movedAcquired: Entry = { ...opening('q-edit', 'ex', '2025-02-01', '2024-01-01'), replaces: 'o1', reason: 'fix' };
    expect(codes(resolveVersions([...open, movedAt]))).toEqual([['q-edit', 'closed-year']]);
    expect(codes(resolveVersions([...open, movedAcquired]))).toEqual([['q-edit', 'closed-year']]);
    const frozenLater = [wallet('ex'), opening('o1', 'ex', '2024-01-10', '2023-01-01'), { id: 'f1', kind: 'wallet-freeze', at: noon('2025-06-01'), tz: TZ, wallet: 'ex' } as Entry, closeYear('p-close', 2025)];
    const same: Entry = { ...opening('q-edit', 'ex', '2024-01-10', '2023-01-01'), replaces: 'o1', reason: 'fix' };
    expect(codes(resolveVersions([...frozenLater, same]))).toEqual([]);
  });
  test('a close-out of the wallet in a closed year also locks new opening lots dated before it', () => {
    const co: Entry = { id: 'c1', kind: 'wallet-close-out', at: noon('2024-09-01'), tz: TZ, wallet: 'ex', reason: 'plan' };
    const entries = [wallet('ex'), co, closeYear('p-close', 2024)];
    expect(codes(resolveVersions([...entries, opening('q-new', 'ex', '2024-04-01', '2022-01-01')]))).toEqual([['q-new', 'closed-year']]);
    expect(codes(resolveVersions([...entries, opening('q-new', 'ex', '2024-10-01', '2022-01-01')]))).toEqual([]);
  });
  test('a new opening lot is refused when a freeze or close-out of its wallet on or after its date is in a closed year', () => {
    const freeze: Entry = { id: 'f1', kind: 'wallet-freeze', at: noon('2024-05-01'), tz: TZ, wallet: 'ex' };
    const closed = [wallet('ex'), freeze, closeYear('p-close', 2024)];
    // same day as the freeze: still locked (on or after)
    expect(codes(resolveVersions([...closed, opening('q-new', 'ex', '2024-05-01', '2022-01-01')]))).toEqual([['q-new', 'closed-year']]);
    // before the freeze: locked
    expect(codes(resolveVersions([...closed, opening('q-new', 'ex', '2024-04-01', '2022-01-01')]))).toEqual([['q-new', 'closed-year']]);
    // after the freeze: not locked by it
    expect(codes(resolveVersions([...closed, opening('q-new', 'ex', '2024-06-01', '2022-01-01')]))).toEqual([]);
  });
  test('only freezes and close-outs of the same wallet count, and other entry kinds are not opening lots', () => {
    const otherFreeze: Entry = { id: 'f1', kind: 'wallet-freeze', at: noon('2024-05-01'), tz: TZ, wallet: 'cold' };
    const sameWalletBuy = buy('b1', 'ex', '2024-05-01', '1', '100');
    expect(codes(resolveVersions([wallet('ex'), wallet('cold'), otherFreeze, sameWalletBuy, closeYear('p-close', 2024), opening('q-new', 'ex', '2024-04-01', '2022-01-01')]))).toEqual([]);
    // a buy dated before a freeze in a closed year is judged only by its own year
    const freeze: Entry = { id: 'f1', kind: 'wallet-freeze', at: noon('2024-05-01'), tz: TZ, wallet: 'ex' };
    expect(codes(resolveVersions([wallet('ex'), freeze, closeYear('p-close', 2024), buy('q-buy', 'ex', '2023-06-01', '1', '100')]))).toEqual([]);
  });
  test('closing, unlocking and reclosing: only year-closing entries change the lock, and years are listed ascending', () => {
    const giving: GivingPaidEntry = { id: 'b-giving', kind: 'giving-paid', at: noon('2024-06-01'), tz: TZ, year: 2024, cents: 100 };
    const r = resolveVersions([wallet('ex'), closeYear('a-close', 2024), giving, buy('c-buy', 'ex', '2024-03-01', '1', '100')]);
    expect(codes(r)).toEqual([['c-buy', 'closed-year']]);
    // raw order does not matter: events apply in id order; the unlock (later id) wins
    const unlocked = resolveVersions([unlockYear('b-unlock', 2024), closeYear('a-close', 2024), buy('c-buy', 'ex', '2024-03-01', '1', '100'), wallet('ex')]);
    expect(codes(unlocked)).toEqual([]);
    expect(unlocked.closedYears).toEqual([]);
    expect(resolveVersions([closeYear('a', 2025), closeYear('c', 2023), closeYear('b', 2024), unlockYear('d', 2024)]).closedYears).toEqual([2023, 2025]);
    expect(resolveVersions([closeYear('a', 2025), closeYear('b', 2024), closeYear('c', 2023)]).closedYears).toEqual([2023, 2024, 2025]);
  });
  test('closing or unlocking a year cannot be deleted or replaced', () => {
    expect(codes(resolveVersions([closeYear('a-close', 2024), del('b-del', 'a-close')]))).toEqual([['b-del', 'cannot-replace']]);
    expect(codes(resolveVersions([unlockYear('a-unlock', 2024), del('b-del', 'a-unlock')]))).toEqual([['b-del', 'cannot-replace']]);
    const asBuy: Entry = { ...buy('b-buy', 'ex', '2025-01-01', '1', '100'), replaces: 'a-close', reason: 'x' };
    expect(codes(resolveVersions([wallet('ex'), closeYear('a-close', 2024), asBuy]))).toEqual([['b-buy', 'cannot-replace']]);
  });
  test('an edit is judged against every earlier version: an old version in a closed year blocks it', () => {
    const a = buy('a-buy', 'ex', '2023-03-01', '1', '100');
    const v2 = edit(a, { id: 'c-v2', reason: 'fix', at: noon('2025-03-01') });
    const r = resolveVersions([wallet('ex'), a, closeYear('b-close', 2023), v2]);
    expect(codes(r)).toEqual([['c-v2', 'closed-year']]);
  });
});

describe('what counts as using a wallet', () => {
  const deleteWallet = (extra: Entry[]): [string, string][] => codes(resolveVersions([wallet('a'), wallet('b'), ...extra, del('z-del', 'w-a')]));
  test('an unused wallet can be deleted', () => {
    expect(deleteWallet([])).toEqual([]);
  });
  test('a move\'s source and destination each count', () => {
    const mv = (from: string, to: string): Entry => ({ id: 'm', kind: 'move', at: noon('2025-01-01'), tz: TZ, from, to, sats: 1, feeSats: 0, feeValueCents: 0, picks: [{ lotId: 'x', sats: 1 }] });
    expect(deleteWallet([mv('a', 'b')])).toEqual([['z-del', 'cannot-replace']]);
    expect(deleteWallet([mv('b', 'a')])).toEqual([['z-del', 'cannot-replace']]);
  });
  test('the wallet a frozen payout came from counts, as does the receiving wallet', () => {
    expect(deleteWallet([receive('r', 'b', '2025-01-01', '0.1', '10', { type: 'frozen-payout', fromWallet: 'a' })])).toEqual([['z-del', 'cannot-replace']]);
    expect(deleteWallet([receive('r', 'a', '2025-01-01', '0.1', '10', { type: 'income' })])).toEqual([['z-del', 'cannot-replace']]);
    expect(deleteWallet([receive('r', 'b', '2025-01-01', '0.1', '10', { type: 'income' })])).toEqual([]);
  });
  test('any entry carrying a wallet counts (a balance confirmation)', () => {
    expect(deleteWallet([{ id: 'c', kind: 'balance-confirm', at: noon('2025-01-01'), tz: TZ, wallet: 'a', sats: 0 }])).toEqual([['z-del', 'cannot-replace']]);
  });
  test('a wallet id or type cannot change by edit', () => {
    const renamed: Entry = { ...wallet('a'), id: 'w-a2', name: 'Renamed', replaces: 'w-a', reason: 'rename' };
    expect(codes(resolveVersions([wallet('a'), renamed]))).toEqual([]);
    expect(codes(resolveVersions([wallet('a'), { ...renamed, type: 'self-custody' }]))).toEqual([['w-a2', 'cannot-replace']]);
    expect(codes(resolveVersions([wallet('a'), { ...renamed, wallet: 'other' }]))).toEqual([['w-a2', 'cannot-replace']]);
  });
});

describe('coin and loan records replacing each other', () => {
  test('a coin record may replace a coin record of another kind', () => {
    const a = buy('a', 'ex', '2025-01-01', '0.1', '100');
    const asReceive: Entry = { ...receive('b', 'ex', '2025-01-01', '0.1', '100', { type: 'income' }), replaces: 'a', reason: 'it was income' };
    expect(codes(resolveVersions([wallet('ex'), a, asReceive]))).toEqual([]);
  });
  test('a loan record only replaces the same kind; a loan cannot be deleted while a live record names it, but can after that record is deleted', () => {
    const loan: LoanEntry = { id: 'l', kind: 'loan', at: noon('2025-01-01'), tz: TZ, loan: 'h', name: 'HELOC', opened: '2025-01-01', aprMillionths: 65_000 };
    const pay: LoanPaymentEntry = { id: 'p', kind: 'loan-payment', at: noon('2025-02-01'), tz: TZ, loan: 'h', interestCents: 100, principalCents: 0 };
    const asBuy: Entry = { ...buy('q', 'ex', '2025-02-01', '1', '100'), replaces: 'p', reason: 'wrong kind' };
    expect(codes(resolveVersions([wallet('ex'), loan, pay, asBuy]))).toEqual([['q', 'cannot-replace']]);
    expect(codes(resolveVersions([loan, pay, del('z-loan', 'l')]))).toEqual([['z-loan', 'cannot-replace']]);
    // the payment is deleted by an earlier-sorting entry; the loan is then free to delete
    expect(codes(resolveVersions([loan, pay, del('y-pay', 'p'), del('z-loan', 'l')]))).toEqual([]);
    // an edited payment: only its latest version names the loan, and it still does
    const pay2: Entry = { ...pay, id: 'p2', replaces: 'p', reason: 'x' };
    expect(codes(resolveVersions([loan, pay, pay2, del('z-loan', 'l')]))).toEqual([['z-loan', 'cannot-replace']]);
  });
});

describe('invalid entries and chains', () => {
  test('invalid raw entries are reported under their id, or an empty id when there is none', () => {
    const r = resolveVersions([{ id: 'bad-1', kind: 'nope' }, null, 'text', { id: 5, kind: 'buy' }, { kind: 'buy' }]);
    expect(r.errors.map((e) => [e.entryId, e.code])).toEqual([['', 'invalid-entry'], ['', 'invalid-entry'], ['', 'invalid-entry'], ['', 'invalid-entry'], ['bad-1', 'invalid-entry']]);
  });
  test('edits that form a cycle are reported once each, even when a third entry hangs off the cycle', () => {
    const w = wallet('ex');
    const a = buy('a', 'ex', '2025-01-01', '1', '100');
    const x: Entry = { ...a, id: 'x', replaces: 'y', reason: 'r' };
    const y: Entry = { ...a, id: 'y', replaces: 'x', reason: 'r' };
    const tail: Entry = { ...a, id: 'e', replaces: 'x', reason: 'r' };
    const r = resolveVersions([w, a, x, y, tail]);
    expect(r.applied.map((e) => e.id)).toEqual(['a', 'w-ex'].sort());
    expect(codes(r)).toEqual([['e', 'replace-cycle'], ['x', 'replace-cycle'], ['y', 'replace-cycle']]);
  });
  test('an edit of a missing entry is dropped, and so is every edit built on it, whatever their id order', () => {
    const a = buy('a', 'ex', '2025-01-01', '1', '100');
    const e3: Entry = { ...a, id: 'c', replaces: 'd', reason: 'r' };
    const e2: Entry = { ...a, id: 'd', replaces: 'missing', reason: 'r' };
    const e1: Entry = { ...a, id: 'e', replaces: 'c', reason: 'r' };
    // sorted by id: c (replaces d), d (replaces missing), e (replaces c): dropping d orphans c, which orphans e
    const r = resolveVersions([e1, e2, e3]);
    expect(codes(r)).toEqual([['c', 'replaces-unknown'], ['d', 'replaces-unknown'], ['e', 'replaces-unknown']]);
    expect(r.applied).toEqual([]);
  });
  test('when both branches of an entry were deleted by later entries the original stands, with no conflict', () => {
    const a = buy('a', 'ex', '2025-01-01', '1', '100');
    const b1 = edit(a, { id: 'b1', reason: 'r' });
    const b2 = edit(a, { id: 'b2', reason: 'r' });
    const r = resolveVersions([wallet('ex'), a, b1, b2, del('d1', 'b1'), del('d2', 'b2')]);
    expect(r.conflicts).toEqual([]);
    expect(r.applied.map((e) => e.id)).toEqual(['a', 'w-ex']);
    // one branch deleted: the other wins, still no conflict
    const one = resolveVersions([wallet('ex'), a, b1, b2, del('d1', 'b1')]);
    expect(one.conflicts).toEqual([]);
    expect(one.applied.map((e) => e.id)).toEqual(['b2', 'w-ex']);
  });
  test('two live branches conflict and list both, and the root is applied', () => {
    const a = buy('a', 'ex', '2025-01-01', '1', '100');
    const b1 = edit(a, { id: 'b1', reason: 'r' });
    const b2 = edit(a, { id: 'b2', reason: 'r' });
    const r = resolveVersions([wallet('ex'), a, b1, b2]);
    expect(r.conflicts).toEqual([{ targetId: 'a', versions: [b1, b2] }]);
    expect(r.applied.map((e) => e.id)).toEqual(['a', 'w-ex']);
  });
});
