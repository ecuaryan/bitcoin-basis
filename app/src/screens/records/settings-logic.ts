import { carryforwardFor, isValidTimeZone, parseDollars, STATE_RATES, US_STATES, type Entry, type FilingStatus, type Settings, type SettingsPatch, type StateTaxSetting } from '@bitcoin-basis/engine';
import { parsePercentBp } from '../whatif/borrow-logic.ts';

export const FILING_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  'married-joint': 'Married filing jointly',
  'married-separate': 'Married filing separately',
  'head-of-household': 'Head of household',
  'qualifying-surviving-spouse': 'Qualifying surviving spouse',
};

/** Whether the person has ever chosen their filing status and state (a new vault starts with neither). */
export interface TaxProfileSet {
  filing: boolean;
  state: boolean;
}

/** Filing status and state count as chosen once any settings entry has saved them (the demo book does). */
export function taxProfileSet(entries: readonly Entry[]): TaxProfileSet {
  const patches = entries.flatMap((e) => (e.kind === 'settings' ? [e.patch] : []));
  return { filing: patches.some((p) => p.filingStatus !== undefined), state: patches.some((p) => p.state !== undefined) };
}

const ALL_SET: TaxProfileSet = { filing: true, state: true };

/** The state choices: `none`, `custom` (somewhere else), or a postal code. */
export const NO_STATE_TAX = 'none';
export const OTHER_STATE = 'custom';

/** A state with graduated rates (not in the rate table): the person enters their own effective rate. */
export function needsOwnRate(choice: string): boolean {
  return choice === OTHER_STATE || (Object.hasOwn(US_STATES, choice) && !Object.hasOwn(STATE_RATES, choice));
}

/** `Idaho 5.3% · 2026 rate`, `Texas no tax · 2026 rate`, `California (enter your rate)`. */
export function stateOptionLabel(code: string): string {
  const name = US_STATES[code] ?? code;
  const rated = (STATE_RATES as Record<string, { kind: 'flat' | 'none'; rate: number; year: number } | undefined>)[code];
  if (rated === undefined) return `${name} (enter your rate)`;
  return `${name} ${rated.kind === 'none' ? 'no tax' : `${rated.rate / 100}%`} · ${rated.year} rate`;
}

/** What the form shows, all as text. An empty filing status or state is "Not set". */
export interface SettingsDraft {
  filingStatus: FilingStatus | '';
  wages: string;
  /** `''` not set, `none`, `custom`, or a state's postal code. */
  stateChoice: string;
  stateRate: string;
  carryforwardSt: string;
  carryforwardLt: string;
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

function stateChoiceOf(state: StateTaxSetting): string {
  if (state.kind === 'none') return NO_STATE_TAX;
  if (state.kind === 'flat') return state.state;
  return state.state ?? OTHER_STATE;
}

/**
 * The form for `s`; losses from past years are the ones saved for `year` (the current tax year). Filing status and
 * state show as not set until the person has chosen them (`set`).
 */
export function draftFrom(s: Settings, year?: number, set: TaxProfileSet = ALL_SET): SettingsDraft {
  const losses = year === undefined ? { st: s.carryforwardStCents, lt: s.carryforwardLtCents } : carryforwardFor(s, year);
  return {
    filingStatus: set.filing ? s.filingStatus : '',
    wages: dollars(s.wagesCents),
    stateChoice: set.state ? stateChoiceOf(s.state) : '',
    stateRate: s.state.kind === 'custom' ? percent(s.state.rate) : '',
    carryforwardSt: dollars(losses.st),
    carryforwardLt: dollars(losses.lt),
    timeZone: s.timeZone,
  };
}

export type DraftResult = { ok: true; patch: SettingsPatch } | { ok: false; errors: Partial<Record<keyof SettingsDraft, string>> };

/**
 * The settings that changed, or what is wrong with the form.
 * `year` is the tax year typed-in losses are for (the current year): changed losses save under that year only
 * (`carryforwardByYear`), so another year's figure never changes. Without a year they save as the plain fields.
 * A filing status or state chosen for the first time (`set`) is saved even when it matches the built-in default; one
 * left "Not set" is not saved. A state that needs its own rate waits until a rate is typed.
 */
export function patchFrom(current: Settings, d: SettingsDraft, year?: number, set: TaxProfileSet = ALL_SET): DraftResult {
  const errors: Partial<Record<keyof SettingsDraft, string>> = {};
  const money = (key: keyof SettingsDraft, text: string): number => {
    const c = parseDollars(text);
    if (c === null) errors[key] = 'Use a dollar amount, like 130000.';
    return c ?? 0;
  };
  const wages = money('wages', d.wages);
  const st = money('carryforwardSt', d.carryforwardSt);
  const lt = money('carryforwardLt', d.carryforwardLt);
  if (!isValidTimeZone(d.timeZone)) errors.timeZone = 'Use a time zone name, like America/Boise.';
  let state: StateTaxSetting | null = null;
  if (d.stateChoice === NO_STATE_TAX) state = { kind: 'none' };
  else if (needsOwnRate(d.stateChoice)) {
    if (d.stateRate.trim() !== '') {
      const rate = parsePercentBp(d.stateRate);
      if (rate === null) errors.stateRate = 'Use a percent from 0 to 100, like 5.3.';
      state = { kind: 'custom', rate: rate ?? 0, ...(d.stateChoice === OTHER_STATE ? {} : { state: d.stateChoice }) };
    }
  } else if (d.stateChoice !== '') state = { kind: 'flat', state: d.stateChoice };
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const next: Settings = {
    ...current,
    filingStatus: d.filingStatus === '' ? current.filingStatus : d.filingStatus,
    wagesCents: wages,
    state: state ?? current.state,
    ...(year === undefined ? { carryforwardStCents: st, carryforwardLtCents: lt } : {}),
    timeZone: d.timeZone,
  };
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) patch[key] = next[key];
  }
  if (!set.filing && d.filingStatus !== '') patch.filingStatus = d.filingStatus;
  if (!set.state && state !== null) patch.state = state;
  if (year !== undefined) {
    const now = carryforwardFor(current, year);
    if (st !== now.st || lt !== now.lt) patch.carryforwardByYear = { [String(year)]: { st, lt } };
  }
  return { ok: true, patch: patch as SettingsPatch };
}

/** Time zone names for the picker: the device's own and the saved one are always in the list. */
export function timeZoneChoices(current: string): string[] {
  const names = (Intl as unknown as { supportedValuesOf?(k: string): string[] }).supportedValuesOf;
  const all = names ? names.call(Intl, 'timeZone') : [];
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([current, device, ...all].filter((z) => z !== ''))].sort((a, b) => a.localeCompare(b));
}
