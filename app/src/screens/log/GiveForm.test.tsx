// @vitest-environment happy-dom
// The Gave tab: lowest-cost lots by default, the one-line reason, the below-cost warning, and "I bought it to give".
import { replay, type BuyEntry, type Entry, type GiveEntry } from '@bitcoin-basis/engine';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LedgerProvider, useLedger } from '../../data/ledger-provider.tsx';
import type { ReactNode } from 'react';
import { createMemoryStore } from '../../data/memory-store.ts';
import { click, renderApp, type Rendered } from '../../test/render.tsx';
import { ToastProvider } from '../../ui/Toast.tsx';
import { lastGiftWasBoughtToGive } from './BuyToGive.tsx';
import { LOWEST_COST_WHY } from './CoinPicker.tsx';
import type { Draft } from './draft.ts';
import { GiveForm } from './GiveForm.tsx';

const TZ = 'America/Boise';
const PRICE = 9_481_240; // $94,812.40 per BTC
const wallet: Entry = { id: 'w1', kind: 'wallet', at: '2020-01-01T00:00:00Z', tz: TZ, wallet: 'strike', name: 'Strike', type: 'exchange', defaultProof: 'Email receipt' };
const buy = (id: string, at: string, sats: number, costCents: number): BuyEntry => ({ id, kind: 'buy', at, tz: TZ, wallet: 'strike', sats, costCents, tier: 'documented' });
// Oldest lot cost $60,000 per BTC; the newer one $20,000; a third, dear one $150,000 (below cost at today's price).
const OLD = buy('b-old', '2021-03-15T19:00:00Z', 10_000_000, 600_000);
const CHEAP = buy('b-cheap', '2023-01-20T19:00:00Z', 1_000_000, 20_000);
const DEAR = buy('b-dear', '2025-02-10T19:00:00Z', 10_000_000, 1_500_000);

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  window.localStorage.clear();
});

/** The Log sheet opens on a loaded book; so does the form here. */
function Loaded({ children }: { children: ReactNode }) {
  return useLedger().entries.length > 0 ? children : null;
}

async function mount(entries: Entry[]) {
  const onReview = vi.fn<(d: Draft) => void>();
  app = await renderApp(
    <ToastProvider>
      <LedgerProvider store={createMemoryStore(entries)}>
        <Loaded>
          <GiveForm initial={null} preset={{}} onReview={onReview} onSwitch={() => {}} />
        </Loaded>
      </LedgerProvider>
    </ToastProvider>,
    { priceCents: PRICE },
  );
  await vi.waitFor(() => expect(select('From wallet').value).toBe('strike'));
  return onReview;
}

