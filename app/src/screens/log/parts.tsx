import { useId, useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { cleanDecimal, formatMoney, prettyBtc, prettyDollars } from '../../lib/format.ts';
import { MoneyInput } from '../../ui/formatted-inputs.tsx';
import { SelectField, TextField, type SelectOption } from '../../ui/form-fields.tsx';
import { AddWalletSheet } from '../wallet/AddWallet.tsx';
import type { AmountState, PriceAt, ValueState } from './hooks.ts';
import type { AmountUnit } from './model.ts';

const UNITS: readonly { value: AmountUnit; label: string }[] = [
  { value: 'btc', label: 'BTC' },
  { value: 'sats', label: 'sats' },
  { value: 'usd', label: 'USD' },
];

/** The big amount box with a BTC / sats / USD switch (one field, one unit at a time). */
export function AmountInput({ amount, label = 'Amount', error, needsPrice }: { amount: AmountState; label?: string; error?: string | null | undefined; needsPrice?: boolean }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const placeholder = amount.unit === 'usd' ? '0.00' : amount.unit === 'sats' ? '0' : '0.0000 0000';
  const clean = (t: string): string => (amount.unit === 'btc' ? cleanDecimal(t, 8) : amount.unit === 'usd' ? cleanDecimal(t, 2) : t.replace(/\D/g, ''));
  const pretty = (t: string): string => (amount.unit === 'btc' ? prettyBtc(t) : amount.unit === 'usd' ? prettyDollars(t) : t.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={focused ? amount.text : pretty(amount.text)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => amount.setText(clean(e.target.value))}
        className="w-full rounded-xl border-0 bg-transparent py-1 text-center font-display text-[40px] font-semibold tracking-[-0.02em] text-text placeholder:text-muted/40 sm:text-[44px]"
      />
      <div role="group" aria-label="Unit for the amount" className="flex gap-1">
        {UNITS.map((u) => {
          const on = amount.unit === u.value;
          return (
            <button key={u.value} type="button" aria-pressed={on} onClick={() => amount.setUnit(u.value)} className="flex min-h-11 items-center bg-transparent px-1">
              <span className={cx('flex h-8 items-center rounded-2xl border px-3 text-xs font-semibold', on ? 'border-accent bg-accent/12 text-amber' : 'border-line text-muted')}>{u.label}</span>
            </button>
          );
        })}
      </div>
      {needsPrice && amount.unit === 'usd' ? <span className="text-xs text-muted">Turned into BTC at the market price for that time.</span> : null}
      {error ? (
        <span id={`${id}-err`} role="alert" className="text-xs text-loss">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** A dollar value that starts from the market price. Typing in it overrides the price. The price hint shows only once there is an amount. */
export function ValueField({ label, value, price, error, hasAmount = true }: { label: string; value: ValueState; price: PriceAt; error?: string | null | undefined; hasAmount?: boolean }) {
  const hint: ReactNode = value.overridden ? (
    <span>
      You entered this value.{' '}
      <button type="button" onClick={value.reset} className="min-h-6 bg-transparent p-0 text-xs font-semibold text-amber underline-offset-2 hover:underline">
        Use the price service instead
      </button>
    </span>
  ) : !hasAmount ? undefined : price.status === 'loading' ? (
    'Getting the price for that time…'
  ) : price.cents === null ? (
    'No price for that time. Type the value you know.'
  ) : (
    `From ${price.source} at ${formatMoney(price.cents)} per BTC at that time. Change it if you know better.`
  );
  return <MoneyInput label={label} value={value.text} onChange={value.setText} hint={hint} error={error} />;
}

export function WhenField({ value, onChange, error, label = 'When' }: { value: string; onChange(v: string): void; error?: string | null | undefined; label?: string }) {
  return <TextField label={label} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} error={error} />;
}

/** "More details": the rarely needed fields. Opens by itself when something inside needs attention. */
export function MoreDetails({ open, onOpenChange, children }: { open: boolean; onOpenChange(open: boolean): void; children: ReactNode }) {
  return (
    <details open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)} className="rounded-2xl border border-line px-3.5 py-1">
      <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-soft">More details</summary>
      <div className="flex flex-col gap-3 pb-3">{children}</div>
    </details>
  );
}

/** The pinned button row at the bottom of a form. */
export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 -mx-5 mt-2 flex gap-2.5 bg-[linear-gradient(180deg,rgb(22_21_20/0),var(--color-surface)_28%)] px-5 pb-1 pt-4">{children}</div>;
}

export const ADD_WALLET = '__new__';

/** A wallet picker with an "Add a wallet" choice that opens the add-wallet sheet. */
export function WalletSelect({ label, value, onChange, wallets, error, hint, frameClassName }: { label: string; value: string; onChange(id: string): void; wallets: readonly { id: string; name: string }[]; error?: string | null | undefined; hint?: ReactNode; frameClassName?: string }) {
  const [adding, setAdding] = useState(false);
  const options: SelectOption[] = [...wallets.map((w) => ({ value: w.id, label: w.name })), { value: ADD_WALLET, label: 'Add a wallet…' }];
  if (!wallets.some((w) => w.id === value)) options.unshift({ value: '', label: 'Choose a wallet' });
  return (
    <>
      <SelectField
        label={label}
        value={value}
        options={options}
        error={error}
        hint={hint}
        {...(frameClassName === undefined ? {} : { frameClassName })}
        onChange={(e) => {
          if (e.target.value === ADD_WALLET) setAdding(true);
          else onChange(e.target.value);
        }}
      />
      <AddWalletSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(id) => {
          setAdding(false);
          onChange(id);
        }}
      />
    </>
  );
}
