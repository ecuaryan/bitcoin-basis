import { describe, expect, it } from 'vitest';
import { newestFirst } from './newest-first.ts';

describe('newestFirst', () => {
  it('puts the latest date first and keeps the order of equal dates', () => {
    const list = [{ d: '2025-01-02', n: 1 }, { d: '2026-03-01', n: 2 }, { d: '2025-01-02', n: 3 }];
    expect(newestFirst(list, (x) => x.d).map((x) => x.n)).toEqual([2, 1, 3]);
    expect(list.map((x) => x.n)).toEqual([1, 2, 3]);
  });
});
