import { useMemo } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { ChevronRightIcon } from '../../ui/icons.tsx';
import { taxProfileSet } from '../records/settings-logic.ts';

export const TAX_PROFILE_PROMPT = 'Set your filing status and state for tax estimates';

/** One calm line, until filing status and state have been chosen: tax estimates need them. Links to Settings › Taxes. */
export function TaxProfilePrompt({ className }: { className?: string }) {
  const { entries } = useLedger();
  const set = useMemo(() => taxProfileSet(entries), [entries]);
  if (set.filing && set.state) return null;
  return (
    <Link
      to="/settings#taxes"
      className={cx('press flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-[13px] font-semibold text-text no-underline hover:bg-surface-2', className)}
    >
      <span>{TAX_PROFILE_PROMPT}</span>
      <ChevronRightIcon size={16} className="flex-none text-muted" />
    </Link>
  );
}
