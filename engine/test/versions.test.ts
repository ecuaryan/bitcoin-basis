/** Edits, deletes, conflicts, duplicate ids and closed years. */
import { describe, expect, test } from 'vitest';
import { replay } from '../src/replay.ts';
import type { CloseYearEntry, DeleteEntry, Entry, UnlockYearEntry } from '../src/types.ts';
import { canonicalJson, resolveVersions } from '../src/versions.ts';
import { buy, cents, edit, errorCodes, noon, pick, sell, TZ, wallet } from './helpers.ts';

const del = (id: string, target: string, reason = 'mistake'): DeleteEntry => ({ id, kind: 'delete', at: '2026-11-01T00:00:00Z', tz: TZ, replaces: target, reason });
const closeYear = (id: string, year: number): CloseYearEntry => ({ id, kind: 'close-year', at: '2026-11-01T00:00:00Z', tz: TZ, year });
const unlockYear = (id: string, year: number): UnlockYearEntry => ({ id, kind: 'unlock-year', at: '2026-11-01T00:00:00Z', tz: TZ, year, reason: 'Amending' });

const W = wallet('ex');
const A = buy('A', 'ex', '2024-05-01', '0.1', '6000');
/** [lot id, entry version that made it, cost]: lots keep the root id; the origin is the version applied. */
const lotCosts = (entries: Entry[]): [string, string, number][] => replay(entries).lots.map((l) => [l.id, l.originEntryId, l.costCents]);

describe('edits and deletes', () => {
  test('an edit hides the original and applies the new version', () => {
    const B = edit(A, { id: 'B', reason: 'typo', costCents: cents('6100') });
    expect(lotCosts([W, A, B])).toEqual([['A', 'B', cents('6100')]]);
  });
  test('a delete removes the target from replay', () => {
    const state = replay([W, A, del('D', 'A')]);
    expect(state.lots).toEqual([]);
    expect(state.applied).toEqual(['w-ex']);
  });
  test('edit chains apply the newest version', () => {
    const B = edit(A, { id: 'B', reason: 'r', costCents: 1 });
    const C = edit(B, { id: 'C', reason: 'r', costCents: 2 });
    expect(lotCosts([W, A, B, C])).toEqual([['A', 'C', 2]]);
  });
  test('deleting the newest version removes the item', () => {
    const B = edit(A, { id: 'B', reason: 'r', costCents: 1 });
    expect(lotCosts([W, A, B, del('D', 'B')])).toEqual([]);
  });
  test('an edit may change the date, which changes replay order', () => {
    const S = sell('S', 'ex', '2024-06-01', [pick('A', '0.1')], '7000');
    const late = edit(A, { id: 'B', reason: 'wrong day', at: noon('2024-07-01') });
    const state = replay([W, A, S, late]);
    expect(errorCodes(state)).toEqual({ S: 'unknown-lot' });
  });
  test('editing an edit of a delete restores the item', () => {
    const D = del('D', 'A');
    const restore: Entry = { ...A, id: 'R', replaces: 'D', reason: 'deleted by mistake' };
    expect(lotCosts([W, A, D, restore])).toEqual([['A', 'R', cents('6000')]]);
  });
});

