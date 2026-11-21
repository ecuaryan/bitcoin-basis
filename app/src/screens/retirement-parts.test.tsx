// @vitest-environment happy-dom
import { holdings, replay, type Entry } from '@bitcoin-basis/engine';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHoldingsView } from '../lib/holdings-view.ts';
import { heldLabel } from '../lib/format.ts';
import { renderApp, type Rendered } from '../test/render.tsx';
import { AllBitcoinCard, RetirementCard, WithRetirementLine } from './holdings-parts.tsx';
import { click } from '../test/render.tsx';

const TZ = 'America/Boise';
const PRICE = 10_000_000; // $100,000 per BTC
const base: Entry[] = [
  { id: 'w1', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
  { id: 'w2', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ira', name: 'My IRA', type: 'retirement', defaultProof: '' },
  { id: 'b1', kind: 'buy', at: '2024-02-01T19:00:00Z', tz: TZ, wallet: 'ex', sats: 50_000_000, costCents: 2_000_000, tier: 'documented' },
];
const ira: Entry[] = [
  { id: 'r1', kind: 'retirement-buy', at: '2024-03-01T19:00:00Z', tz: TZ, wallet: 'ira', sats: 10_000_000, costCents: 500_000 },
  { id: 's1', kind: 'retirement-snapshot', at: '2024-04-01T19:00:00Z', tz: TZ, wallet: 'ira', sats: 12_000_000 },
];
const viewOf = (entries: Entry[]) => {
  const state = replay(entries);
  return buildHoldingsView(state, holdings(state), PRICE, '2026-11-20');
};

let app: Rendered | null = null;
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  app?.unmount();
  app = null;
});
const text = () => app?.container.textContent ?? '';

describe('All your Bitcoin', () => {
  it('labels taxable, retirement and all, and adds them up', async () => {
    app = await renderApp(
      <MemoryRouter>
        <AllBitcoinCard view={viewOf([...base, ...ira])} wide={false} />
      </MemoryRouter>,
    );
    expect(text()).toContain('Taxable');
    expect(text()).toContain('Counts for tax');
    expect(text()).toContain('Retirement');
    expect(text()).toContain('All Bitcoin');
    // Taxable $50,000 up $30,000; retirement $10,000 up $5,000; all $60,000 up $35,000.
    expect(text()).toContain('$50,000');
    expect(text()).toContain('$10,000');
    expect(text()).toContain('$60,000');
    expect(text()).toContain('up $35,000 (+140%)');
  });
  it('is not shown without retirement coins', async () => {
    app = await renderApp(
      <MemoryRouter>
        <AllBitcoinCard view={viewOf(base)} wide />
      </MemoryRouter>,
    );
    expect(text()).toBe('');
  });
  it('hides every amount with hide amounts on', async () => {
    app = await renderApp(
      <MemoryRouter>
        <AllBitcoinCard view={viewOf([...base, ...ira])} wide />
      </MemoryRouter>,
      { hidden: true },
    );
    expect(text()).not.toMatch(/\$\d/);
    expect(text()).not.toMatch(/\d\.\d{4}/);
    expect(text()).not.toContain('%');
    expect(text()).toContain('All Bitcoin');
  });
});

describe('Held apart card', () => {
  it('shows a retirement wallet’s worth, cost and gain, and when its balance note differs', async () => {
    app = await renderApp(
      <MemoryRouter>
        <RetirementCard view={viewOf([...base, ...ira])} />
      </MemoryRouter>,
    );
    expect(text()).toContain('My IRA');
    expect(text()).toContain('Worth $10,000');
    expect(text()).toContain('Cost $5,000 · up $5,000 (+100%)');
    expect(text()).not.toMatch(/\$5,000\.00/);
    expect(text()).toContain('Balance note differs');
  });
  it('a wallet with balance notes only shows its worth, no gain', async () => {
    app = await renderApp(
      <MemoryRouter>
        <RetirementCard view={viewOf([...base, ira[1] as Entry])} />
      </MemoryRouter>,
    );
    expect(text()).toContain('Worth $12,000');
    expect(text()).not.toContain('Cost');
    expect(text()).not.toContain('up');
  });
});

describe('heldLabel', () => {
  it('whole units, toward zero', () => {
    expect([0, 1, 59, 60, 364, 365, 400, 730].map(heldLabel)).toEqual(['Bought today', 'Held 1 day', 'Held 59 days', 'Held 1 month', 'Held 11 months', 'Held 1 year', 'Held 1 yr 1 mo', 'Held 2 years']);
  });
});

describe('With retirement line', () => {
  it('shows everything including retirement and jumps to the All your Bitcoin card', async () => {
    const view = viewOf([...base, ...ira]);
    app = await renderApp(
      <MemoryRouter>
        <WithRetirementLine view={view} />
        <AllBitcoinCard view={view} wide={false} />
      </MemoryRouter>,
    );
    const button = app.container.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('$60,000');
    expect(button.textContent).toContain('with retirement');
    await click(button);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('All your Bitcoin');
  });
  it('is not shown without retirement Bitcoin', async () => {
    app = await renderApp(<WithRetirementLine view={viewOf(base)} />);
    expect(text()).toBe('');
  });
});
