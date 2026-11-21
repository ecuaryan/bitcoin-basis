import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../lib/cx.ts';
import { Button } from './Button.tsx';

/**
 * The one section header: title on the left (with its "?" help right after the words), a count or one action on the
 * right. Use `SectionCount` or `SectionLink` for the right side.
 */
export function SectionHeader({ title, help, right, className }: { title: ReactNode; help?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-h-11 items-center justify-between gap-3', className)}>
      <h2 className="m-0 flex min-w-0 items-center gap-1 text-[15px] font-semibold">
        {title}
        {help}
      </h2>
      {right}
    </div>
  );
}

/** A count on the right of a section header: `9 entries`, `3 of 9 entries`. Announced when it changes. */
export function SectionCount({ children }: { children: ReactNode }) {
  return (
    <span role="status" className="flex-none text-xs text-muted">
      {children}
    </span>
  );
}

/** The one action on the right of a section header: `All 9 entries`. */
export function SectionLink({ to, children, label }: { to: string; children: ReactNode; label?: string }) {
  return (
    <Link to={to} aria-label={label} className="flex min-h-11 flex-none items-center text-[13px] font-semibold no-underline">
      {children}
    </Link>
  );
}

/** Under a shortened list: `Show all 12 entries` (or `Show 40 more` for a long one). Always left, as a quiet button. */
export function ShowMore({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <Button variant="ghost" onClick={onClick} className="-ml-4 self-start">
      {children}
    </Button>
  );
}

/** What a list says when it has nothing in it. */
export function EmptyLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('m-0 py-3 text-sm text-muted', className)}>{children}</p>;
}