describe('conflicts', () => {
  const B1 = edit(A, { id: 'B1', reason: 'phone', costCents: 1 });
  const B2 = edit(A, { id: 'B2', reason: 'mac', costCents: 2 });

  test('two edits of one entry: conflict lists both; the original stays as it was', () => {
    const state = replay([W, A, B1, B2]);
    expect(state.conflicts).toEqual([{ targetId: 'A', versions: [B1, B2] }]);
    expect(lotCosts([W, A, B1, B2])).toEqual([['A', 'A', cents('6000')]]);
  });
  test('an edit and a delete of one entry also conflict', () => {
    const D = del('D', 'A');
    const state = replay([W, A, B1, D]);
    expect(state.conflicts).toEqual([{ targetId: 'A', versions: [B1, D] }]);
    expect(state.lots.map((l) => l.id)).toEqual(['A']);
  });
  test('resolved by deleting the losing version', () => {
    const state = replay([W, A, B1, B2, del('X', 'B2', 'resolved conflict')]);
    expect(state.conflicts).toEqual([]);
    expect(state.lots.map((l) => [l.id, l.originEntryId, l.costCents])).toEqual([['A', 'B1', 1]]);
  });
  test('choosing a delete over an edit: discard the edit, the item is deleted', () => {
    const state = replay([W, A, B1, del('D', 'A'), del('X', 'B1', 'keep the delete')]);
    expect(state.conflicts).toEqual([]);
    expect(state.lots).toEqual([]);
  });
  test('discarding every version leaves the original', () => {
    expect(lotCosts([W, A, B1, B2, del('X1', 'B1'), del('X2', 'B2')])).toEqual([['A', 'A', cents('6000')]]);
  });
  test('a conflict lists the newest version of each branch', () => {
    const C1 = edit(B1, { id: 'C1', reason: 'again', costCents: 3 });
    const state = replay([W, A, B1, B2, C1]);
    expect(state.conflicts).toEqual([{ targetId: 'A', versions: [C1, B2] }]);
  });
  test('a conflict over a delete keeps the item deleted', () => {
    const D = del('D', 'A');
    const r1: Entry = { ...A, id: 'R1', replaces: 'D', reason: 'restore' };
    const r2: Entry = { ...A, id: 'R2', replaces: 'D', reason: 'restore too' };
    const state = replay([W, A, D, r1, r2]);
    expect(state.conflicts.map((c) => c.targetId)).toEqual(['D']);
    expect(state.lots).toEqual([]);
  });
});

describe('invalid version graphs', () => {
  test('replacing an unknown entry is rejected, and so are edits of that edit', () => {
    const ghost = edit(A, { id: 'G', reason: 'r' });
    const orphan: Entry = { ...ghost, replaces: 'nope' };
    const child = edit(orphan, { id: 'H', reason: 'r' });
    const state = replay([W, orphan, child]);
    expect(errorCodes(state)).toEqual({ G: 'replaces-unknown', H: 'replaces-unknown' });
  });
  test('cycles are rejected', () => {
    const x: Entry = { ...A, id: 'X', replaces: 'Y', reason: 'r' };
    const y: Entry = { ...A, id: 'Y', replaces: 'X', reason: 'r' };
    expect(errorCodes(replay([W, x, y]))).toEqual({ X: 'replace-cycle', Y: 'replace-cycle' });
  });
  test('identical copies of an id are fine; different contents with one id reject it', () => {
    expect(replay([W, A, { ...A }]).errors).toEqual([]);
    const state = replay([W, A, { ...A, costCents: 1 }]);
    expect(errorCodes(state)).toEqual({ A: 'duplicate-id' });
    expect(state.lots).toEqual([]);
  });
  test('invalid entries are reported and skipped', () => {
    const state = replay([W, A, { ...A, id: 'bad', sats: -1 }, 42 as unknown as Entry, null as unknown as Entry]);
    expect(state.errors).toEqual([
      { entryId: '', code: 'invalid-entry', message: 'entry must be an object' },
      { entryId: '', code: 'invalid-entry', message: 'entry must be an object' },
      { entryId: 'bad', code: 'invalid-entry', message: 'invalid "sats"' },
    ]);
    expect(state.lots.map((l) => l.id)).toEqual(['A']);
  });
  test('canonicalJson ignores key order', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: null, c: 'x' }] })).toBe(canonicalJson({ a: [1, { c: 'x', d: null }], b: 1 }));
  });
});

