import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx.ts';

/** The standard warm-charcoal surface. Use `as="section"` with an aria-label for page sections. */
export function Card({ as: Tag = 'div', className, ...rest }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'article' | 'li' }) {
  return <Tag className={cx('rounded-[20px] border border-line bg-surface p-4 lg:p-5', className)} {...rest} />;
}

/** A small label above a value, as in the stat tiles. */
export function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xl font-semibold">{children}</span>
    </div>
  );
}
