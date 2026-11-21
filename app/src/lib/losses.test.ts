import { DEFAULT_SETTINGS } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { hasLosses, lossesForYear, staleLosses } from './losses.ts';

const saved = { ...DEFAULT_SETTINGS, carryforwardStCents: 100, carryforwardLtCents: 200 };

describe('losses from past years', () => {
  it('older settings (no year) count for the current year only', () => {
    expect(lossesForYear(saved, 2026, '2026-11-20')).toEqual({ st: 100, lt: 200 });
    expect(lossesForYear(saved, 2025, '2026-11-20')).toEqual({ st: 0, lt: 0 });
    expect(hasLosses(saved, 2026, '2026-11-20')).toBe(true);
    expect(hasLosses(saved, 2025, '2026-11-20')).toBe(false);
  });
  it('saved settings count for their own year', () => {
    expect(lossesForYear({ ...saved, carryforwardYear: 2027 }, 2027, '2026-12-31')).toEqual({ st: 100, lt: 200 });
    expect(lossesForYear({ ...saved, carryforwardYear: 2027 }, 2026, '2026-12-31')).toEqual({ st: 0, lt: 0 });
  });
  it('asks for an update only when the saved year is behind and there is something saved', () => {
    expect(staleLosses({ ...saved, carryforwardYear: 2025 }, 2026)).toEqual({ savedFor: 2025 });
    expect(staleLosses({ ...saved, carryforwardYear: 2026 }, 2026)).toBeNull();
    expect(staleLosses({ ...saved, carryforwardYear: 2027 }, 2026)).toBeNull();
    expect(staleLosses(saved, 2026)).toBeNull();
    expect(staleLosses({ ...DEFAULT_SETTINGS, carryforwardYear: 2020 }, 2026)).toBeNull();
  });
});
