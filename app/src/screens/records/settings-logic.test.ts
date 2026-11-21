import { DEFAULT_SETTINGS } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { draftFrom, patchFrom } from './settings-logic.ts';

describe('settings form', () => {
  it('starts from the current settings and changes nothing if left alone', () => {
    const r = patchFrom(DEFAULT_SETTINGS, draftFrom(DEFAULT_SETTINGS));
    expect(r).toEqual({ ok: true, patch: {} });
  });
  it('sends only what changed, in cents and basis points', () => {
    const d = { ...draftFrom(DEFAULT_SETTINGS), wages: '130,000', givingEnabled: true, givingPercent: '12.5', stateKind: 'custom' as const, stateRate: '5.3' };
    const r = patchFrom(DEFAULT_SETTINGS, d);
    expect(r).toEqual({ ok: true, patch: { wagesCents: 13_000_000, givingEnabled: true, givingPercentBp: 1250, state: { kind: 'custom', rate: 530 } } });
  });
  it('round-trips awkward amounts without floats', () => {
    const s = { ...DEFAULT_SETTINGS, wagesCents: 12_345_607, givingPercentBp: 1205 };
    const d = draftFrom(s);
    expect(d.wages).toBe('123456.07');
    expect(d.givingPercent).toBe('12.05');
    expect(patchFrom(s, d)).toEqual({ ok: true, patch: {} });
  });
  it('saves the year with changed losses from past years, and only then', () => {
    const d = { ...draftFrom(DEFAULT_SETTINGS), carryforwardLt: '2,480' };
    expect(patchFrom(DEFAULT_SETTINGS, d, 2026)).toEqual({ ok: true, patch: { carryforwardLtCents: 248_000, carryforwardYear: 2026 } });
    expect(patchFrom(DEFAULT_SETTINGS, d)).toEqual({ ok: true, patch: { carryforwardLtCents: 248_000 } });
    const saved = { ...DEFAULT_SETTINGS, carryforwardLtCents: 248_000, carryforwardYear: 2025 };
    expect(patchFrom(saved, draftFrom(saved), 2026)).toEqual({ ok: true, patch: {} });
  });
  it('explains what is wrong', () => {
    const r = patchFrom(DEFAULT_SETTINGS, { ...draftFrom(DEFAULT_SETTINGS), wages: 'lots', givingName: ' ', timeZone: 'Mars/Base' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['givingName', 'timeZone', 'wages']);
  });
});
