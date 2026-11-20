import { describe, expect, test } from 'vitest';
import { divRoundHalfUp, mulDivRoundHalfUp, splitProportional } from '../src/money.ts';

describe('money', () => {
  test('half-up rounding, both signs', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(5n, -2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });
  test('mulDiv beyond 2^53 intermediates', () => {
    expect(mulDivRoundHalfUp(1_000_000_000_00, 99_999_999, 100_000_000)).toBe(99_999_999_000);
    expect(() => mulDivRoundHalfUp(0.5, 1, 1)).toThrow(RangeError);
    expect(() => mulDivRoundHalfUp(Number.MAX_SAFE_INTEGER, 4, 1)).toThrow(RangeError);
  });
  test('thirds of $100.00 add back exactly', () => {
    expect(splitProportional(10_000, [33_333_333, 33_333_333, 33_333_334])).toEqual([3333, 3333, 3334]);
    expect(splitProportional(5, [])).toEqual([]);
    expect(() => splitProportional(5, [0, 0])).toThrow(RangeError);
  });
});
