/**
 * Closed years and version rules beyond the basics in versions.test.ts (from an adversarial review).
 * Ids compare in creation order: "a…" (before the close) < "k-close" < "m…" (after the close). Synthetic data only.
 */
import { describe, expect, test } from 'vitest';
import { replay } from '../src/replay.ts';
import { yearSummary } from '../src/reports.ts';
import { parseEntry } from '../src/validate.ts';
import type { Entry } from '../src/types.ts';
import { buy, cents, edit, errorCodes, noon, pick, receive, sell, TZ, wallet } from './helpers.ts';

const closeYear = (id: string, year: number): Entry => ({ id, kind: 'close-year', at: noon(`${year + 1}-01-15`), tz: TZ, year });
const W = { ...wallet('ex'), id: 'a-w' } as Entry;
const B = buy('a-buy', 'ex', '2024-01-10', '1', '40000');
const S = sell('a-sell', 'ex', '2025-06-01', [pick('a-buy', '0.5')], '50000');
const CLOSE = closeYear('k-close', 2025);
const year2025 = (entries: Entry[]): { st: number; lt: number; n: number } => {
  const y = yearSummary(replay(entries), 2025);
  return { st: y.stGainCents, lt: y.ltGainCents, n: y.disposals.length };
};
const BASE = year2025([W, B, S, CLOSE]);

describe('entries exempt from the closed-year rule cannot change a closed year', () => {
  test('baseline: the 2025 sale is a $30,000 long-term gain', () => {
    expect(BASE).toEqual({ st: 0, lt: cents('30000'), n: 1 });
  });
  test('a wallet-freeze dated in the closed year, created after the close, is rejected', () => {
    const freeze: Entry = { id: 'm-freeze', kind: 'wallet-freeze', at: noon('2025-01-01'), tz: TZ, wallet: 'ex' };
    expect(errorCodes(replay([W, B, S, CLOSE, freeze]))).toEqual({ 'm-freeze': 'closed-year' });
    expect(year2025([W, B, S, CLOSE, freeze])).toEqual(BASE);
  });
  test('a wallet with activity cannot be deleted; an unused one can', () => {
    const d: Entry = { id: 'm-del', kind: 'delete', at: noon('2026-03-01'), tz: TZ, replaces: 'a-w', reason: 'cleanup' };
    expect(errorCodes(replay([W, B, S, CLOSE, d]))).toEqual({ 'm-del': 'cannot-replace' });
    expect(year2025([W, B, S, CLOSE, d])).toEqual(BASE);
    const settings: Entry = { id: 'a-set', kind: 'settings', at: noon('2025-01-01'), tz: TZ, patch: { wagesCents: 1 } };
    const unused = replay([W, settings, d]);
    expect(unused.errors).toEqual([]);
    expect(unused.wallets).toEqual([]);
  });
  test("a wallet's type and id are fixed; its name and default proof can be edited", () => {
    const toRetirement = { ...W, id: 'm-wedit', type: 'retirement', replaces: 'a-w', reason: 'oops' } as Entry;
    expect(errorCodes(replay([W, B, S, CLOSE, toRetirement]))).toEqual({ 'm-wedit': 'cannot-replace' });
    expect(year2025([W, B, S, CLOSE, toRetirement])).toEqual(BASE);
    const newId = { ...W, id: 'm-wid', wallet: 'other', replaces: 'a-w', reason: 'oops' } as Entry;
    const otherKind: Entry = { ...B, id: 'm-kind', replaces: 'a-w', reason: 'oops' };
    expect(errorCodes(replay([W, B, newId, otherKind]))).toEqual({ 'm-wid': 'cannot-replace', 'm-kind': 'cannot-replace' });
    const renamed = { ...W, id: 'm-name', name: 'Main exchange', defaultProof: 'CSV export', replaces: 'a-w', reason: 'rename' } as Entry;
    expect(replay([W, B, S, CLOSE, renamed]).wallets[0]).toMatchObject({ name: 'Main exchange', defaultProof: 'CSV export' });
  });
  test('editing or deleting an opening lot needs its year unlocked (opening lots arrive in closed years)', () => {
    const open: Entry = { id: 'a-open', kind: 'opening-lot', at: '2025-01-10T19:00:00Z', tz: TZ, wallet: 'ex', acquiredAt: '2025-01-10T19:00:00Z', sats: 50_000_000, costCents: cents('20000'), tier: 'estimated', origin: 'sheet' };
    const s: Entry = sell('a-sell2', 'ex', '2025-07-01', [{ lotId: 'a-open', sats: 50_000_000 }], '50000');
    const before = year2025([W, open, s, CLOSE]);
    const fix = { ...open, id: 'm-open-fix', costCents: cents('1'), replaces: 'a-open', reason: 'better record' } as Entry;
    const del: Entry = { id: 'm-open-del', kind: 'delete', at: noon('2026-03-01'), tz: TZ, replaces: 'a-open', reason: 'dupe' };
    expect(errorCodes(replay([W, open, s, CLOSE, fix]))).toEqual({ 'm-open-fix': 'closed-year' });
    expect(errorCodes(replay([W, open, s, CLOSE, del]))).toEqual({ 'm-open-del': 'closed-year' });
    expect(year2025([W, open, s, CLOSE, fix])).toEqual(before);
    // A new opening lot dated in the closed year is still fine.
    expect(replay([W, CLOSE, { ...open, id: 'm-open2' } as Entry]).errors).toEqual([]);
  });
  test('a frozen-platform payout dated after the loss date is a recovery, not a smaller closed-year loss', () => {
    const entries: Entry[] = [
      W, { ...wallet('cel'), id: 'a-wcel' } as Entry, buy('a-cel', 'cel', '2023-01-01', '1', '40000'),
      { id: 'a-freeze', kind: 'wallet-freeze', at: noon('2025-06-01'), tz: TZ, wallet: 'cel' },
      // Close-out logged in 2026 with the loss dated 2025-12-31 (entered before 2025 was closed).
      { id: 'a-out', kind: 'wallet-close-out', at: noon('2026-03-01'), tz: TZ, wallet: 'cel', lossDate: '2025-12-31', reason: 'plan' },
      CLOSE,
    ];
    const before = year2025(entries);
    expect(before.lt).toBe(cents('-40000'));
    // Added after the close; dated 2026 (open) but before the close-out entry's own time.
    const payout = receive('m-pay', 'ex', '2026-02-01', '0.1', '9000', { type: 'frozen-payout', fromWallet: 'cel' });
    expect(year2025([...entries, payout])).toEqual(before);
    expect(yearSummary(replay([...entries, payout]), 2026).ltGainCents).toBe(cents('9000'));
  });
});

