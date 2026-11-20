import { useEffect, useId, useState } from 'react';
import { cx } from '../../lib/cx.ts';
import { checkCompleteCode, describeRecoveryInput, type RecoveryInputView } from './recovery-input-logic.ts';

/**
 * The recovery code field with live checking: characters counted as you type, a wrong character
 * named, and the check bits verified the moment all 30 are in. Reports whether the code is valid.
 */
export function RecoveryInput({
  value,
  onChange,
  onValid,
  autoFocus,
  label = 'Recovery code',
}: {
  value: string;
  onChange(next: string): void;
  onValid?(valid: boolean): void;
  autoFocus?: boolean;
  label?: string;
}) {
  const id = useId();
  const [checked, setChecked] = useState<{ for: string; view: RecoveryInputView } | null>(null);
  const quick = describeRecoveryInput(value);

  useEffect(() => {
    let live = true;
    if (quick.state === 'checking') {
      void checkCompleteCode(value).then((view) => {
        if (live) setChecked({ for: value, view });
      });
    }
    return () => {
      live = false;
    };
  }, [value, quick.state]);

  const view = quick.state === 'checking' && checked?.for === value ? checked.view : quick;
  const valid = view.state === 'ok';
  useEffect(() => {
    onValid?.(valid);
  }, [valid, onValid]);

  const tone = view.state === 'ok' ? 'text-amber' : view.state === 'bad' || view.state === 'typo' ? 'text-loss' : 'text-muted';
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-soft">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
        aria-invalid={view.state === 'bad' || view.state === 'typo'}
        aria-describedby={`${id}-status`}
        className={cx(
          'min-h-14 w-full rounded-[14px] border bg-surface px-4 text-center font-display text-[17px] font-semibold uppercase tracking-[0.08em] text-text placeholder:text-[13px] placeholder:font-normal placeholder:tracking-normal placeholder:text-muted',
          view.state === 'bad' || view.state === 'typo' ? 'border-loss' : view.state === 'ok' ? 'border-accent' : 'border-line',
        )}
      />
      <p id={`${id}-status`} role="status" aria-live="polite" className={cx('m-0 min-h-5 text-xs', tone)}>
        {view.message}
      </p>
      {view.state !== 'empty' && view.state !== 'bad' && view.count > 5 && (
        <p className="m-0 text-center font-display text-sm tracking-[0.1em] text-soft">
          {view.grouped}
        </p>
      )}
    </div>
  );
}
