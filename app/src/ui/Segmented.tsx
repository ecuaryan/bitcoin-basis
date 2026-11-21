import { useId, useRef, type KeyboardEvent } from 'react';
import { cx } from '../lib/cx.ts';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Pick one of a few options. A radio group: arrow keys move, Tab leaves. */
export function Segmented<T extends string>({ options, value, onChange, label, className, solid = false }: { solid?: boolean; options: readonly SegmentedOption<T>[]; value: T; onChange(value: T): void; label: string; className?: string }) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (index + dir + options.length) % options.length;
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      refs.current[next]?.focus();
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className={cx('flex rounded-xl border border-line bg-surface p-1', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            id={`${id}-${o.value}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx('min-h-11 flex-1 rounded-lg px-3 text-sm transition-colors duration-150', on ? (solid ? 'bg-accent font-bold text-bg' : 'bg-accent/15 font-semibold text-amber') : 'font-medium text-soft hover:text-text')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
