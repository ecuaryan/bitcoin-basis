import { useMemo } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { ChevronRightIcon } from '../../ui/icons.tsx';
import { assumesNoIncome, taxProfileMissing, taxProfileSet } from '../records/settings-logic.ts';

/** The prompt's words: `Set your filing status, state and income for tax estimates` (only what is missing). */
export function taxProfilePromptText(missing: string): string {
  return `Set your ${missing} for tax estimates`;
}

/** One calm line, until filing status, state and income have been chosen: tax estimates need them. Links to Settings › Taxes. */
export function TaxProfilePrompt({ className }: { className?: string }) {
  const { entries } = useLedger();
  const missing = useMemo(() => taxProfileMissing(taxProfileSet(entries)), [entries]);
  if (missing === null) return null;
  return (
    <Link
      to="/settings#taxes"
      className={cx('press flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-[13px] font-semibold text-text no-underline hover:bg-surface-2', className)}
    >
      <span>{taxProfilePromptText(missing)}</span>
      <ChevronRightIcon size={16} className="flex-none text-muted" />
    </Link>
  );
}

export const NO_INCOME_NOTE = 'Assumes $0 other income.';

/**
 * Beside every tax estimate while income was never entered: `Assumes $0 other income. Set your income in Settings.`
 * Nothing once any amount (0 included) has been saved. `link={false}` inside a sheet (plain words, no navigation).
 */
export function NoIncomeNote({ className, link = true }: { className?: string; link?: boolean }) {
  const { entries, state } = useLedger();
  const show = useMemo(() => assumesNoIncome(taxProfileSet(entries), state.settings), [entries, state.settings]);
  if (!show) return null;
  return (
    <p className={cx('m-0 text-[13px] leading-snug text-amber', className)}>
      {NO_INCOME_NOTE} Set your income in{' '}
      {link ? (
        <Link to="/settings#taxes" className="font-semibold text-amber underline underline-offset-2 hover:text-text">
          Settings
        </Link>
      ) : (
        'Settings'
      )}
      .
    </p>
  );
}
