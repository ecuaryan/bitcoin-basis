import { describe, expect, it } from 'vitest';
import { cleanDecimal, countOf, formatDay, formatMoney, formatWhen, groupedBtc, groupedSats, maskDigits, prettyBtc, prettyDollars, satsToCents, sharePercents, shortBtc, wholeDollarParts, shortDate, shortWhen } from './format.ts';

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
    // Too small for 4 decimals: all 8, never 0.0000.
    expect(shortBtc(4_999)).toBe('0.0000 4999');
    expect(shortBtc(1)).toBe('0.0000 0001');
    expect(shortBtc(5_000)).toBe('0.0001');
    expect(shortBtc(0)).toBe('0.0000');
  });
  it('formats money', () => {
    expect(formatMoney(123_456)).toBe('$1,234.56');
    expect(formatMoney(-123_456)).toBe('\u2212$1,234.56');
    expect(formatMoney(31_920_690, { precision: 'dollars' })).toBe('$319,206');
    expect(formatMoney(18_032_905, { precision: 'dollars', signed: true })).toBe('+$180,329');
    // Under $1 keeps its cents, so a small gain or loss is never shown as $0.
    expect(formatMoney(-50, { precision: 'dollars' })).toBe('\u2212$0.50');
    expect(formatMoney(40, { precision: 'dollars', signed: true })).toBe('+$0.40');
    expect(formatMoney(-40, { precision: 'dollars', signed: true })).toBe('\u2212$0.40');
    expect(formatMoney(0, { precision: 'dollars', signed: true })).toBe('$0');
    expect(formatMoney(100, { precision: 'dollars' })).toBe('$1');
    expect(formatMoney(-150, { precision: 'dollars' })).toBe('\u2212$1');
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
    expect(shortDate('2026-11-02')).toBe('Nov 2, 2026');
    expect(shortDate('2025-10-30')).toBe('Oct 30, 2025');
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
  it('says when a price is from, short', () => {
    const now = Date.parse('2026-11-20T23:00:00Z');
    expect(shortWhen(Date.parse('2026-11-20T15:12:00Z'), now, 'UTC')).toBe('3:12 PM');
    expect(shortWhen(Date.parse('2026-11-19T15:12:00Z'), now, 'UTC')).toBe('Nov 19, 3:12 PM');
    expect(shortWhen(Date.parse('2025-12-31T09:05:00Z'), now, 'UTC')).toBe('Dec 31, 2025, 9:05 AM');
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

describe('shares of a total', () => {
  it('add up to 100% (largest remainder)', () => {
    expect(sharePercents([1, 1, 1])).toEqual(['34%', '33%', '33%']);
    expect(sharePercents([316_472_105, 20_200_000, 0, 0])).toEqual(['94%', '6%', '0%', '0%']);
    expect(sharePercents([125, 125, 750])).toEqual(['13%', '12%', '75%']);
  });
  it('shows 100% only for all of it, and never 0% for a part that is not zero', () => {
    // 99.6% documented and 0.4% unknown: not 100% and 0%.
    expect(sharePercents([99_600_000, 400_000])).toEqual(['99%', '1%']);
    expect(sharePercents([99_800, 100, 100])).toEqual(['99%', '1%', 'under 1%']);
    expect(sharePercents([5, 0])).toEqual(['100%', '0%']);
    expect(sharePercents([0, 0])).toEqual(['0%', '0%']);
    expect(sharePercents([2_100_000_000_000_000, 1])).toEqual(['99%', '1%']);
  });
});

describe('whole-dollar parts under a whole-dollar total', () => {
  it('add up to the total: the dollar they fall short goes to the part closest to its next dollar', () => {
    // $319,206.94 + $33,184.34 = $352,391.28: toward zero $319,206 + $33,184 = $352,390, a dollar short of $352,391.
    expect(wholeDollarParts([31_920_694, 3_318_434], 35_239_128)).toEqual([31_920_700, 3_318_400]);
    // Nothing short: each part toward zero.
    expect(wholeDollarParts([18_032_905, 1_727_434], 19_760_339)).toEqual([18_032_900, 1_727_400]);
  });
  it('works for gains and losses, in the total’s direction', () => {
    // +$100.60 and −$50.70 = +$49.90: $100 − $51 = $49 (the loss rounds away from zero, never a gain up).
    expect(wholeDollarParts([10_060, -5_070], 4_990)).toEqual([10_000, -5_100]);
    // −$100.60 and −$50.70 = −$151.30: −$100 − $51 = −$151.
    expect(wholeDollarParts([-10_060, -5_070], -15_130)).toEqual([-10_000, -5_100]);
  });
  it('keeps a part under $1 in cents and leaves null parts out', () => {
    expect(wholeDollarParts([40, 1_000], 1_040)).toEqual([40, 1_000]);
    expect(wholeDollarParts([10_060, null], 10_060)).toEqual([10_000, null]);
    expect(wholeDollarParts([], 0)).toEqual([]);
  });
});
