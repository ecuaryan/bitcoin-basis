import { FILING_STATUSES, STATE_RATES } from '@bitcoin-basis/engine';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Button, buttonClasses } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Field, SelectBox, Toggle } from '../../ui/Field.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useWriter } from '../../ui/use-writer.ts';
import { draftFrom, FILING_LABELS, patchFrom, type SettingsDraft } from './settings-logic.ts';

const STATES = Object.values(STATE_RATES).sort((a, b) => a.name.localeCompare(b.name));

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" aria-label={title} className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

/** Settings are entries too: saving adds a settings entry with only what changed. */
export function SettingsView() {
  const { state } = useLedger();
  const write = useWriter();
  const toast = useToast();
  const s = state.settings;
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFrom(s));
  const [errors, setErrors] = useState<Partial<Record<keyof SettingsDraft, string>>>({});
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const err = (k: keyof SettingsDraft) => errors[k];

  async function save() {
    const r = patchFrom(s, draft);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    if (Object.keys(r.patch).length === 0) {
      toast.show('Nothing changed.');
      return;
    }
    await write({ kind: 'settings', patch: r.patch });
    toast.show('Settings saved.');
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 font-display text-2xl font-semibold">Settings</h2>
      <Group title="Your taxes">
        <SelectBox label="Filing status" value={draft.filingStatus} onChange={(e) => set('filingStatus', e.target.value as SettingsDraft['filingStatus'])}>
          {FILING_STATUSES.map((f) => (
            <option key={f} value={f}>
              {FILING_LABELS[f]}
            </option>
          ))}
        </SelectBox>
        <Field label="Wages and other income (a year)" inputMode="decimal" value={draft.wages} onChange={(e) => set('wages', e.target.value)} suffix="USD" aria-invalid={err('wages') !== undefined} hint={err('wages')} />
        <SelectBox label="State income tax" value={draft.stateKind} onChange={(e) => set('stateKind', e.target.value as SettingsDraft['stateKind'])}>
          <option value="none">None</option>
          <option value="flat">A state with one rate</option>
          <option value="custom">My own rate</option>
        </SelectBox>
        {draft.stateKind === 'flat' && (
          <SelectBox label="State" value={draft.stateCode} onChange={(e) => set('stateCode', e.target.value)}>
            {STATES.map((st) => (
              <option key={st.code} value={st.code}>
                {st.name} ({st.kind === 'none' ? 'no tax' : `${st.rate / 100}%`})
              </option>
            ))}
          </SelectBox>
        )}
        {draft.stateKind === 'custom' && <Field label="Your state rate" inputMode="decimal" value={draft.stateRate} onChange={(e) => set('stateRate', e.target.value)} suffix="%" hint={err('stateRate')} />}
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Short-term loss carried in" inputMode="decimal" value={draft.carryforwardSt} onChange={(e) => set('carryforwardSt', e.target.value)} suffix="USD" hint={err('carryforwardSt')} />
          <Field label="Long-term loss carried in" inputMode="decimal" value={draft.carryforwardLt} onChange={(e) => set('carryforwardLt', e.target.value)} suffix="USD" hint={err('carryforwardLt')} />
        </div>
        <p className="m-0 text-xs text-muted">Losses from earlier years that you carry into this one. Find them on last year&apos;s return.</p>
      </Group>

      <Group title="Giving">
        <Toggle label="Set aside a share of gains" hint="Off unless you want it" checked={draft.givingEnabled} onChange={(v) => set('givingEnabled', v)} />
        {draft.givingEnabled && (
          <>
            <Field label="What to call it" value={draft.givingName} onChange={(e) => set('givingName', e.target.value)} hint={err('givingName')} />
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Share of gains" inputMode="decimal" value={draft.givingPercent} onChange={(e) => set('givingPercent', e.target.value)} suffix="%" hint={err('givingPercent')} />
              <SelectBox label="Counted" value={draft.givingMode} onChange={(e) => set('givingMode', e.target.value as SettingsDraft['givingMode'])}>
                <option value="before-tax">Before tax</option>
                <option value="after-tax">After tax</option>
              </SelectBox>
            </div>
          </>
        )}
      </Group>

      <Group title="Your records">
        <Field label="Money put in before this app" inputMode="decimal" value={draft.earlierMoneyIn} onChange={(e) => set('earlierMoneyIn', e.target.value)} suffix="USD" hint={err('earlierMoneyIn') ?? 'Shown in Holdings. Never used in tax math.'} />
        <Field label="Time zone" value={draft.timeZone} onChange={(e) => set('timeZone', e.target.value)} hint={err('timeZone') ?? 'Decides the date, and so the tax year, of each entry.'} />
      </Group>

      <div className="flex flex-wrap gap-2.5">
        <Button variant="primary" className="min-h-[52px] flex-1 !rounded-2xl" onClick={() => void save()}>
          Save settings
        </Button>
        <Link to="/kit" className={buttonClasses('secondary', 'min-h-[52px] !rounded-2xl text-text no-underline')}>
          Emergency kit
        </Link>
      </div>
    </div>
  );
}
