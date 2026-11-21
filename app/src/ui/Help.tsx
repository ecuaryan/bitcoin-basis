import { useId, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

/** A small "?" that opens a short explanation. Put `button` next to a label and `panel` below it. */
export function useHelp(label: string, text: string): { button: ReactNode; panel: ReactNode; open: boolean } {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls={id}
      onClick={() => setOpen((o) => !o)}
      className="-my-3 -ml-2 -mr-1.5 inline-flex size-11 flex-none items-center justify-center bg-transparent p-0 text-muted hover:text-text"
    >
      <span aria-hidden="true" className={cx('flex size-[18px] items-center justify-center rounded-full border text-[11px] font-bold leading-none', open ? 'border-accent text-accent' : 'border-current')}>
        ?
      </span>
    </button>
  );
  const panel = open ? (
    <p id={id} className="m-0 text-xs leading-[1.45] text-soft">
      {text}
    </p>
  ) : null;
  return { button, panel, open };
}
