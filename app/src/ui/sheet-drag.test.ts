import { describe, expect, it } from 'vitest';
import { backdropOpacity, dragOffset, releaseVelocity, shouldCloseOnRelease } from './sheet-drag.ts';

describe('sheet drag', () => {
  it('springs back for a small, slow drag', () => {
    expect(shouldCloseOnRelease(60, 600, 0.1)).toBe(false);
    expect(shouldCloseOnRelease(150, 600, 0)).toBe(false);
  });
  it('closes past a quarter of the height', () => {
    expect(shouldCloseOnRelease(151, 600, 0)).toBe(true);
  });
  it('closes on a fast flick, but not on a fast tiny twitch', () => {
    expect(shouldCloseOnRelease(40, 600, 0.9)).toBe(true);
    expect(shouldCloseOnRelease(5, 600, 2)).toBe(false);
  });
  it('stays open when the finger is moving back up at release, even far down', () => {
    expect(shouldCloseOnRelease(400, 600, -0.2)).toBe(false);
    expect(shouldCloseOnRelease(400, 600, -0.06)).toBe(false);
    // Holding still far down still closes.
    expect(shouldCloseOnRelease(400, 600, 0)).toBe(true);
  });
  it('does not close on an upward fling', () => {
    expect(shouldCloseOnRelease(-80, 600, -1)).toBe(false);
  });
  it('follows down one to one and only gives a little going up', () => {
    expect(dragOffset(120)).toBe(120);
    expect(dragOffset(-10)).toBeLessThan(0);
    expect(dragOffset(-10)).toBeGreaterThan(-20);
    expect(dragOffset(-1000)).toBe(-20);
  });
  it('dims the backdrop in proportion', () => {
    expect(backdropOpacity(0, 500)).toBe(1);
    expect(backdropOpacity(250, 500)).toBe(0.5);
    expect(backdropOpacity(900, 500)).toBe(0);
    expect(backdropOpacity(-10, 500)).toBe(1);
  });
  it('measures speed over the last 100 ms', () => {
    expect(releaseVelocity([])).toBe(0);
    expect(
      releaseVelocity([
        { t: 0, y: 0 },
        { t: 400, y: 10 },
        { t: 450, y: 20 },
        { t: 500, y: 70 },
      ]),
    ).toBeCloseTo(0.6, 5);
  });
});
