import { describe, expect, it } from 'vitest';
import { lenderRoom, roomPercent } from './borrow-logic.ts';

describe('How close the lender is', () => {
  it('says the lender would already sell when the price is at or past the sell line', () => {
    expect(lenderRoom({ dropToLiquidationBp: -6_667, dropToMarginCallBp: -9_048 })).toEqual({ kind: 'sells' });
    expect(lenderRoom({ dropToLiquidationBp: 0, dropToMarginCallBp: -1_250 })).toEqual({ kind: 'sells' });
  });
  it('gives the room left rounded down, under 1% rather than 0%, and a margin call already due', () => {
    expect(lenderRoom({ dropToLiquidationBp: 5_833, dropToMarginCallBp: 5_238 })).toEqual({ kind: 'room', percent: '58%', marginCallNow: false });
    expect(lenderRoom({ dropToLiquidationBp: 40, dropToMarginCallBp: -1_000 })).toEqual({ kind: 'room', percent: 'under 1%', marginCallNow: true });
    expect(lenderRoom({ dropToLiquidationBp: 1_000, dropToMarginCallBp: 0 })).toEqual({ kind: 'room', percent: '10%', marginCallNow: true });
    expect(roomPercent(-5)).toBe(0);
  });
});
