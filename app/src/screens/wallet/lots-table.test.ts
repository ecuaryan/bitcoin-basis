import { describe, expect, it } from 'vitest';
import type { Lot } from '@bitcoin-basis/engine';
import { lotGroups, longTermOn, LOTS_SHOWN } from './LotsTable.tsx';

function lot(id: string, acquiredDate: string, extra: Partial<Lot> = {}): Lot {
  return { id, acquiredDate, acquiredAt: `${acquiredDate}T12:00:00Z`, sats: 1000, costCents: 100, tier: 'documented', ...extra } as Lot;
}

describe('lotGroups', () => {
  const today = '2026-11-22';

  it('puts short-term first, then long-term, each newest first', () => {
    const g = lotGroups([lot('a', '2024-01-05'), lot('b', '2026-03-30'), lot('c', '2025-06-01'), lot('d', '2026-11-14')], today, true);
    expect(g.short.map((l) => l.id)).toEqual(['d', 'b']);
    expect(g.long.map((l) => l.id)).toEqual(['c', 'a']);
    expect(g.total).toBe(4);
  });

  it('groups by term, not by date: a lot that is always long-term sits with the long-term ones', () => {
    const g = lotGroups([lot('gift', '2026-10-01', { alwaysLongTerm: true }), lot('buy', '2026-09-01')], today, true);
    expect(g.short.map((l) => l.id)).toEqual(['buy']);
    expect(g.long.map((l) => l.id)).toEqual(['gift']);
  });

  it('shows the first few across both groups until Show all', () => {
    const many = Array.from({ length: 12 }, (_, i) => lot(`s${i}`, `2026-0${(i % 9) + 1}-1${i % 10}`));
    const old = [lot('old', '2020-01-01')];
    const some = lotGroups([...many, ...old], today, false);
    expect(some.short.length + some.long.length).toBe(LOTS_SHOWN);
    expect(some.long).toEqual([]);
    expect(some.total).toBe(13);
    const few = lotGroups([lot('x', '2026-10-01'), ...old], today, false);
    expect(few.long.map((l) => l.id)).toEqual(['old']);
  });
});

describe('longTermOn', () => {
  it('is the day after the one-year anniversary, with its year', () => {
    expect(longTermOn({ acquiredDate: '2026-03-30' })).toBe('Long-term on Mar 31, 2027');
    expect(longTermOn({ acquiredDate: '2024-02-29' })).toBe('Long-term on Mar 1, 2025');
  });
});
