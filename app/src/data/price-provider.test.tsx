// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceQuote, PriceService } from './price.ts';
import { PriceProvider, RETRY_MS, usePrice, type PriceState } from './price-provider.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.parse('2026-11-20T15:00:00Z');
const MIN = 60_000;

type Answer = () => PriceQuote | Error;
const live = (usdCents: number, asOf: number, stale = false): Answer => () => ({ usdCents, prevDayUsdCents: null, fetchedAt: Date.now(), asOf, stale, source: 'live' });
const fail: Answer = () => new Error('The price service answered 502.');

/** A service that gives `answers` in turn, and notes when it was asked. */
function scripted(answers: Answer[]) {
  const calls: number[] = [];
  const service: PriceService = {
    current: () => {
      calls.push(Date.now());
      const a = (answers.shift() ?? fail)();
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    },
    historical: () => Promise.reject(new Error('not used')),
  };
  return { service, calls };
}

let root: Root | null = null;
const seen: { state: PriceState | null } = { state: null };
function Probe() {
  const s = usePrice();
  useEffect(() => {
    seen.state = s;
  });
  return null;
}
async function mount(service: PriceService) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root?.render(
      <PriceProvider service={service}>
        <Probe />
      </PriceProvider>,
    );
  });
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const now = () => seen.state as PriceState;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  seen.state = null;
  vi.useRealTimers();
});

describe('PriceProvider', () => {
  it('a failed refresh keeps the quote it had; it tries again after 15 s, 30 s, 60 s, then every minute', async () => {
    const { service, calls } = scripted([live(9_500_000, T0), fail, fail, fail, fail, live(9_600_000, T0 + 4 * MIN)]);
    await mount(service);
    expect(calls).toHaveLength(1);
    expect(now().status).toBe('ok');
    expect(now().quote?.usdCents).toBe(9_500_000);

    await advance(MIN);
    expect(calls).toHaveLength(2);
    expect(now().status).toBe('error');
    expect(now().quote).toMatchObject({ usdCents: 9_500_000, asOf: T0, source: 'live' });

    for (const [i, wait] of RETRY_MS.entries()) {
      await advance(wait - 1);
      expect(calls, `retry ${i + 1}`).toHaveLength(2 + i);
      await advance(1);
      expect(calls, `retry ${i + 1}`).toHaveLength(3 + i);
      expect(now().quote?.usdCents).toBe(9_500_000);
    }
    expect(RETRY_MS).toEqual([15_000, 30_000, 60_000]);

    // After three quick retries, back to the normal minute.
    await advance(MIN - 1);
    expect(calls).toHaveLength(5);
    await advance(1);
    expect(calls).toHaveLength(6);
    expect(now().status).toBe('ok');
    expect(now().quote).toMatchObject({ usdCents: 9_600_000, asOf: T0 + 4 * MIN });
  });

  it('refresh() asks again at once, loading meanwhile; if that fails the quote stays', async () => {
    let answer: ((e: Error) => void) | null = null;
    let calls = 0;
    const service: PriceService = {
      current: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve(live(9_500_000, T0)() as PriceQuote);
        return new Promise((_ok, no) => (answer = no));
      },
      historical: () => Promise.reject(new Error('not used')),
    };
    await mount(service);
    await act(async () => now().refresh());
    expect(calls).toBe(2);
    expect(now().status).toBe('loading');
    expect(now().quote?.usdCents).toBe(9_500_000);
    await act(async () => answer?.(new Error('The price service answered 502.')));
    expect(now().status).toBe('error');
    expect(now().quote?.usdCents).toBe(9_500_000);
  });

  it('carries asOf, and saves the live quote with it on this device', async () => {
    const { service } = scripted([live(9_500_000, T0 - 3 * MIN, true)]);
    await mount(service);
    expect(now().quote).toMatchObject({ usdCents: 9_500_000, asOf: T0 - 3 * MIN, stale: true });
    expect(JSON.parse(window.localStorage.getItem('bb.last-price') ?? 'null')).toMatchObject({ usdCents: 9_500_000, asOf: T0 - 3 * MIN, stale: true });
  });

  it('a kept price from the server that is older than the one shown does not replace it', async () => {
    const { service, calls } = scripted([live(9_500_000, T0), live(9_100_000, T0 - 60 * MIN, true)]);
    await mount(service);
    await advance(MIN);
    expect(calls).toHaveLength(2);
    expect(now().status).toBe('ok');
    expect(now().quote).toMatchObject({ usdCents: 9_500_000, asOf: T0 });
    expect(JSON.parse(window.localStorage.getItem('bb.last-price') ?? 'null')).toMatchObject({ usdCents: 9_500_000 });
  });

  it('starts from the price this device kept; one saved by an older version uses its fetch time as asOf', async () => {
    const kept = T0 - 2 * 24 * 60 * MIN;
    window.localStorage.setItem('bb.last-price', JSON.stringify({ usdCents: 9_000_000, prevDayUsdCents: 8_900_000, fetchedAt: kept, source: 'live' }));
    const { service } = scripted([fail]);
    await mount(service);
    expect(now().status).toBe('error');
    expect(now().quote).toEqual({ usdCents: 9_000_000, prevDayUsdCents: 8_900_000, fetchedAt: kept, asOf: kept, stale: false, source: 'live' });
  });

  it('ignores a kept price it cannot read', async () => {
    for (const junk of ['{', '{"usdCents":"1","fetchedAt":1}', '{"usdCents":100}', '[1]']) {
      window.localStorage.setItem('bb.last-price', junk);
      const { service } = scripted([fail]);
      await mount(service);
      expect(now().quote, junk).toBeNull();
      act(() => root?.unmount());
    }
  });
});