const byLabel = (text: string): HTMLElement => {
  const label = [...(app?.container.querySelectorAll('label') ?? [])].find((l) => l.textContent?.trim().startsWith(text));
  const id = label?.getAttribute('for');
  const el = id ? document.getElementById(id) : null;
  if (el === null) throw new Error(`no field labelled ${text}`);
  return el;
};
const input = (text: string) => byLabel(text) as HTMLInputElement;
const select = (text: string) => byLabel(text) as HTMLSelectElement;
const text = () => app?.container.textContent ?? '';
const button = (name: string) => [...(app?.container.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === name) as HTMLButtonElement;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    el.focus();
  });
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    el.blur();
  });
}
async function submit() {
  const form = app?.container.querySelector('form') as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('a gift from what you hold', () => {
  it('starts on lowest cost first, says why once, and uses the lowest-cost lot rather than the oldest', async () => {
    const onReview = await mount([wallet, OLD, CHEAP, DEAR]);
    const lowest = [...(app?.container.querySelectorAll('[role="radio"]') ?? [])].find((r) => r.textContent === 'Lowest cost first');
    expect(lowest?.getAttribute('aria-checked')).toBe('true');
    expect(text().split(LOWEST_COST_WHY).length).toBe(2);
    await type(input('Amount'), '0.005');
    await type(input('Who is it for?'), 'Mom');
    await vi.waitFor(() => expect(text()).toContain('Uses 1 lot, lowest cost first. Saved with the entry.'));
    await submit();
    expect(onReview).toHaveBeenCalledTimes(1);
    const draft = onReview.mock.calls[0]?.[0] as Draft;
    expect(draft.coins?.picks).toEqual([{ lotId: 'b-cheap', sats: 500_000 }]);
    expect(text()).not.toContain('Nobody can claim the loss');
  });

  it('only when lower-cost lots cannot cover it does it use dearer ones, and says so in one line', async () => {
    const onReview = await mount([wallet, OLD, CHEAP, DEAR]);
    // 0.12 BTC: CHEAP (0.01) and OLD (0.1) are at a gain; 0.01 has to come from DEAR, which cost more than it is worth.
    await type(input('Amount'), '0.12');
    await type(input('Who is it for?'), 'Mom');
    await vi.waitFor(() => expect(text()).toContain('Nobody can claim the loss on that part.'));
    expect(text()).toContain('so 0.0100 0000 comes from lots that cost more');
    await submit();
    expect((onReview.mock.calls[0]?.[0] as Draft).coins?.picks).toEqual([
      { lotId: 'b-cheap', sats: 1_000_000 },
      { lotId: 'b-old', sats: 10_000_000 },
      { lotId: 'b-dear', sats: 1_000_000 },
    ]);
  });

  it('Pick lots stays available', async () => {
    await mount([wallet, OLD, CHEAP]);
    const pick = [...(app?.container.querySelectorAll('[role="radio"]') ?? [])].find((r) => r.textContent === 'Pick lots') as HTMLElement;
    await click(pick);
    expect(app?.container.querySelectorAll('input[type="checkbox"]:not([role="switch"])').length).toBe(2);
    expect(text()).not.toContain(LOWEST_COST_WHY);
  });
});

describe('I bought it to give', () => {
  async function switchOn() {
    const sw = app?.container.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(sw.checked).toBe(false);
    await click(sw);
    expect(sw.checked).toBe(true);
    expect(document.activeElement === sw || document.activeElement === document.body).toBe(true);
  }

  it('logs a purchase and then a gift of exactly that purchase, worth what was paid, in one review', async () => {
    const onReview = await mount([wallet, OLD, CHEAP]);
    await type(input('Who is it for?'), 'Mom');
    await switchOn();
    // What was typed for the gift stays.
    expect(input('Who is it for?').value).toBe('Mom');
    await type(input('Amount bought'), '0.00052734');
    await type(input('Total paid, including fees'), '50');
    await vi.waitFor(() => expect(text()).toContain('(what you paid)'));
    expect(text()).toContain('Gives all of it');
    await submit();
    expect(onReview).toHaveBeenCalledTimes(1);
    const draft = onReview.mock.calls[0]?.[0] as Draft;
    expect(draft.groups?.map((g) => g.title)).toEqual(['Purchase', 'Gift']);
    expect(draft.saveLabel).toBe('Save purchase and gift');
    const [b, g] = draft.build('') as [BuyEntry, GiveEntry];
    expect(b).toMatchObject({ kind: 'buy', wallet: 'strike', sats: 52_734, costCents: 5_000, tier: 'documented', proof: 'Email receipt' });
    expect(g).toMatchObject({ kind: 'give', wallet: 'strike', sats: 52_734, valueCents: 5_000, to: 'person', recipient: 'Mom', picks: [{ lotId: b.id, sats: 52_734 }] });
    expect(Date.parse(g.at) - Date.parse(b.at)).toBe(1000);
    expect(b.id < g.id).toBe(true);
    // Replayed together: the gift uses the new lot (not the cheaper old one), the recipient's cost is what was paid.
    const after = replay([wallet, OLD, CHEAP, b, g]);
    expect(after.errors).toEqual([]);
    expect(after.gifts[0]).toMatchObject({ recipient: 'Mom', costCents: 5_000, valueCents: 5_000, sats: 52_734 });
    expect(after.lots.find((l) => l.id === b.id)?.sats ?? 0).toBe(0);
    expect(after.lots.find((l) => l.id === 'b-cheap')?.sats).toBe(1_000_000);
    expect(draft.coins?.picks).toEqual([{ lotId: b.id, sats: 52_734 }]);
  });

  it('giving less keeps the rest in the wallet, with the value its share of what was paid', async () => {
    const onReview = await mount([wallet]);
    await switchOn();
    await type(input('Amount bought'), '0.001');
    await type(input('Total paid, including fees'), '100');
    await type(input('Who is it for?'), 'Sam');
    await type(input('Amount given'), '0.0004');
    await vi.waitFor(() => expect(text()).toContain('stays in Strike'));
    await submit();
    const draft = onReview.mock.calls[0]?.[0] as Draft;
    const [b, g] = draft.build('') as [BuyEntry, GiveEntry];
    expect(g).toMatchObject({ sats: 40_000, valueCents: 4_000, picks: [{ lotId: b.id, sats: 40_000 }] });
    expect(draft.groups?.[1]?.rows.map((r) => r.label)).toContain('Stays in Strike');
    expect(replay([wallet, b, g]).lots.find((l) => l.id === b.id)).toMatchObject({ sats: 60_000, costCents: 6_000 });
  });

  it('will not give more than was bought', async () => {
    const onReview = await mount([wallet]);
    await switchOn();
    await type(input('Amount bought'), '0.001');
    await type(input('Total paid, including fees'), '100');
    await type(input('Who is it for?'), 'Sam');
    await type(input('Amount given'), '0.002');
    await submit();
    expect(onReview).not.toHaveBeenCalled();
    expect(text()).toContain('You can give up to what you bought, 0.00100000 BTC.');
    expect(button('Review purchase and gift')).toBeDefined();
  });
});

describe('lastGiftWasBoughtToGive', () => {
  const b = buy('b-new', '2026-11-21T19:00:00Z', 50_000, 5_000);
  const g = (over: Partial<GiveEntry> = {}): GiveEntry => ({ id: 'g1', kind: 'give', at: '2026-11-21T19:00:01Z', tz: TZ, wallet: 'strike', sats: 50_000, valueCents: 5_000, to: 'person', recipient: 'Mom', picks: [{ lotId: 'b-new', sats: 50_000 }], ...over });
  const check = (entries: Entry[]) => lastGiftWasBoughtToGive(entries, replay(entries));
  it('is true only when the newest gift gave one purchase it was logged right after', () => {
    expect(check([wallet, b])).toBe(false);
    expect(check([wallet, b, g()])).toBe(true);
    expect(check([wallet, OLD, b, g({ picks: [{ lotId: 'b-old', sats: 50_000 }] })])).toBe(false);
    expect(check([wallet, b, g({ at: '2026-11-22T19:00:00Z' })])).toBe(false);
    // A later ordinary gift wins.
    expect(check([wallet, OLD, b, g(), g({ id: 'g2', at: '2026-12-01T19:00:00Z', picks: [{ lotId: 'b-old', sats: 50_000 }] })])).toBe(false);
  });
});
