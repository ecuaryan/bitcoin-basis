import { usePrice } from '../data/price-provider.tsx';
import { cx } from '../lib/cx.ts';
import { formatMoney, groupedBtc, groupedSats, maskDigits, satsToCents, shortBtc, type MoneyFormat } from '../lib/format.ts';
import { useCountUp } from './motion.ts';
import { usePeekHandlers, usePrefs } from './prefs.tsx';

const HIDDEN_LABEL = 'Amount hidden. Hold to show.';

interface AmountProps {
  sats: number;
  /** Add the unit after the number (`BTC`, `sats`). */
  showUnit?: boolean;
  /** Tap to cycle BTC, sats, USD. Off inside links and buttons. */
  interactive?: boolean;
  countUp?: boolean;
  /** Compact form for lists: `1.1802` (4 decimals) instead of 8. */
  short?: boolean;
  /** Always BTC, whatever unit was picked (for a BTC figure beside its own dollar worth, where sats would wrap the line). */
  alwaysBtc?: boolean;
  /**
   * The dollars to show in USD when the screen already shows what these coins are worth (lot by lot), so the two never
   * differ by a cent. Without it, USD is `sats × price` (half-up).
   */
  valueCents?: number | null;
  className?: string;
}

/** A BTC amount. Shows `0.0074 2665` (8 decimals in two groups) and cycles BTC, sats, USD when tapped. Honors hide-amounts. */
export function Amount({ sats, showUnit = false, interactive = true, countUp = false, short = false, alwaysBtc = false, valueCents = null, className }: AmountProps) {
  const { masked, unit, cycleUnit } = usePrefs();
  const { quote } = usePrice();
  const peek = usePeekHandlers();
  // USD needs a price; without one the amount stays in BTC.
  const effective = alwaysBtc || (unit === 'usd' && quote === null) ? 'btc' : unit;
  const target = effective === 'usd' && quote !== null ? (valueCents ?? satsToCents(sats, quote.usdCents)) : sats;
  const shown = useCountUp(target, countUp);

  const text =
    effective === 'usd'
      ? formatMoney(shown, short ? { precision: 'dollars' } : {})
      : effective === 'sats'
        ? `${groupedSats(shown)}${showUnit ? ' sats' : ''}`
        : `${short ? shortBtc(shown) : groupedBtc(shown)}${showUnit ? ' BTC' : ''}`;
  const label = effective === 'usd' ? 'US dollars' : effective === 'sats' ? 'sats' : 'BTC';

  if (masked) {
    const common = { className: cx('whitespace-nowrap tabular-nums', className), ...peek };
    return interactive ? (
      <button type="button" aria-label={HIDDEN_LABEL} {...common} className={cx('cursor-default touch-none select-none bg-transparent p-0 text-inherit', common.className)}>
        <span aria-hidden="true">{maskDigits(text)}</span>
      </button>
    ) : (
      <span aria-label={HIDDEN_LABEL} role="img" className={common.className}>
        {maskDigits(text)}
      </span>
    );
  }
  if (!interactive) return <span className={cx('whitespace-nowrap tabular-nums', className)}>{text}</span>;
  return (
    <button type="button" onClick={cycleUnit} aria-label={`${text}. Showing ${label}. Tap to change.`} className={cx('whitespace-nowrap bg-transparent p-0 tabular-nums text-inherit', className)}>
      <span aria-hidden="true">{text}</span>
    </button>
  );
}

interface MoneyProps extends MoneyFormat {
  cents: number;
  countUp?: boolean;
  className?: string;
}

/** Dollars from cents: `$1,234.56`. Honors hide-amounts; hold to peek. */
export function Money({ cents, precision = 'cents', signed = false, countUp = false, className }: MoneyProps) {
  const { masked } = usePrefs();
  const peek = usePeekHandlers();
  const shown = useCountUp(cents, countUp);
  const text = formatMoney(shown, { precision, signed });
  if (masked) {
    return (
      <span role="button" tabIndex={0} aria-label={HIDDEN_LABEL} {...peek} className={cx('cursor-default touch-none select-none whitespace-nowrap tabular-nums', className)}>
        <span aria-hidden="true">{maskDigits(text)}</span>
      </span>
    );
  }
  return <span className={cx('whitespace-nowrap tabular-nums', className)}>{text}</span>;
}
