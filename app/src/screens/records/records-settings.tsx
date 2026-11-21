import { FILING_STATUSES, STATE_RATES, yearOf } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Button } from '../../ui/Button.tsx';
import { useHelp } from '../../ui/Help.tsx';
import { LOSSES_HELP, LOSSES_TITLE, staleLosses } from '../../lib/losses.ts';
import { Card } from '../../ui/Card.tsx';
import { MoneyInput, PercentInput } from '../../ui/formatted-inputs.tsx';
import { Field, SelectBox, Toggle } from '../../ui/Field.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useWriter } from '../../ui/use-writer.ts';
import { draftFrom, FILING_LABELS, patchFrom, timeZoneChoices, type SettingsDraft } from './settings-logic.ts';

const STATES = Object.values(STATE_RATES).sort((a, b) => a.name.localeCompare(b.name));

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
  const { state, today } = useLedger();
  const thisYear = yearOf(today);
  const lossesYear = state.settings.carryforwardYear ?? thisYear;
  const stale = staleLosses(state.settings, thisYear);
  const help = useHelp(`What are ${LOSSES_TITLE.toLowerCase()}?`, LOSSES_HELP);
  const write = useWriter();
  const toast = useToast();
  const s = state.settings;
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFrom(s));
  const [errors, setErrors] = useState<Partial<Record<keyof SettingsDraft, string>>>({});
  const err = (k: keyof SettingsDraft) => errors[k];

  /** Changes save as you go: choices at once, typed fields when you leave them. Nothing to forget to press. */
  async function save(d: SettingsDraft, relabelYear = false) {
    const r = patchFrom(s, d, thisYear);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    const patch = relabelYear ? { ...r.patch, carryforwardYear: thisYear } : r.patch;
    if (Object.keys(patch).length === 0) return;
    await write({ kind: 'settings', patch });
    toast.show('Saved.');
  }
  /** A choice (select or switch): set it and save it. */
  const pick = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    void save(next);
  };
  /** A typed field: update while typing, save on leaving the field. */
  const type = <K extends keyof SettingsDraft>(key: K) => ({
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value })),
    onBlur: () => void save(draft),
  });
  const num = <K extends keyof SettingsDraft>(key: K) => ({
    onChange: (v: string) => setDraft((d) => ({ ...d, [key]: v })),
    onBlur: () => void save(draft),
  });
  const zones = useMemo(() => timeZoneChoices(draft.timeZone), [draft.timeZone]);

  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      <h2 className="m-0 hidden font-display text-2xl font-semibold lg:block">Settings</h2>
      <Group title="Your taxes">
        <SelectBox label="Filing status" value={draft.filingStatus} onChange={(e) => pick('filingStatus', e.target.value as SettingsDraft['filingStatus'])}>
          {FILING_STATUSES.map((f) => (
            <option key={f} value={f}>
              {FILING_LABELS[f]}
            </option>
          ))}
        </SelectBox>
        <MoneyInput label="Wages and other income (a year)" value={draft.wages} {...num('wages')} error={err('wages')} />
        <SelectBox label="State income tax" value={draft.stateKind} onChange={(e) => pick('stateKind', e.target.value as SettingsDraft['stateKind'])}>
          <option value="none">None</option>
          <option value="flat">A state with one rate</option>
          <option value="custom">My own rate</option>
        </SelectBox>
        {draft.stateKind === 'flat' && (
          <SelectBox label="State" value={draft.stateCode} onChange={(e) => pick('stateCode', e.target.value)}>
            {STATES.map((st) => (
              <option key={st.code} value={st.code}>
                {st.name} ({st.kind === 'none' ? 'no tax' : `${st.rate / 100}%`})
              </option>
            ))}
          </SelectBox>
        )}
        {draft.stateKind === 'custom' && <PercentInput label="Your state rate" value={draft.stateRate} {...num('stateRate')} error={err('stateRate')} />}
        <div role="group" aria-label={LOSSES_TITLE} className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-1 text-sm font-semibold">
              {LOSSES_TITLE}
              {help.button}
            </span>
            <span className="text-xs text-muted">for {lossesYear}</span>
          </div>
          {help.panel}
          {stale !== null && (
            <p className="m-0 flex flex-wrap items-center gap-x-3 text-xs text-amber">
              These are for {stale.savedFor}. Update them for {thisYear}.
              <Button variant="ghost" onClick={() => void save({ ...draft }, true)}>
                Still right for {thisYear}
              </Button>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <MoneyInput label="Short-term" value={draft.carryforwardSt} {...num('carryforwardSt')} error={err('carryforwardSt')} />
            <MoneyInput label="Long-term" value={draft.carryforwardLt} {...num('carryforwardLt')} error={err('carryforwardLt')} />
          </div>
        </div>
      </Group>

      <Group title="Giving">
        <Toggle label="Set aside a share of gains" hint="Off unless you want it" checked={draft.givingEnabled} onChange={(v) => pick('givingEnabled', v)} />
        {draft.givingEnabled && (
          <>
            <Field label="What to call it" value={draft.givingName} {...type('givingName')} hint={err('givingName')} />
            <div className="grid grid-cols-2 gap-2.5">
              <PercentInput label="Share of gains" value={draft.givingPercent} {...num('givingPercent')} error={err('givingPercent')} />
              <SelectBox label="Counted" value={draft.givingMode} onChange={(e) => pick('givingMode', e.target.value as SettingsDraft['givingMode'])}>
                <option value="before-tax">Before tax</option>
                <option value="after-tax">After tax</option>
              </SelectBox>
            </div>
          </>
        )}
      </Group>

      <Group title="Your records">
        <MoneyInput label="Dollars you put in before using this app" value={draft.earlierMoneyIn} {...num('earlierMoneyIn')} error={err('earlierMoneyIn')} hint="Shown in Holdings. Never used in tax math." />
        <SelectBox label="Time zone" value={draft.timeZone} onChange={(e) => pick('timeZone', e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </SelectBox>
        <span className="-mt-1 text-xs text-muted">{err('timeZone') ?? 'Decides the date, and so the tax year, of each entry.'}</span>
      </Group>
    </div>
  );
}
