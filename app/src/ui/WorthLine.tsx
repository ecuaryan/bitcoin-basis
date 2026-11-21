import { cx } from '../lib/cx.ts';
import type { WorthNow } from '../lib/worth-now.ts';
import { Money } from './Amount.tsx';
import { PlainMoney } from './plain-money.tsx';

/**
 * `up $340.12 (+38%)`, `down $55.20 (−4%)` or `even`. The dollars hide with hide-amounts; the word and percent stay.
 * `plain` for use inside a button or link (no hold-to-peek control nested in another control).
 */
export function GainWords({ worth, plain = false, className }: { worth: WorthNow; plain?: boolean; className?: string }) {
  const { gainCents, percent } = worth;
  if (gainCents === null) return <span className={className}>—</span>;
  if (gainCents === 0) return <span className={className}>even</span>;
  const up = gainCents > 0;
  const pct = percent === null ? '' : percent === 0 ? ' (under 1%)' : ` (${up ? '+' : '−'}${Math.abs(percent)}%)`;
  const dollars = Math.abs(gainCents);
  return (
    <span className={cx(up ? 'text-accent' : 'text-loss', className)}>
      {up ? 'up' : 'down'} {plain ? <PlainMoney cents={dollars} /> : <Money cents={dollars} />}
      {pct}
    </span>
  );
}

/** `Now $1,240.12 · up $340.12 (+38%)`. With no price: `Now —`. Plain text: it sits inside tappable coin rows. */
export function WorthLine({ worth, className }: { worth: WorthNow; className?: string }) {
  if (worth.valueCents === null) return <span className={className}>Now —</span>;
  return (
    <span className={className}>
      <span className="text-soft">
        Now <PlainMoney cents={worth.valueCents} /> ·{' '}
      </span>
      <GainWords worth={worth} plain className="font-semibold" />
    </span>
  );
}
