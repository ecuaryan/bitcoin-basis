import { useId, useState, type InputHTMLAttributes, type Ref, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';

/** The look of every text box: a dark well with a 14px radius (matches the Log design). */
export const INPUT_CLASSES =
  'w-full min-h-[52px] rounded-[14px] border border-line bg-bg px-3.5 text-base text-text placeholder:text-muted/70 focus-visible:border-accent disabled:opacity-60';

/** A box that wraps an input (prefix, unit, trailing text): the box draws the one focus ring; the input inside draws none. */
export const FRAME_FOCUS = 'focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-amber';
/** For the bare input inside such a box. */
export const INNER_INPUT = 'border-0 bg-transparent outline-none focus-visible:border-0 focus-visible:outline-none';

interface FieldFrameProps {
  label: string;
  id: string;
  hint?: ReactNode;
  error?: string | null | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * A label above a control, with an optional hint and error under it. Once an error has shown, its line stays reserved
 * (blank) after it is fixed, so typing the fix does not make the form below jump up.
 */
export function FieldFrame({ label, id, hint, error, className, children }: FieldFrameProps) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${id}-hint`} className="text-xs leading-snug text-muted">
          {hint}
        </span>
      ) : null}
      <ErrorLine id={`${id}-err`} error={error} />
    </div>
  );
}

/**
 * An error under a field. Once it has shown, its line stays reserved (blank) after the error is fixed, so typing the
 * fix does not make everything below jump up.
 */
export function ErrorLine({ id, error, className }: { id?: string; error: string | null | undefined | false; className?: string }) {
  const [shown, setShown] = useState(Boolean(error));
  if (error && !shown) setShown(true);
  if (error) {
    return (
      <span id={id} role="alert" className={cx('text-xs leading-snug text-loss', className)}>
        {error}
      </span>
    );
  }
  return shown ? (
    <span aria-hidden="true" className={cx('text-xs leading-snug', className)}>
      {'\u00a0'}
    </span>
  ) : null;
}

function describedBy(id: string, hint: ReactNode, error: string | null | undefined): string | undefined {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ');
  return ids === '' ? undefined : ids;
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null | undefined;
  frameClassName?: string;
  /** Something small on the right inside the box, such as "$77,019 per BTC". */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, frameClassName, trailing, className, ...rest }: TextFieldProps) {
  const id = useId();
  const input = (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
      className={cx(INPUT_CLASSES, trailing ? cx('flex-1 !min-h-0 px-0', INNER_INPUT) : '', className)}
      {...rest}
    />
  );
  return (
    <FieldFrame label={label} id={id} hint={hint} error={error} className={frameClassName}>
      {trailing ? (
        <div className={cx('flex min-h-[52px] items-center justify-between gap-3 rounded-[14px] border border-line bg-bg px-3.5', FRAME_FOCUS)}>
          {input}
          <span className="flex-none text-xs text-muted">{trailing}</span>
        </div>
      ) : (
        input
      )}
    </FieldFrame>
  );
}

export function TextAreaField({ label, hint, error, frameClassName, className, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { label: string; hint?: ReactNode; error?: string | null | undefined; frameClassName?: string }) {
  const id = useId();
  return (
    <FieldFrame label={label} id={id} hint={hint} error={error} className={frameClassName}>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} rows={2} className={cx(INPUT_CLASSES, 'py-3', className)} {...rest} />
    </FieldFrame>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** A native select drawn like the design's wallet button (keyboard and screen reader friendly for free). */
export function SelectField({ label, options, hint, error, frameClassName, className, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> & { label: string; options: readonly SelectOption[]; hint?: ReactNode; error?: string | null | undefined; frameClassName?: string }) {
  const id = useId();
  return (
    <FieldFrame label={label} id={id} hint={hint} error={error} className={frameClassName}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cx(INPUT_CLASSES, 'cursor-pointer appearance-none pr-10 font-semibold', className)}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </FieldFrame>
  );
}

type Tone = 'info' | 'warn' | 'cpa' | 'error';
const TONE: Record<Tone, string> = {
  info: 'border-line bg-bg text-soft',
  warn: 'border-amber/40 bg-amber/10 text-soft',
  cpa: 'border-amber/40 bg-amber/10 text-soft',
  error: 'border-loss/50 bg-loss/10 text-soft',
};

/** A short boxed note. `cpa` is for "confirm with your CPA" items. */
export function Callout({ tone = 'info', title, children, className, role }: { tone?: Tone; title?: string; children: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={cx('flex flex-col gap-1 rounded-2xl border px-3.5 py-3 text-[13px] leading-snug normal-nums', TONE[tone], className)}>
      {title ? <strong className={cx('text-[13px] font-semibold', tone === 'error' ? 'text-loss' : tone === 'info' ? 'text-text' : 'text-amber')}>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

/** Label and value on one line, for review lists. */
export function SummaryRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0', className)}>
      <dt className="flex-none text-[13px] text-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-sm font-semibold">{children}</dd>
    </div>
  );
}
