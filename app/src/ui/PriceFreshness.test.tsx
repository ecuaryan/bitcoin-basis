// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceQuote, PriceService } from '../data/price.ts';
import { PriceProvider } from '../data/price-provider.tsx';
import { shortWhen } from '../lib/format.ts';
import { PriceLine } from '../screens/holdings-parts.tsx';
import { click } from '../test/render.tsx';
import { PrefsProvider } from './prefs.tsx';
import { priceAge } from './PriceFreshness.tsx';

const T0 = Date.parse('2026-11-20T15:00:00Z');
const MIN = 60_000;

const quote = (asOf: number, stale = false, source: PriceQuote['source'] = 'live'): PriceQuote => ({ usdCents: 9_500_000, prevDayUsdCents: null, fetchedAt: Date.now(), asOf, stale, source });

/** Answers in turn; `null` is an answer that waits until `release()`. */
function scripted(answers: (PriceQuote | Error | null)[]) {
  let calls = 0;
  let release: (() => void) | null = null;
  const service: PriceService = {
    current: () => {
      calls += 1;
      const a = answers.length > 0 ? (answers.shift() as PriceQuote | Error | null) : new Error('down');
      if (a === null) return new Promise((ok) => (release = () => ok(quote(Date.now()))));
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    },
    historical: () => Promise.reject(new Error('not used')),
  };
  return { service, calls: () => calls, release: () => release?.() };
}

let root: Root | null = null;
async function mount(service: PriceService) {
  document.body.innerHTML = '<div id="root"></div>';
  const el = document.getElementById('root') as HTMLElement;
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <PrefsProvider initialHidden={false}>
        <PriceProvider service={service}>
          <PriceLine />
        </PriceProvider>
      </PrefsProvider>,
    );
  });
  return el;
}
const button = () => document.querySelector('button[aria-label="Refresh the price"]') as HTMLButtonElement | null;
const spinning = () => (button()?.querySelector('svg')?.getAttribute('class') ?? '').split(' ').includes('animate-spin');
const text = () => (document.getElementById('root')?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

describe('PriceLine', () => {
  it('a current price: the price and a refresh button, no time and no warning', async () => {
    await mount(scripted([quote(T0 - MIN)]).service);
    expect(text()).toBe('at $95,000.00');
    expect(button()).not.toBeNull();
    expect(spinning()).toBe(false);
  });

  it('a price over 5 minutes old says when it is from, quietly; amber only past 30 minutes', async () => {
    const asOf = T0 - 6 * MIN;
    await mount(scripted([quote(asOf)]).service);
    expect(text()).toBe(`at $95,000.00 · as of ${shortWhen(asOf, T0)}`);
    expect(document.querySelector('.text-amber')).toBeNull();
    act(() => root?.unmount());

    const older = T0 - 31 * MIN;
    await mount(scripted([quote(older)]).service);
    expect(document.querySelector('.text-amber')?.textContent).toBe(`as of ${shortWhen(older, T0)}`);
  });

  it('a kept price the server sent (stale) says when it is from, even if recent', async () => {
    await mount(scripted([quote(T0 - 2 * MIN, true)]).service);
    expect(text()).toContain(`as of ${shortWhen(T0 - 2 * MIN, T0)}`);
  });

  it('the time appears as the price ages while you look, when refreshes keep failing', async () => {
    await mount(scripted([quote(T0)]).service);
    expect(text()).toBe('at $95,000.00');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * MIN);
    });
    expect(text()).toBe(`at $95,000.00 · as of ${shortWhen(T0, Date.now())}`);
    expect(document.querySelector('.text-loss')).toBeNull();
  });

  it('the refresh button asks for the price again and spins while it loads', async () => {
    const s = scripted([quote(T0), null]);
    await mount(s.service);
    expect(s.calls()).toBe(1);
    await click(button() as HTMLButtonElement);
    expect(s.calls()).toBe(2);
    expect(spinning()).toBe(true);
    await act(async () => s.release());
    expect(spinning()).toBe(false);
  });

  it('a failed refresh keeps the price, with no error look', async () => {
    const s = scripted([quote(T0), new Error('The price service answered 502.')]);
    await mount(s.service);
    await click(button() as HTMLButtonElement);
    expect(s.calls()).toBe(2);
    expect(text()).toBe('at $95,000.00');
    expect(text()).not.toMatch(/out of date|Can’t load/);
    expect(document.querySelector('.text-loss')).toBeNull();
    expect(spinning()).toBe(false);
  });

  it('no price at all: the plain message with Retry, as before', async () => {
    await mount(scripted([new Error('down')]).service);
    expect(text()).toContain('Can’t load today’s Bitcoin price.');
    expect(button()).toBeNull();
  });
});

describe('priceAge', () => {
  it('only for a live price: never for the demo’s fixed price or a typed one', () => {
    expect(priceAge(quote(T0 - 60 * MIN, false, 'fixed'), T0)).toBeNull();
    expect(priceAge(quote(T0 - 60 * MIN, false, 'manual'), T0)).toBeNull();
    expect(priceAge(null, T0)).toBeNull();
    expect(priceAge(quote(T0 - 5 * MIN), T0)).toBeNull();
    expect(priceAge(quote(T0 - 5 * MIN - 1), T0)).toEqual({ text: `as of ${shortWhen(T0 - 5 * MIN - 1, T0)}`, veryOld: false });
    expect(priceAge(quote(T0 - 30 * MIN - 1), T0)?.veryOld).toBe(true);
  });
});
