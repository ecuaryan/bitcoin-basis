import { formatMoney, maskDigits, type MoneyFormat } from '../lib/format.ts';
import { usePrefs } from './prefs.tsx';

/**
 * Dollars that honor hide-amounts but are plain text (no press-to-peek), for use inside buttons and links,
 * where `Money` would nest one interactive element in another.
 */
export function PlainMoney({ cents, ...format }: { cents: number } & MoneyFormat) {
  const { masked } = usePrefs();
  const text = formatMoney(cents, format);
  return masked ? (
    <span role="img" aria-label="Amount hidden" className="tabular-nums">
      {maskDigits(text)}
    </span>
  ) : (
    <span className="tabular-nums">{text}</span>
  );
}
