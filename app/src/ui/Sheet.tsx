import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.ts';
import { CloseIcon } from './icons.tsx';
import { ChevronLeftIcon } from './more-icons.tsx';
import { prefersReducedMotion } from './motion.ts';
import { trackSheet } from './close-watch.ts';
import { backdropOpacity, dragOffset, releaseVelocity, shouldCloseOnRelease } from './sheet-drag.ts';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

type Slots = { header: HTMLElement | null; footer: HTMLElement | null; paused: boolean };
const SlotsContext = createContext<Slots>({ header: null, footer: null, paused: false });

/**
 * Put content into a fixed part of a `fixedHeight` Sheet: the header (under the title, never scrolls) or the footer
 * (pinned above the bottom, never moves). In any other sheet it just renders where it is.
 */
export function SheetSlot({ name, children }: { name: 'header' | 'footer'; children: ReactNode }) {
  const slots = useContext(SlotsContext);
  const target = slots[name];
  if (slots.paused) return null;
  return target ? createPortal(children, target) : <>{children}</>;
}

/** Hide the slot content of a part of the sheet that is mounted but not showing (a form behind its review step). */
export function SheetSlotsPaused({ paused, children }: { paused: boolean; children: ReactNode }) {
  const slots = useContext(SlotsContext);
  return <SlotsContext.Provider value={{ ...slots, paused: slots.paused || paused }}>{children}</SlotsContext.Provider>;
}

/** True when the sheet has a fixed footer, so a form's button row should not use its own sticky one. */
export function useFixedFooter(): boolean {
  return useContext(SlotsContext).footer !== null;
}

