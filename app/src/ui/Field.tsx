import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';
import { ChevronDownIcon } from './more-icons.tsx';

export const INPUT_CLASSES =
  'min-h-12 w-full rounded-[14px] border border-line bg-bg px-3 text-base font-semibold text-text placeholder:font-normal placeholder:text-muted disabled:opacity-50';

/** A labelled text input. The label is always visible and attached to the control. */
export function Field({
  label,
  suffix,
  hint,
  className,
  inputClassName,
  ...rest
}: { label: string; suffix?: string; hint?: ReactNode; className?: string; inputClassName?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <div className="relative">
        <input id={id} aria-describedby={hint ? hintId : undefined} className={cx(INPUT_CLASSES, suffix && 'pr-14', inputClassName)} {...rest} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted">{suffix}</span>}
      </div>
      {hint && (
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

/** A native select (full keyboard and screen reader support) drawn in the app's style. */
export function SelectBox({
  label,
  hideLabel = false,
  className,
  selectClassName,
  children,
  ...rest
}: { label: string; hideLabel?: boolean; className?: string; selectClassName?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-xs text-muted'}>
        {label}
      </label>
      <div className="relative">
        <select id={id} className={cx(INPUT_CLASSES, 'cursor-pointer appearance-none pr-9', selectClassName)} {...rest}>
          {children}
        </select>
        <ChevronDownIcon size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>
    </div>
  );
}

/** A switch with a visible label (a checkbox underneath, so keyboard and screen readers just work). */
export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(next: boolean): void; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className="relative h-7 w-12 flex-none rounded-full bg-surface-2 transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-amber after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-text after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-bg" />
    </label>
  );
}
