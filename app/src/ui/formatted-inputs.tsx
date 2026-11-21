import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cleanDecimal, prettyBtc, prettyDollars } from '../lib/format.ts';
import { cx } from '../lib/cx.ts';
import { FieldFrame, FRAME_FOCUS, INNER_INPUT, INPUT_CLASSES } from './form-fields.tsx';

/**
 * Number boxes that look finished: a `$` that stays put, thousands separators and BTC groups once you leave the box.
 * The value you hold and get back is always the plain number text (`130000`, `1.5`, `11.5`), so
 * `parseDollars`, `parseBtc` and friends keep working. Pasting `$94,812.40 USD` gives `94812.40`.
 */
interface NumberBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange' | 'type' | 'inputMode' | 'prefix'> {
  label: string;
  /** The plain number text. */
  value: string;
  onChange(value: string): void;
  hint?: ReactNode;
  error?: string | null | undefined;
  frameClassName?: string;
  /** Something small on the right inside the box (a unit toggle, `per BTC`). */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

function NumberBox({
  label,
  value,
  onChange,
  hint,
  error,
  frameClassName,
  trailing,
  className,
  onFocus,
  onBlur,
  leading,
  maxDecimals,
  pretty,
  ref,
  ...rest
}: NumberBoxProps & { leading?: ReactNode; maxDecimals: number; pretty(clean: string): string }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const shown = focused ? value : pretty(value);
  const own = useRef<HTMLInputElement | null>(null);
  // The text swaps from "31,250" to "31250" as you arrive, which drops the selection; select it again so typing replaces it.
  useLayoutEffect(() => {
    if (focused) own.current?.select();
  }, [focused]);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <FieldFrame label={label} id={id} hint={hint} error={error} className={frameClassName}>
      <div className={cx('flex min-h-[52px] items-center gap-1.5 rounded-[14px] border bg-bg px-3.5', FRAME_FOCUS, error ? 'border-loss/60' : 'border-line')}>
        {leading ? (
          <span aria-hidden="true" className="flex-none text-[15px] font-semibold text-muted">
            {leading}
          </span>
        ) : null}
        <input
          id={id}
          ref={(el) => {
            own.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={shown}
          onChange={(e) => onChange(cleanDecimal(e.target.value, maxDecimals))}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          className={cx(INPUT_CLASSES, 'flex-1 !min-h-0 min-w-0 !px-0 font-semibold', INNER_INPUT, className)}
          {...rest}
        />
        {trailing ? <span className="flex-none text-xs text-muted">{trailing}</span> : null}
      </div>
    </FieldFrame>
  );
}

/** Dollars: a `$` in front, `130,000` or `94,812.40` after you leave the box. Value: `130000`, `94812.40`. */
export function MoneyInput(props: NumberBoxProps) {
  return <NumberBox placeholder="0.00" {...props} leading="$" maxDecimals={2} pretty={prettyDollars} />;
}

/** Bitcoin: `1.0000 0000` after you leave the box (`1,234.5678 9013` when large). Value: `1`, `0.00123`. */
export function BtcInput(props: NumberBoxProps) {
  return <NumberBox placeholder="0.0000 0000" {...props} maxDecimals={8} pretty={prettyBtc} />;
}

/** A percentage: `11.5` with a `%` that stays put. Value: `11.5`. */
export function PercentInput({ trailing, ...props }: NumberBoxProps) {
  return <NumberBox placeholder="0" {...props} trailing={trailing ?? '%'} maxDecimals={2} pretty={(c) => c} />;
}
