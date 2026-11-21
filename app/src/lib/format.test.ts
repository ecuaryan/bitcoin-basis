import { describe, expect, it } from 'vitest';
import { cleanDecimal, countOf, formatDay, formatMoney, formatWhen, groupedBtc, groupedSats, maskDigits, prettyBtc, prettyDollars, satsToCents, shortBtc, shortDate } from './format.ts';

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
    expect(formatMoney(-123_456)).toBe('\u2212$1,234.56');
    expect(formatMoney(31_920_690, { precision: 'dollars' })).toBe('$319,206');
    expect(formatMoney(18_032_905, { precision: 'dollars', signed: true })).toBe('+$180,329');
    expect(formatMoney(-50, { precision: 'dollars' })).toBe('$0');
    expect(formatMoney(5)).toBe('$0.05');
  });
  it('masks every amount to one fixed shape, so size never shows', () => {
    expect(maskDigits('$319,206')).toBe('$•••••');
    expect(maskDigits('$0.00')).toBe('$•••••');
    expect(maskDigits('$1,000,000.00')).toBe('$•••••');
    expect(maskDigits('\u2212$4.10')).toBe('\u2212$•••••');
    expect(maskDigits('+$180,329')).toBe('+$•••••');
    expect(maskDigits('0.0074 2665')).toBe('•.•••• ••••');
    expect(maskDigits('12.0000 0000 BTC')).toBe('•.•••• •••• BTC');
    expect(maskDigits('1.1802')).toBe('•.•••• ••••');
    expect(maskDigits('336,672,105 sats')).toBe('••••••• sats');
    expect(maskDigits('5')).toBe('•••••••');
  });
  it('values sats at a price in whole cents', () => {
    expect(satsToCents(336_672_105, 9_481_240)).toBe(31_920_690);
  });
  it('writes short dates', () => {
    expect(shortDate('2026-11-02', '2026-11-20')).toBe('Nov 2');
    expect(shortDate('2025-10-30', '2026-11-20')).toBe('Oct 30, 2025');
  });
  it('puts a thousands separator in big BTC amounts', () => {
    expect(groupedBtc(123_456_789_012_345)).toBe('1,234,567.8901 2345');
  });
  it('counts with the right noun', () => {
    expect(countOf(1, 'lot')).toBe('1 lot');
    expect(countOf(0, 'lot')).toBe('0 lots');
    expect(countOf(2, 'coin')).toBe('2 coins');
  });
  it('shows one date style everywhere', () => {
    const now = Date.parse('2026-11-20T23:00:00Z');
    expect(formatWhen('2026-11-20T22:55:00Z', now, 'UTC')).toBe('Today, 10:55 PM');
    expect(formatWhen('2026-11-20T17:55:00Z', now, 'America/Chicago')).toBe('Today, 11:55 AM');
    expect(formatWhen('2025-03-02T00:05:00Z', now, 'UTC')).toBe('Mar 2, 2025 \u00b7 12:05 AM');
    expect(formatDay('2026-11-20', '2026-11-20')).toBe('Today');
    expect(formatDay('2026-11-02', '2026-11-20')).toBe('Nov 2, 2026');
  });
  it('cleans and prettifies typed numbers', () => {
    expect(cleanDecimal('$94,812.40 USD', 2)).toBe('94812.40');
    expect(cleanDecimal('.5', 8)).toBe('0.5');
    expect(cleanDecimal('1.23456789012', 8)).toBe('1.23456789');
    expect(cleanDecimal('007', 2)).toBe('7');
    expect(prettyDollars('130000')).toBe('130,000');
    expect(prettyDollars('94812.4')).toBe('94,812.40');
    expect(prettyBtc('1')).toBe('1.0000 0000');
    expect(prettyBtc('1234.5')).toBe('1,234.5000 0000');
    expect(prettyBtc('')).toBe('');
  });
});
