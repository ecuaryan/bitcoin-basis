import { taxTableNotice } from '../lib/tax-table-notice.ts';
import { cx } from '../lib/cx.ts';

/** "Using 2027 tax rates; 2028 rates aren't in the app yet." Shown only when the year fell back to another table. */
export function TaxTableNotice({ year, className }: { year: number; className?: string }) {
  const text = taxTableNotice(year);
  if (text === null) return null;
  return <p className={cx('m-0 text-xs text-muted', className)}>{text}</p>;
}
