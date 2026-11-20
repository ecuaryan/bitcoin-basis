import { isValidTimeZone, parseDollars, type FilingStatus, type Settings, type SettingsPatch, type StateTaxSetting } from '@bitcoin-basis/engine';
import { parsePercentBp } from '../whatif/borrow-logic.ts';

export const FILING_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  'married-joint': 'Married filing jointly',
  'married-separate': 'Married filing separately',
  'head-of-household': 'Head of household',
  'qualifying-surviving-spouse': 'Qualifying surviving spouse',
};

/** What the form shows, all as text. */
export interface SettingsDraft {
  filingStatus: FilingStatus;
  wages: string;
  stateKind: StateTaxSetting['kind'];
  stateCode: string;
  stateRate: string;
  carryforwardSt: string;
  carryforwardLt: string;
  givingEnabled: boolean;
  givingName: string;
  givingPercent: string;
  givingMode: Settings['givingMode'];
  earlierMoneyIn: string;
  timeZone: string;
}

const dollars = (cents: number): string => {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
};
const percent = (bp: number): string => {
  const frac = bp % 100;
  return frac === 0 ? String(bp / 100) : `${Math.floor(bp / 100)}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
};

export function draftFrom(s: Settings): SettingsDraft {
  return {
    filingStatus: s.filingStatus,
    wages: dollars(s.wagesCents),
    stateKind: s.state.kind,
    stateCode: s.state.kind === 'flat' ? s.state.state : 'ID',
    stateRate: s.state.kind === 'custom' ? percent(s.state.rate) : '5',
    carryforwardSt: dollars(s.carryforwardStCents),
    carryforwardLt: dollars(s.carryforwardLtCents),
    givingEnabled: s.givingEnabled,
    givingName: s.givingName,
    givingPercent: percent(s.givingPercentBp),
    givingMode: s.givingMode,
    earlierMoneyIn: dollars(s.earlierMoneyInCents),
    timeZone: s.timeZone,
  };
}

export type DraftResult = { ok: true; patch: SettingsPatch } | { ok: false; errors: Partial<Record<keyof SettingsDraft, string>> };

/** The settings that changed, or what is wrong with the form. */
export function patchFrom(current: Settings, d: SettingsDraft): DraftResult {
  const errors: Partial<Record<keyof SettingsDraft, string>> = {};
  const money = (key: keyof SettingsDraft, text: string): number => {
    const c = parseDollars(text);
    if (c === null) errors[key] = 'Use a dollar amount, like 130000.';
    return c ?? 0;
  };
  const wages = money('wages', d.wages);
  const st = money('carryforwardSt', d.carryforwardSt);
  const lt = money('carryforwardLt', d.carryforwardLt);
  const earlier = money('earlierMoneyIn', d.earlierMoneyIn);
  const pct = parsePercentBp(d.givingPercent);
  if (pct === null) errors.givingPercent = 'Use a percent from 0 to 100, like 10.';
  if (d.givingName.trim() === '') errors.givingName = 'Give it a name.';
  if (!isValidTimeZone(d.timeZone)) errors.timeZone = 'Use a time zone name, like America/Boise.';
  let state: StateTaxSetting = { kind: 'none' };
  if (d.stateKind === 'flat') state = { kind: 'flat', state: d.stateCode };
  if (d.stateKind === 'custom') {
    const rate = parsePercentBp(d.stateRate);
    if (rate === null) errors.stateRate = 'Use a percent from 0 to 100, like 5.3.';
    state = { kind: 'custom', rate: rate ?? 0 };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const next: Settings = {
    ...current,
    filingStatus: d.filingStatus,
    wagesCents: wages,
    state,
    carryforwardStCents: st,
    carryforwardLtCents: lt,
    givingEnabled: d.givingEnabled,
    givingName: d.givingName.trim(),
    givingPercentBp: pct ?? 0,
    givingMode: d.givingMode,
    earlierMoneyInCents: earlier,
    timeZone: d.timeZone,
  };
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) patch[key] = next[key];
  }
  return { ok: true, patch: patch as SettingsPatch };
}
