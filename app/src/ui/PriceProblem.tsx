import { parseDollars } from '@bitcoin-basis/engine';
import { useState } from 'react';
import { usePrice } from '../data/price-provider.tsx';
import { cx } from '../lib/cx.ts';
import { formatMoney } from '../lib/format.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { MoneyInput } from './formatted-inputs.tsx';
import { Sheet } from './Sheet.tsx';

/** The one message when the live price cannot be loaded. */
export const PRICE_UNAVAILABLE = 'Can’t load today’s Bitcoin price.';

/** What a typed-in price is called wherever it is used. */
export function yourPriceText(cents: number): string {
  return `Using your price ${formatMoney(cents)}`;
}

/** The highest price anyone could mean (the Worker accepts up to $100,000,000 per BTC). */
const MAX_CENTS = 10_000_000_000;

/** Type a price for this session. Never stored; part of an entry only if one is saved with it. */
export function ManualPriceSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Use a price I enter">
      {open ? <ManualPriceForm onDone={onClose} /> : null}
    </Sheet>
  );
}

function ManualPriceForm({ onDone }: { onDone(): void }) {
  const { manualCents, setManualCents } = usePrice();
  const [text, setText] = useState(manualCents === null ? '' : String(manualCents / 100));
  const [tried, setTried] = useState(false);
  const cents = parseDollars(text);
  const error = cents === null || cents <= 0 || cents > MAX_CENTS ? 'Enter the price of one bitcoin in dollars, like 95000.' : null;
  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (error !== null || cents === null) return;
        setManualCents(cents);
        onDone();
      }}
    >
      <MoneyInput label="Price of 1 BTC" value={text} onChange={setText} error={tried ? error : null} hint="Used only while the app is open, and shown as “your price” everywhere it is used. It is saved only if you save an entry with it." />
      <Button type="submit" variant="primary" className="min-h-14 rounded-[18px] text-[17px]">
        Use this price
      </Button>
    </form>
  );
}

/**
 * Shown where a screen needs the price and it could not be loaded: the plain message, Retry, and "Use a price I
 * enter". `need` says in one line what this screen needs the price for.
 */
export function PriceUnavailable({ need, className }: { need?: string; className?: string }) {
  const { refresh } = usePrice();
  const [entering, setEntering] = useState(false);
  return (
    <Card as="section" aria-label="Price" className={cx('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <p role="status" className="m-0 text-[15px] font-semibold">
          {PRICE_UNAVAILABLE}
        </p>
        {need ? <p className="m-0 text-[13px] leading-snug text-muted">{need}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={refresh}>Retry</Button>
        <Button variant="ghost" onClick={() => setEntering(true)}>
          Use a price I enter
        </Button>
      </div>
      <ManualPriceSheet open={entering} onClose={() => setEntering(false)} />
    </Card>
  );
}

/** One line for tight spots (the Holdings hero): the message with Retry and "Use a price I enter" as quiet buttons. */
export function PriceUnavailableLine({ className }: { className?: string | undefined }) {
  const { refresh } = usePrice();
  const [entering, setEntering] = useState(false);
  const quiet = 'min-h-11 bg-transparent px-1 font-semibold text-amber underline-offset-2 hover:underline';
  return (
    <span className={cx('flex flex-wrap items-center gap-x-2 text-muted', className)}>
      <span role="status">{PRICE_UNAVAILABLE}</span>
      <button type="button" onClick={refresh} className={quiet}>
        Retry
      </button>
      <button type="button" onClick={() => setEntering(true)} className={quiet}>
        Use a price I enter
      </button>
      <ManualPriceSheet open={entering} onClose={() => setEntering(false)} />
    </span>
  );
}

/** While a typed-in price is in use: says so on every screen, with Change and Stop. */
export function ManualPriceBanner({ className }: { className?: string }) {
  const { manualCents, setManualCents, refresh } = usePrice();
  const [entering, setEntering] = useState(false);
  if (manualCents === null) return null;
  return (
    <section aria-label="Your price" className={cx('flex items-center justify-between gap-x-2 rounded-xl border border-accent/50 bg-surface py-0.5 pl-3.5 pr-1 text-xs text-soft', className)}>
      <span className="min-w-0 py-2">{yourPriceText(manualCents)} per BTC. Not saved.</span>
      <span className="flex flex-none items-center">
        <button type="button" onClick={() => setEntering(true)} className="min-h-11 bg-transparent px-2 text-xs font-semibold text-amber underline-offset-2 hover:underline">
          Change
        </button>
        <button
          type="button"
          onClick={() => {
            setManualCents(null);
            refresh();
          }}
          className="min-h-11 bg-transparent px-2 text-xs font-semibold text-amber underline-offset-2 hover:underline"
        >
          Stop
        </button>
      </span>
      <ManualPriceSheet open={entering} onClose={() => setEntering(false)} />
    </section>
  );
}