describe('ids', () => {
  test('ids are letters, digits, _ and - (no ":"), so derived lot ids cannot collide', () => {
    expect(parseEntry(buy('0', 'ex', '2025-01-01', '1', '1')).ok).toBe(true);
    expect(parseEntry(buy('M:0', 'ex', '2025-01-01', '1', '1')).ok).toBe(false);
  });
  test('the lock goes by id order: a guard against mistakes, not a hostile writer (ids are client-made)', () => {
    const late = sell('z-late', 'ex', '2025-09-01', [pick('a-buy', '0.5')], '1');
    expect(errorCodes(replay([W, B, S, CLOSE, late]))).toEqual({ 'z-late': 'closed-year' });
    // An id that sorts before the close is taken as written before it. Documented in Decision 10.
    const backdated = sell('0000-late', 'ex', '2025-09-01', [pick('a-buy', '0.5')], '1');
    expect(replay([W, B, S, CLOSE, backdated]).errors).toEqual([]);
  });
});

describe('determinism and lot identity', () => {
  test('two wallet entries creating the same wallet id: result does not depend on input order', () => {
    const w1 = { ...wallet('ex', 'exchange', 'One'), id: 'a-w1' } as Entry;
    const w2 = { ...wallet('ex', 'self-custody', 'Two'), id: 'a-w2' } as Entry;
    expect(replay([w2, w1])).toEqual(replay([w1, w2]));
  });
  test('an edit that changes only the cost keeps the lot id (so saved picks stay valid)', () => {
    const fix = edit(B, { id: 'a-fix', reason: 'typo', costCents: cents('40001') });
    const state = replay([W, B, fix]);
    expect(state.lots.map((l) => [l.id, l.originEntryId, l.costCents])).toEqual([['a-buy', 'a-fix', cents('40001')]]);
  });
});
