import { carryforwardFor, FILING_STATUSES, US_STATES, yearOf } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { useDelayedSave } from '../../ui/use-delayed-save.ts';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Button } from '../../ui/Button.tsx';
import { useHelp } from '../../ui/Help.tsx';
import { LOSSES_HELP, LOSSES_TITLE, staleLosses } from '../../lib/losses.ts';
import { Card } from '../../ui/Card.tsx';
import { MoneyInput, PercentInput } from '../../ui/formatted-inputs.tsx';
import { SelectBox } from '../../ui/Field.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useWriter } from '../../ui/use-writer.ts';
import { draftFrom, FILING_LABELS, needsOwnRate, NO_STATE_TAX, OTHER_STATE, patchFrom, stateOptionLabel, taxProfileSet, timeZoneChoices, type SettingsDraft } from './settings-logic.ts';

/** How long after the last change the settings are saved. */
export const SAVE_DELAY_MS = 1500;

const STATE_CODES = Object.keys(US_STATES).sort((a, b) => (US_STATES[a] ?? a).localeCompare(US_STATES[b] ?? b));

/**
 * Marks the field changed last once it is saved: "Saved ✓" stays on its label line (no toast to miss, and nothing
 * below moves). Only one field carries it at a time.
 */
function SavedMark({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      {show ? (
        <span role="status" className="pointer-events-none absolute right-0 top-0 text-xs font-semibold leading-4 text-accent">
          Saved ✓
        </span>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" aria-label={title} className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

/** Settings are entries too: saving adds a settings entry with only what changed. */
export function SettingsView() {
  const { state, entries, today } = useLedger();
  const thisYear = yearOf(today);
  const set = useMemo(() => taxProfileSet(entries), [entries]);
  const stale = staleLosses(state.settings, thisYear);
  const help = useHelp(`What are ${LOSSES_TITLE.toLowerCase()}?`, LOSSES_HELP);
  const write = useWriter();
  const toast = useToast();
  const s = state.settings;
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFrom(s, thisYear, set));
  const [errors, setErrors] = useState<Partial<Record<keyof SettingsDraft, string>>>({});
  const err = (k: keyof SettingsDraft) => errors[k];
  /** The field whose change was saved last: it shows "Saved ✓". */
  const [savedKey, setSavedKey] = useState<keyof SettingsDraft | null>(null);
  const saved = (...keys: (keyof SettingsDraft)[]) => savedKey !== null && keys.includes(savedKey);

  /** Changes save as you go, a moment after the last one, as a single entry with only what differs from now. Nothing to forget to press. */
  async function save(d: SettingsDraft, relabelYear = false, key: keyof SettingsDraft | null = null) {
    const r = patchFrom(s, d, thisYear, set);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    // "Still right": the last saved year's figures are copied to this year (that year keeps its own).
    const copied = relabelYear && stale !== null ? carryforwardFor(s, stale.savedFor) : null;
    const patch = copied !== null ? { ...r.patch, carryforwardByYear: { [String(thisYear)]: copied } } : r.patch;
    if (Object.keys(patch).length === 0) return;
    if (copied !== null) {
      const shown = draftFrom({ ...s, carryforwardByYear: { ...s.carryforwardByYear, [String(thisYear)]: copied } }, thisYear);
      setDraft((cur) => ({ ...cur, carryforwardSt: shown.carryforwardSt, carryforwardLt: shown.carryforwardLt }));
    }
    // A first choice of filing status or state is saved even when it equals the built-in default.
    const firstChoice = (!set.filing && 'filingStatus' in patch) || (!set.state && 'state' in patch);
    const written = await write({ kind: 'settings', patch }, { evenIfSame: firstChoice });
    // Never say "Saved" for something that was not written.
    if (written === null) return;
    setSavedKey(relabelYear ? 'carryforwardLt' : key);
    toast.show('Saved.', { success: true });
  }
  const later = useDelayedSave((v: { d: SettingsDraft; key: keyof SettingsDraft }) => save(v.d, false, v.key), SAVE_DELAY_MS);
  /** A choice (select or switch): set it and save it soon. */
  const pick = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    later({ d: next, key });
  };
  const num = <K extends keyof SettingsDraft>(key: K) => ({
    onChange: (v: string) => setDraft((d) => ({ ...d, [key]: v })),
    onBlur: () => later({ d: draft, key }),
  });
  const zones = useMemo(() => timeZoneChoices(draft.timeZone), [draft.timeZone]);

  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      <Group title="Filing and income">
        <SavedMark show={saved('filingStatus')}>
          <SelectBox label="Filing status" value={draft.filingStatus} onChange={(e) => pick('filingStatus', e.target.value as SettingsDraft['filingStatus'])}>
            {draft.filingStatus === '' ? <option value="">Not set</option> : null}
            {FILING_STATUSES.map((f) => (
              <option key={f} value={f}>
                {FILING_LABELS[f]}
              </option>
            ))}
          </SelectBox>
        </SavedMark>
        <SavedMark show={saved('wages')}>
          <MoneyInput label="Wages and other income (a year)" value={draft.wages} {...num('wages')} error={err('wages')} />
        </SavedMark>
        <SavedMark show={saved('stateChoice') || (saved('stateRate') && !needsOwnRate(draft.stateChoice))}>
          <SelectBox label="State" value={draft.stateChoice} onChange={(e) => pick('stateChoice', e.target.value)}>
            {draft.stateChoice === '' ? <option value="">Not set</option> : null}
            {STATE_CODES.map((code) => (
              <option key={code} value={code}>
                {stateOptionLabel(code)}
              </option>
            ))}
            <option value={NO_STATE_TAX}>No state income tax</option>
            <option value={OTHER_STATE}>Somewhere else (enter your rate)</option>
          </SelectBox>
        </SavedMark>
        {needsOwnRate(draft.stateChoice) && (
          <SavedMark show={saved('stateRate')}>
            <PercentInput
              label={draft.stateChoice === OTHER_STATE ? 'Your state tax rate' : `Your ${US_STATES[draft.stateChoice] ?? 'state'} tax rate`}
              value={draft.stateRate}
              {...num('stateRate')}
              error={err('stateRate')}
              hint="Your effective rate: last year’s state tax divided by your taxable income, like 5.5."
            />
          </SavedMark>
        )}
        <div role="group" aria-label={LOSSES_TITLE} className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-1 text-sm font-semibold">
              {LOSSES_TITLE}
              {help.button}
            </span>
            <span className="text-xs text-muted">for {thisYear}</span>
          </div>
          {help.panel}
          {stale !== null && (
            <p className="m-0 flex flex-wrap items-center gap-x-3 text-xs text-amber">
              Saved for {stale.savedFor}, not yet for {thisYear}. Enter this year&apos;s, or:
              <Button variant="ghost" onClick={() => void save({ ...draft }, true)}>
                Still right for {thisYear}
              </Button>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <SavedMark show={saved('carryforwardSt')}>
              <MoneyInput label="Short-term" value={draft.carryforwardSt} {...num('carryforwardSt')} error={err('carryforwardSt')} />
            </SavedMark>
            <SavedMark show={saved('carryforwardLt')}>
              <MoneyInput label="Long-term" value={draft.carryforwardLt} {...num('carryforwardLt')} error={err('carryforwardLt')} />
            </SavedMark>
          </div>
        </div>
      </Group>

      <Group title="Your records">
        <SavedMark show={saved('timeZone')}>
          <SelectBox label="Time zone" value={draft.timeZone} onChange={(e) => pick('timeZone', e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll('_', ' ')}
              </option>
            ))}
          </SelectBox>
        </SavedMark>
        <span className="-mt-1 text-xs text-muted">{err('timeZone') ?? 'Decides the date, and so the tax year, of each entry.'}</span>
      </Group>
    </div>
  );
}
