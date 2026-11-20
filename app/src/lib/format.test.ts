import { describe, expect, it } from 'vitest';
import { formatMoney, groupedBtc, groupedSats, maskDigits, satsToCents, shortBtc, shortDate } from './format.ts';

describe('format', () => {
  it('groups BTC in fours', () => {
    expect(groupedBtc(336_672_105)).toBe('3.3667 2105');
    expect(groupedBtc(742_665)).toBe('0.0074 2665');
    expect(groupedBtc(0)).toBe('0.0000 0000');
  });
  it('groups sats', () => {
    expect(groupedSats(336_672_105)).toBe('336,672,105');
  });
  it('shortens BTC to four places', () => {
    expect(shortBtc(118_018_000)).toBe('1.1802');
    expect(shortBtc(50_135_105)).toBe('0.5014');
  });
  it('formats money', () => {
    expect(formatMoney(123_456)).toBe('$1,234.56');
    expect(formatMoney(-123_456)).toBe('-$1,234.56');
    expect(formatMoney(31_920_690, { precision: 'dollars' })).toBe('$319,206');
    expect(formatMoney(18_032_905, { precision: 'dollars', signed: true })).toBe('+$180,329');
    expect(formatMoney(-50, { precision: 'dollars' })).toBe('$0');
    expect(formatMoney(5)).toBe('$0.05');
  });
  it('masks digits only', () => {
    expect(maskDigits('$319,206')).toBe('$•••,•••');
  });
  it('values sats at a price in whole cents', () => {
    expect(satsToCents(336_672_105, 9_481_240)).toBe(31_920_690);
  });
  it('writes short dates', () => {
    expect(shortDate('2026-11-02', '2026-11-20')).toBe('Nov 2');
    expect(shortDate('2025-10-30', '2026-11-20')).toBe('Oct 30, 2025');
  });
});
