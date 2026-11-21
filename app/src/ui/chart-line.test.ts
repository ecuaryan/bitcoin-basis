import { describe, expect, it } from 'vitest';
import type { PricePoint } from '../data/price-history.ts';
import { lineCentsAt, peakIndex, smoothLine, tableIndexes } from './chart-line.ts';
import { keyIndex } from './chart-scrub.ts';

const DAY = 86_400_000;
const START = Date.UTC(2023, 10, 21);
/** Three years of days, a saw-tooth of ±5% day to day around a rise, with one spike. */
const days: PricePoint[] = Array.from({ length: 1095 }, (_, i) => ({ ms: START + i * DAY, cents: 4_000_000 + i * 5_000 + (i % 2 === 0 ? 200_000 : -200_000) }));
const plain = days.map((p) => ({ ...p }));
const SPIKE = 683;
days[SPIKE] = { ms: START + SPIKE * DAY, cents: 12_607_300 };

describe('smoothLine', () => {
  it('draws about one point per bucket, keeps the first, last and the marked high exactly', () => {
    const line = smoothLine(days, 160, SPIKE);
    expect(line.length).toBeGreaterThanOrEqual(160);
    expect(line.length).toBeLessThanOrEqual(163);
    expect(line[0]).toEqual(days[0]);
    expect(line.at(-1)).toEqual(days.at(-1));
    expect(line).toContainEqual(days[SPIKE]);
    expect(Math.max(...line.map((p) => p.cents))).toBe(days[SPIKE]?.cents);
    // Times only go forward.
    for (let i = 1; i < line.length; i++) expect((line[i] as PricePoint).ms).toBeGreaterThan((line[i - 1] as PricePoint).ms);
  });

  it('averages away the day-to-day saw-tooth', () => {
    const line = smoothLine(plain, 160).slice(1, -1);
    // Day to day the price jumps $4,000; averaged runs of about 7 days move far less.
    for (let i = 1; i < line.length; i++) expect(Math.abs((line[i] as PricePoint).cents - (line[i - 1] as PricePoint).cents)).toBeLessThan(100_000);
  });

  it('few points are drawn as they are', () => {
    const few = days.slice(0, 13);
    expect(smoothLine(few, 160)).toEqual(few);
  });
});

describe('peakIndex and lineCentsAt', () => {
  it('finds the highest price', () => {
    expect(peakIndex(days)).toBe(SPIKE);
    expect(peakIndex([])).toBe(-1);
  });
  it('reads the drawn line between its points and at the ends', () => {
    const line = [{ ms: 0, cents: 100 }, { ms: 10, cents: 200 }];
    expect(lineCentsAt(line, -5)).toBe(100);
    expect(lineCentsAt(line, 5)).toBe(150);
    expect(lineCentsAt(line, 50)).toBe(200);
    expect(lineCentsAt([], 5)).toBe(0);
  });
});

describe('tableIndexes', () => {
  it('a daily series: the first day of each month, the high and the last day', () => {
    const rows = tableIndexes(days, SPIKE);
    expect(rows.length).toBeLessThan(42);
    expect(rows).toContain(0);
    expect(rows).toContain(SPIKE);
    expect(rows).toContain(days.length - 1);
    expect(new Date(days[rows[1] as number]?.ms ?? 0).getUTCDate()).toBe(1);
  });
  it('few points: all of them', () => {
    expect(tableIndexes(days.slice(0, 13), -1)).toHaveLength(13);
  });
});

describe('keyIndex paging', () => {
  it('Page Up and Page Down move about a month of three years of days', () => {
    expect(keyIndex('PageDown', 500, 1095)).toBe(470);
    expect(keyIndex('PageUp', 1090, 1095)).toBe(1094);
    expect(keyIndex('PageDown', 3, 13)).toBe(2);
  });
});
