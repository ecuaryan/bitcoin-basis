import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.ts';
import { CloseIcon } from './icons.tsx';
import { ChevronLeftIcon } from './more-icons.tsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

/**
 * A slide-up sheet (a centered panel on wide screens). Focus moves inside when it opens,
 * stays inside (Tab wraps), Esc or the close button or the backdrop closes it,
 * and focus goes back to whatever opened it. The rest of the page is inert while it is open.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  onBack,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  className?: string;
  /** For a sheet with steps: a back chevron before the title that goes to the step before. */
  onBack?: (() => void) | undefined;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById('root');
    app?.setAttribute('inert', '');
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = panel.current;
    if (el) (focusables(el)[0] ?? el).focus();
    return () => {
      app?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      // Back to where the person was, once the sheet is gone.
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      panel.current.focus();
    } else if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[88dvh] w-full animate-sheet-in flex-col rounded-t-[28px] border border-b-0 border-line bg-surface pb-[max(20px,env(safe-area-inset-bottom))] outline-none sm:max-w-lg sm:rounded-[28px] sm:border-b',
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
          {onBack ? (
            <button type="button" onClick={onBack} aria-label="Back" className="-ml-2 flex size-11 flex-none items-center justify-center rounded-xl text-soft hover:text-text">
              <ChevronLeftIcon size={20} />
            </button>
          ) : null}
          <h2 id={titleId} className="min-w-0 flex-1 font-display text-xl font-semibold tracking-tight">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center rounded-xl border border-line bg-bg text-soft hover:text-text">
            <CloseIcon />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
