import { DEFAULT_SETTINGS } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { draftFrom, patchFrom, stateOptionLabel, taxProfileSet } from './settings-logic.ts';

describe('settings form', () => {
  it('starts from the current settings and changes nothing if left alone', () => {
    const r = patchFrom(DEFAULT_SETTINGS, draftFrom(DEFAULT_SETTINGS));
    expect(r).toEqual({ ok: true, patch: {} });
  });
  it('sends only what changed, in cents and basis points', () => {
    const d = { ...draftFrom(DEFAULT_SETTINGS), wages: '130,000', stateChoice: 'custom', stateRate: '5.35' };
    const r = patchFrom(DEFAULT_SETTINGS, d);
    expect(r).toEqual({ ok: true, patch: { wagesCents: 13_000_000, state: { kind: 'custom', rate: 535 } } });
  });
  it('round-trips awkward amounts without floats', () => {
    const s = { ...DEFAULT_SETTINGS, wagesCents: 12_345_607, state: { kind: 'custom' as const, rate: 1205 } };
    const d = draftFrom(s);
    expect(d.wages).toBe('123456.07');
    expect(d.stateRate).toBe('12.05');
    expect(patchFrom(s, d)).toEqual({ ok: true, patch: {} });
  });
  it('saves changed losses from past years under this year only, and only then', () => {
    const d = { ...draftFrom(DEFAULT_SETTINGS, 2026), carryforwardLt: '2,480' };
    expect(patchFrom(DEFAULT_SETTINGS, d, 2026)).toEqual({ ok: true, patch: { carryforwardByYear: { '2026': { st: 0, lt: 248_000 } } } });
    expect(patchFrom(DEFAULT_SETTINGS, d)).toEqual({ ok: true, patch: { carryforwardLtCents: 248_000 } });
    const saved = { ...DEFAULT_SETTINGS, carryforwardByYear: { '2025': { st: 0, lt: 248_000 }, '2026': { st: 5_000, lt: 0 } } };
    expect(draftFrom(saved, 2026)).toMatchObject({ carryforwardSt: '50', carryforwardLt: '0' });
    expect(draftFrom(saved, 2025)).toMatchObject({ carryforwardSt: '0', carryforwardLt: '2480' });
    expect(patchFrom(saved, draftFrom(saved, 2026), 2026)).toEqual({ ok: true, patch: {} });
  });
  it('starts filing status and state as not set for a new book, and saves them once chosen, even if they match the default', () => {
    const unset = { filing: false, state: false };
    const d = draftFrom(DEFAULT_SETTINGS, 2026, unset);
    expect(d).toMatchObject({ filingStatus: '', stateChoice: '' });
    expect(patchFrom(DEFAULT_SETTINGS, d, 2026, unset)).toEqual({ ok: true, patch: {} });
    expect(patchFrom(DEFAULT_SETTINGS, { ...d, filingStatus: 'single', stateChoice: 'ID' }, 2026, unset)).toEqual({ ok: true, patch: { filingStatus: 'single', state: { kind: 'flat', state: 'ID' } } });
    expect(taxProfileSet([])).toEqual({ filing: false, state: false });
    const entry = { id: 's', kind: 'settings', at: '2026-01-01T00:00:00Z', tz: 'UTC', patch: { filingStatus: 'single' } } as const;
    expect(taxProfileSet([entry])).toEqual({ filing: true, state: false });
  });
  it('a state with graduated rates saves the rate typed for it, and nothing until one is typed', () => {
    const d = { ...draftFrom(DEFAULT_SETTINGS), stateChoice: 'CA', stateRate: '' };
    expect(patchFrom(DEFAULT_SETTINGS, d)).toEqual({ ok: true, patch: {} });
    expect(patchFrom(DEFAULT_SETTINGS, { ...d, stateRate: '6.2' })).toEqual({ ok: true, patch: { state: { kind: 'custom', rate: 620, state: 'CA' } } });
    expect(draftFrom({ ...DEFAULT_SETTINGS, state: { kind: 'custom', rate: 620, state: 'CA' } })).toMatchObject({ stateChoice: 'CA', stateRate: '6.2' });
    expect(patchFrom(DEFAULT_SETTINGS, { ...d, stateChoice: 'TX' })).toEqual({ ok: true, patch: { state: { kind: 'flat', state: 'TX' } } });
    expect(patchFrom(DEFAULT_SETTINGS, { ...d, stateChoice: 'none' })).toEqual({ ok: true, patch: { state: { kind: 'none' } } });
    expect(stateOptionLabel('CA')).toBe('California (enter your rate)');
    expect(stateOptionLabel('ID')).toBe('Idaho 5.3% · 2026 rate');
    expect(stateOptionLabel('TX')).toBe('Texas no tax · 2026 rate');
  });
  it('explains what is wrong', () => {
    const r = patchFrom(DEFAULT_SETTINGS, { ...draftFrom(DEFAULT_SETTINGS), wages: 'lots', timeZone: 'Mars/Base' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['timeZone', 'wages']);
  });
});
