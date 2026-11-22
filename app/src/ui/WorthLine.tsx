import { maskDigits } from '../lib/format.ts';
import { cx } from '../lib/cx.ts';
import type { WorthNow } from '../lib/worth-now.ts';
import { Money } from './Amount.tsx';
import { PlainMoney } from './plain-money.tsx';
import { usePrefs } from './prefs.tsx';

/**
 * `up $340.12 (+38%)`, `down $55.20 (−4%)` or `even`. With hide-amounts the dollars and the percent hide; the word stays.
 * `plain` for use inside a button or link (no hold-to-peek control nested in another control). `precision="dollars"`
 * for card-level totals (whole dollars, toward zero). `showPercent={false}` for tight rows that show only the dollars.
 */
export function GainWords({ worth, plain = false, precision = 'cents', showPercent = true, className }: { worth: WorthNow; plain?: boolean; precision?: 'cents' | 'dollars'; showPercent?: boolean; className?: string }) {
  const { masked } = usePrefs();
  const { gainCents, percent } = worth;
  if (gainCents === null) return <span className={className}>—</span>;
  if (gainCents === 0) return <span className={className}>even</span>;
  const up = gainCents > 0;
  const shown = percent === null || !showPercent ? '' : percent === 0 ? ' (under 1%)' : ` (${up ? '+' : '−'}${Math.abs(percent)}%)`;
  // Hidden amounts hide the digits but keep the room, so nothing on the screen moves.
  const pct = masked ? maskDigits(shown) : shown;
  const dollars = Math.abs(gainCents);
  return (
    <span className={cx('whitespace-nowrap', up ? 'text-accent' : 'text-loss', className)}>
      {up ? 'up' : 'down'} {plain ? <PlainMoney cents={dollars} precision={precision} /> : <Money cents={dollars} precision={precision} />}
      {pct}
    </span>
  );
}

/** `Now $1,240.12 · up $340.12 (+38%)`. With no price: `Now —`. Plain text: it sits inside tappable coin rows. */
export function WorthLine({ worth, className }: { worth: WorthNow; className?: string }) {
  if (worth.valueCents === null) return <span className={className}>Now —</span>;
  return (
    <span className={className}>
      {/* Each half keeps together, so a narrow row breaks after the dot, never before it or inside the gain. */}
      <span className="whitespace-nowrap text-soft">
        Now <PlainMoney cents={worth.valueCents} /> ·
      </span>{' '}
      <GainWords worth={worth} plain className="font-semibold" />
    </span>
  );
}