describe('closed years', () => {
  // Ids compare in creation order: "a…" before "k…" (close) before "m…" (later).
  const early = buy('a-2025', 'ex', '2025-03-01', '0.1', '5000');
  const close = closeYear('k-close', 2025);

  test('entries created before the year was closed still apply', () => {
    const state = replay([W, early, close]);
    expect(state.closedYears).toEqual([2025]);
    expect(state.lots.map((l) => l.id)).toEqual(['a-2025']);
  });
  test('a new entry dated in a closed year is rejected; other years are fine', () => {
    const late = buy('m-2025', 'ex', '2025-04-01', '0.1', '5000');
    const ok2026 = buy('m-2026', 'ex', '2026-01-02', '0.1', '5000');
    const state = replay([W, early, close, late, ok2026]);
    expect(errorCodes(state)).toEqual({ 'm-2025': 'closed-year' });
    expect(state.errors[0]?.message).toBe('2025 is closed; unlock it first');
  });
  test('editing or deleting an entry in a closed year is rejected', () => {
    const fix = edit(early, { id: 'm-fix', reason: 'typo', costCents: 1 });
    const move = edit(buy('a-2026', 'ex', '2026-02-01', '0.1', '5000'), { id: 'm-move', reason: 'wrong year', at: noon('2025-12-01') });
    const state = replay([W, early, buy('a-2026', 'ex', '2026-02-01', '0.1', '5000'), close, fix, del('m-del', 'a-2025'), move]);
    expect(errorCodes(state)).toEqual({ 'm-fix': 'closed-year', 'm-del': 'closed-year', 'm-move': 'closed-year' });
    expect(state.lots.map((l) => l.id)).toEqual(['a-2025', 'a-2026']);
  });
  test('unlocking with a reason allows changes; closing again locks', () => {
    const fix = edit(early, { id: 'n-fix', reason: 'typo', costCents: 1 });
    const later = edit(fix, { id: 'q-fix', reason: 'again', costCents: 2 });
    const state = replay([W, early, close, unlockYear('m-unlock', 2025), fix, closeYear('p-close', 2025), later]);
    expect(errorCodes(state)).toEqual({ 'q-fix': 'closed-year' });
    expect(state.lots.map((l) => [l.id, l.originEntryId, l.costCents])).toEqual([['a-2025', 'n-fix', 1]]);
    expect(state.closedYears).toEqual([2025]);
    expect(replay([W, close, unlockYear('m-unlock', 2025)]).closedYears).toEqual([]);
    expect(replay([W, close, closeYear('k-2024', 2024), closeYear('k-2023', 2023), unlockYear('z', 2023)]).closedYears).toEqual([2024, 2025]);
  });
  test('opening lots, wallets and settings may arrive in a closed year', () => {
    const opening: Entry = { id: 'm-open', kind: 'opening-lot', at: '2025-01-05T00:00:00Z', tz: TZ, wallet: 'ex', acquiredAt: '2025-01-05T00:00:00Z', sats: 10, costCents: 1, tier: 'estimated', origin: 'Spreadsheet' };
    const w2: Entry = { ...wallet('cold', 'self-custody'), id: 'm-wallet', at: '2025-01-01T00:00:00Z' };
    const s: Entry = { id: 'm-set', kind: 'settings', at: '2025-06-01T00:00:00Z', tz: TZ, patch: { wagesCents: 1 } };
    const state = replay([W, close, opening, w2, s]);
    expect(state.errors).toEqual([]);
    expect(state.lots.map((l) => l.id)).toEqual(['m-open']);
  });
  test("a close-out's loss date counts too", () => {
    const freeze: Entry = { id: 'b-freeze', kind: 'wallet-freeze', at: noon('2026-01-02'), tz: TZ, wallet: 'ex' };
    const closeOut: Entry = { id: 'm-out', kind: 'wallet-close-out', at: noon('2026-02-01'), tz: TZ, wallet: 'ex', lossDate: '2025-12-31', reason: 'Plan' };
    expect(errorCodes(replay([W, early, freeze, close, closeOut]))).toEqual({ 'm-out': 'closed-year' });
  });
  test('year closings cannot be edited or deleted', () => {
    const state = replay([W, close, del('m-del', 'k-close')]);
    expect(errorCodes(state)).toEqual({ 'm-del': 'cannot-replace' });
    expect(state.closedYears).toEqual([2025]);
  });
  test('resolution is independent of input order', () => {
    const entries: Entry[] = [W, early, close, buy('m-2025', 'ex', '2025-04-01', '0.1', '5000'), edit(early, { id: 'b-fix', reason: 'r', costCents: 7 })];
    const a = resolveVersions(entries);
    const b = resolveVersions([...entries].reverse());
    expect(b).toEqual(a);
  });
});