/**
 * A slide-up sheet (a centered panel on wide screens). Focus moves inside when it opens,
 * stays inside (Tab wraps), Esc or the close button or the backdrop closes it,
 * and focus goes back to whatever opened it. The rest of the page is inert while it is open.
 * On a phone it can also be dragged down to close: from the grab handle or title row, or from the body
 * when that is scrolled to the top. The grab handle is decoration; the Close button is the accessible way.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  onBack,
  fixedHeight = false,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  className?: string;
  /** For a sheet with steps: a back chevron before the title that goes to the step before. */
  onBack?: (() => void) | undefined;
  /**
   * A form sheet with a stable height: it fills most of the screen whatever is inside, so nothing moves between tabs or steps.
   * Content marked with SheetSlot sits in a fixed header or footer; only the middle scrolls. It follows the on-screen keyboard.
   */
  fixedHeight?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const backdrop = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const timers = useRef<number[]>([]);
  const wrapper = useRef<HTMLDivElement>(null);
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  const [more, setMore] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  // After `open` turns false the sheet stays on screen for a moment, sliding away (no exit under reduced motion,
  // or after a drag, which already moved it off). It is inert and hidden from assistive tech while it goes.
  const [rendered, setRendered] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  const [skipExit, setSkipExit] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setRendered(true);
      setSkipExit(false);
    } else if (skipExit || prefersReducedMotion()) {
      setRendered(false);
    }
  }
  useEffect(() => {
    if (open || !rendered) return;
    const t = window.setTimeout(() => setRendered(false), 180);
    return () => window.clearTimeout(t);
  }, [open, rendered]);

  // A drag in the body must stop the browser from scrolling or pulling to refresh, which only a non-passive touchmove can do.
  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const onTouchMove = (e: TouchEvent) => {
      const g = gesture.current;
      const t = e.touches[0];
      if (!g || !t || g.zone !== 'body' || g.blocked) return;
      if (g.active || (t.clientY - g.y0 > 0 && body.current !== null && body.current.scrollTop <= 0)) {
        if (e.cancelable) e.preventDefault();
      }
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [open]);

  // Fixed height: track the visible area (it shrinks when the keyboard is up) so the footer sits right above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = wrapper.current;
    if (!fixedHeight || !open || !vv || !el) return;
    const sync = () => {
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
      el.style.bottom = 'auto';
      setKeyboard(window.innerHeight - vv.height > 120);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, [fixedHeight, open, rendered]);

  // Fixed height: a soft fade above the footer while there is more to scroll to.
  useEffect(() => {
    const el = body.current;
    if (!fixedHeight || !el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  });

  useEffect(() => {
    if (!open) return;
    const pending = timers.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById('root');
    app?.setAttribute('inert', '');
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = panel.current;
    if (el) (focusables(el)[0] ?? el).focus();
    const untrack = trackSheet(() => onCloseRef.current());
    return () => {
      untrack();
      for (const id of pending) window.clearTimeout(id);
      pending.length = 0;
      gesture.current = null;
      app?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      // Back to where the person was, once the sheet is gone.
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open && !rendered) return null;
  const closing = !open;

  function setPosition(offset: number, animate: boolean) {
    const el = panel.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    el.style.transform = offset === 0 && animate ? '' : `translateY(${offset}px)`;
    if (backdrop.current) {
      backdrop.current.style.transition = animate ? 'opacity 200ms ease-out' : 'none';
      backdrop.current.style.opacity = String(backdropOpacity(offset, el.offsetHeight));
    }
  }

  function springBack() {
    const el = panel.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.transition = 'none';
      el.style.transform = '';
      if (backdrop.current) {
        backdrop.current.style.transition = 'none';
        backdrop.current.style.opacity = '';
      }
      return;
    }
    setPosition(0, true);
    if (backdrop.current) backdrop.current.style.opacity = '';
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    gesture.current = null;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (window.matchMedia('(min-width: 640px)').matches) return;
    const target = e.target as HTMLElement;
    const inHeader = target.closest('[data-sheet-grip]') !== null;
    if (inHeader) {
      if (target.closest('button, a, input, select, textarea')) return;
    } else {
      // The body: only a finger or pen (a mouse there is selecting text), never on a control that drags itself.
      if (e.pointerType === 'mouse') return;
      if (target.closest('input, textarea, select, [role="slider"], [contenteditable]')) return;
    }
    let blocked = false;
    if (!inHeader) {
      if (body.current === null || body.current.scrollTop > 0) blocked = true;
      // Something scrollable inside the body that is not at its top keeps its own scroll.
      for (let n: HTMLElement | null = target; n && n !== body.current && !blocked; n = n.parentElement) {
        if (n.scrollTop > 0) blocked = true;
      }
    }
    gesture.current = {
      zone: inHeader ? 'grip' : 'body',
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      active: false,
      blocked,
      samples: [{ t: e.timeStamp, y: e.clientY }],
    };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || g.blocked) return;
    const dy = e.clientY - g.y0;
    const dx = e.clientX - g.x0;
    if (!g.active) {
      const vertical = Math.abs(dy) > Math.abs(dx);
      if (g.zone === 'body') {
        if (dy < -4) g.blocked = true;
        else if (dy > 6 && vertical && body.current !== null && body.current.scrollTop <= 0) activate(e, g);
      } else if (Math.abs(dy) > 4 && vertical) {
        activate(e, g);
      }
      return;
    }
    g.samples.push({ t: e.timeStamp, y: e.clientY });
    if (g.samples.length > 12) g.samples.shift();
    setPosition(dragOffset(dy), false);
  }

  function activate(e: ReactPointerEvent<HTMLDivElement>, g: Gesture) {
    g.active = true;
    try {
      panel.current?.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; the release handler cleans up.
    }
    // Text under the finger should not get selected while the sheet moves.
    window.getSelection()?.removeAllRanges();
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!g.active) return;
    const el = panel.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (!el) return;
    const dy = e.clientY - g.y0;
    g.samples.push({ t: e.timeStamp, y: e.clientY });
    if (cancelled || !shouldCloseOnRelease(dy, el.offsetHeight, releaseVelocity(g.samples))) {
      springBack();
      return;
    }
    // Close through the same path as the Close button (it may ask first); if it stays open, settle back.
    const settle = () => {
      timers.current.push(
        window.setTimeout(() => {
          if (panel.current) springBack();
        }, 60),
      );
    };
    setSkipExit(true);
    if (prefersReducedMotion()) {
      onCloseRef.current();
      settle();
      return;
    }
    setPosition(el.offsetHeight, true);
    timers.current.push(
      window.setTimeout(() => {
        onCloseRef.current();
        settle();
      }, 190),
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      // Handled here, so the browser's close watcher (the back gesture's handler) does not close it a second time.
      e.preventDefault();
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
    <div ref={wrapper} className={cx('fixed inset-0 z-50 flex items-end justify-center sm:items-center', closing && 'pointer-events-none')} onKeyDown={closing ? undefined : onKeyDown} inert={closing} aria-hidden={closing || undefined}>
      <div ref={backdrop} className={cx('absolute inset-0 bg-black/60', closing ? 'animate-fade-out' : 'animate-fade-in')} onClick={closing ? undefined : onClose} aria-hidden="true" />
      <div
        ref={panel}
        role={closing ? undefined : 'dialog'}
        aria-modal={closing ? undefined : true}
        aria-labelledby={closing ? undefined : titleId}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        className={cx(
          fixedHeight ? (keyboard ? 'h-full' : 'h-[90%] sm:h-[min(680px,88%)]') : 'max-h-[88dvh]',
          'relative flex w-full flex-col rounded-t-[28px] shadow-[0_-12px_40px_rgb(0_0_0/0.35)] sm:shadow-[0_24px_64px_rgb(0_0_0/0.55)]',
          closing ? 'animate-sheet-out sm:animate-fade-out' : 'animate-sheet-in sm:animate-sheet-pop',
          'border border-b-0 border-line bg-surface pb-[max(20px,env(safe-area-inset-bottom))] outline-none sm:max-w-lg sm:rounded-[28px] sm:border-b',
          className,
        )}
      >
        <div data-sheet-grip className="touch-none sm:touch-auto">
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
            {onBack ? (
              <button type="button" onClick={onBack} aria-label="Back" className="press -ml-2 flex size-11 flex-none items-center justify-center rounded-xl text-soft hover:text-text">
                <ChevronLeftIcon size={20} />
              </button>
            ) : null}
            <h2 id={titleId} className="min-w-0 flex-1 font-display text-xl font-semibold tracking-tight">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="press flex size-11 items-center justify-center rounded-xl border border-line bg-bg text-soft hover:text-text">
              <CloseIcon />
            </button>
          </div>
          {fixedHeight ? <div ref={setHeaderEl} className="px-5 pb-2 empty:hidden" /> : null}
        </div>
        <div className={cx('relative flex min-h-0 flex-col', fixedHeight && 'flex-1')}>
          <div ref={body} className={'min-h-0 flex-1 overflow-y-auto px-5 pb-2'}>
            <SlotsContext.Provider value={{ header: headerEl, footer: footerEl, paused: false }}>{children}</SlotsContext.Provider>
          </div>
          {fixedHeight ? <div aria-hidden="true" className={cx('pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent transition-opacity duration-150', more ? 'opacity-100' : 'opacity-0')} /> : null}
        </div>
        {fixedHeight ? <div ref={setFooterEl} className="px-5 pt-1 empty:hidden" /> : null}
      </div>
    </div>,
    document.body,
  );
}

type Gesture = {
  zone: 'grip' | 'body';
  id: number;
  x0: number;
  y0: number;
  active: boolean;
  blocked: boolean;
  samples: { t: number; y: number }[];
};
