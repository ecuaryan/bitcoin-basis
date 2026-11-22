// @vitest-environment happy-dom
import { replay, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { loanRecordToEdit } from './loan-writer.ts';

const TZ = 'America/Boise';

describe('editing a loan record keeps its place in the timeline', () => {
  // "HELOC" is renamed "Old line"; a second loan then takes the name "HELOC". Synthetic data.
  const entries: Entry[] = [
    { id: 'L1', kind: 'loan', at: '2024-01-01T19:00:00Z', tz: TZ, loan: 'a', name: 'HELOC', opened: '2024-01-01', aprMillionths: 65_000 },
    { id: 'U1', kind: 'loan-update', at: '2024-06-01T19:00:00Z', tz: TZ, loan: 'a', name: 'Old line' },
    { id: 'L2', kind: 'loan', at: '2025-01-01T19:00:00Z', tz: TZ, loan: 'b', name: 'HELOC', opened: '2025-01-01', aprMillionths: 70_000 },
    // An earlier edit of the first loan (a new version), saved later.
    { id: 'L1b', kind: 'loan', at: '2024-01-01T19:00:00Z', tz: TZ, loan: 'a', name: 'HELOC', opened: '2023-12-01', aprMillionths: 65_000, replaces: 'L1', reason: 'Starts with its oldest purchase' },
  ];
  it('gives the current version to edit and the first version’s time', () => {
    const r = loanRecordToEdit(entries, 'a');
    expect(r?.head.id).toBe('L1b');
    expect(r?.keep).toEqual({ at: '2024-01-01T19:00:00Z', tz: TZ });
    expect(loanRecordToEdit(entries, 'nope')).toBeNull();
  });
  it('a new day count saved at that time replays; saved "now" its old name would be taken', () => {
    const { id, at, tz, ...rest } = (loanRecordToEdit(entries, 'a') as NonNullable<ReturnType<typeof loanRecordToEdit>>).head;
    void at;
    void tz;
    const edit = (when: string): Entry => ({ ...rest, dayCount: 'actual/360', id: 'L1c', at: when, tz: TZ, replaces: id, reason: 'Changed how interest is counted' });
    expect(replay([...entries, edit('2024-01-01T19:00:00Z')]).errors).toEqual([]);
    expect(replay([...entries, edit('2026-11-21T19:00:00Z')]).errors.map((e) => e.code)).toContain('loan-name-taken');
  });
});
