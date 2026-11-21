import { describe, expect, it } from 'vitest';
import type { PricePoint } from '../data/price-history.ts';
import { keyIndex, nearestIndex, pointDate, scrubText } from './chart-scrub.ts';

const month = (m: number) => Date.UTC(2025, m, 1);
const monthly: PricePoint[] = [0, 1, 2, 3].map((m) => ({ ms: month(m), cents: 10_000_000 + m * 1_000_000 }));

describe('nearestIndex', () => {
  it('snaps to the closest point and clamps the edges', () => {
    expect(nearestIndex(monthly, 0)).toBe(0);
    expect(nearestIndex(monthly, 1)).toBe(3);
    expect(nearestIndex(monthly, -3)).toBe(0);
    expect(nearestIndex(monthly, 9)).toBe(3);
    const t = (month(1) - month(0)) / (month(3) - month(0));
    expect(nearestIndex(monthly, t * 0.4)).toBe(0);
    expect(nearestIndex(monthly, t * 0.6)).toBe(1);
  });
});

describe('scrubText', () => {
  it('words a point above the cost', () => {
    const t = scrubText(monthly, 3, 5_000_000, false);
    expect(t.date).toBe('Apr 2025');
    expect(t.price).toBe('$130,000');
    expect(t.gap).toBe('+$80,000 above your cost');
    expect(t.spoken).toContain('$80,000 above your cost');
    expect(t.spoken).toContain('BTC price $130,000');
  });
  it('words a point below the cost with a real minus', () => {
    expect(scrubText(monthly, 0, 10_310_000, false).gap).toBe('−$3,100 below your cost');
  });
  it('masks the user money but not the date or market price', () => {
    const t = scrubText(monthly, 3, 5_000_000, true);
    expect(t.date).toBe('Apr 2025');
    expect(t.price).toBe('$130,000');
    expect(t.gap).toBe('+$••••• above your cost');
    expect(t.cost).toBe('$•••••');
    expect(t.spoken).not.toMatch(/80,000|50,000/);
  });
  it('has no gap without a cost, and shows full dates for daily points', () => {
    expect(scrubText(monthly, 1, null, false).gap).toBeNull();
    const daily = [0, 1, 2].map((d) => ({ ms: Date.UTC(2025, 2, 5 + d), cents: 1_000_000 }));
    expect(pointDate(daily, 0)).toBe('Mar 5, 2025');
  });
});

describe('keyIndex', () => {
  it('moves one point, jumps to the ends, ignores other keys', () => {
    expect(keyIndex('ArrowRight', 1, 4)).toBe(2);
    expect(keyIndex('ArrowLeft', 0, 4)).toBe(0);
    expect(keyIndex('ArrowRight', 3, 4)).toBe(3);
    expect(keyIndex('Home', 2, 4)).toBe(0);
    expect(keyIndex('End', 2, 4)).toBe(3);
    expect(keyIndex('a', 2, 4)).toBeNull();
  });
});
