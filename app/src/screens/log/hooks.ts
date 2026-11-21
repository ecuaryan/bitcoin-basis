import { parseDollars, replay, type Entry } from '@bitcoin-basis/engine';
import { useEffect, useMemo, useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { formatMoney } from '../../lib/format.ts';
import { amountText, centsText, chainIds, cleanNumber, parseAmount, valueOf, type AmountUnit } from './model.ts';

/** The current moment. The demo book has a fixed "today" so tests and screenshots never drift. */
export function useNowMs(): number {
  const { isDemo, today } = useLedger();
  const [stamp] = useState(() => Date.now());
  return isDemo ? Date.parse(`${today}T19:00:00Z`) : stamp;
}

export interface PriceAt {
  /** Cents per BTC at that time, or null while it is being fetched or if it could not be. */
  cents: number | null;
  status: 'idle' | 'loading' | 'ok' | 'error';
  source: string;
}

const NEAR_NOW_MS = 3_600_000;

/** The market price at an instant, from the price service (the live quote when it is close to now). Debounced while typing. */
export function usePriceAt(at: string | null, nowMs: number): PriceAt {
  const { service, quote } = usePrice();
  const { isDemo } = useLedger();
  const source = isDemo ? 'the demo price' : 'mempool.space';
  const [fetched, setFetched] = useState<{ at: string; cents: number | null; error: boolean } | null>(null);
  const atMs = at === null ? null : Date.parse(at);
  const useQuote = atMs !== null && quote !== null && Math.abs(atMs - nowMs) < NEAR_NOW_MS;

  useEffect(() => {
    if (at === null || atMs === null || useQuote) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      service.historical(Math.floor(atMs / 1000), ctl.signal).then(
        (cents) => {
          if (!ctl.signal.aborted) setFetched({ at, cents, error: false });
        },
        () => {
          if (!ctl.signal.aborted) setFetched({ at, cents: null, error: true });
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [at, atMs, service, useQuote]);

  return useMemo<PriceAt>(() => {
    if (at === null) return { cents: null, status: 'idle', source };
    if (useQuote && quote !== null) return { cents: quote.usdCents, status: 'ok', source };
    if (fetched !== null && fetched.at === at) return { cents: fetched.cents, status: fetched.error ? 'error' : 'ok', source };
    return { cents: null, status: 'loading', source };
  }, [at, useQuote, quote, fetched, source]);
}

export interface AmountState {
  text: string;
  unit: AmountUnit;
  sats: number | null;
  setText(t: string): void;
  setUnit(u: AmountUnit): void;
}

/** One amount box with a BTC, sats or USD switch. Switching keeps the same amount. */
export function useAmount(initialSats: number | null, priceCents: number | null): AmountState {
  const [unit, setUnitState] = useState<AmountUnit>('btc');
  const [text, setText] = useState(initialSats === null ? '' : amountText(initialSats, 'btc', null));
  const sats = parseAmount(text, unit, priceCents);
  return {
    text,
    unit,
    sats,
    setText,
    setUnit: (u) => {
      setText(amountText(sats, u, priceCents));
      setUnitState(u);
    },
  };
}

export interface ValueState {
  /** What the box shows. */
  text: string;
  setText(t: string): void;
  cents: number | null;
  overridden: boolean;
  reset(): void;
  /** One line for the entry's note: where the number came from. */
  sourceNote: string;
}

/** A dollar value that starts from the market price and can be overwritten by hand. */
export function useValue(sats: number | null, price: PriceAt, initialCents: number | null = null): ValueState {
  const [text, setText] = useState<string | null>(initialCents === null ? null : centsText(initialCents));
  const auto = sats !== null && price.cents !== null ? valueOf(sats, price.cents) : null;
  const cents = text === null ? auto : parseDollars(cleanNumber(text));
  return {
    text: text ?? centsText(auto),
    setText,
    cents,
    overridden: text !== null,
    reset: () => setText(null),
    sourceNote: text !== null ? 'Price source: value entered by hand' : price.cents === null ? 'Price source: none' : `Price source: ${price.source} at ${formatMoney(price.cents)} per BTC`,
  };
}

/** Join a user's note with the line saying where the price came from. Editing strips the old line first. */
export function withSource(note: string, source: string): string {
  return [note.trim(), source].filter((s) => s !== '').join('\n');
}
export function stripSource(note: string | undefined): string {
  return (note ?? '').replace(/\n?Price source: .*$/s, '').trim();
}

/** The book, the time zone and "now" every form needs. */
export function useFormEnv() {
  const { entries, state, today } = useLedger();
  const nowMs = useNowMs();
  return { entries, state, today, nowMs, tz: state.settings.timeZone };
}

/** The book as it was before the entry being edited existed (so its own coins are available again). */
export function useBaseState(editing: Entry | null) {
  const { entries, state } = useLedger();
  return useMemo(() => {
    if (editing === null) return state;
    const chain = chainIds(entries, editing.id);
    return replay(entries.filter((e) => !chain.has(e.id)));
  }, [editing, entries, state]);
}

/** Scroll every scrollable parent of `el` back to the top (a new step of a sheet should start at its top). */
export function resetScroll(el: HTMLElement | null): void {
  let p = el?.parentElement ?? null;
  while (p !== null) {
    p.scrollTop = 0;
    p = p.parentElement;
  }
}
