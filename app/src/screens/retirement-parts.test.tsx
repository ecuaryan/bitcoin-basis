// @vitest-environment happy-dom
import { holdings, replay, type Entry } from '@bitcoin-basis/engine';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHoldingsView } from '../lib/holdings-view.ts';
import { heldLabel } from '../lib/format.ts';
import { renderApp, type Rendered } from '../test/render.tsx';
import { HeroGainLine, heroFigures, RetirementCard, SplitCard, TaxableDivider } from './holdings-parts.tsx';
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

// Taxable 0.5 BTC cost $20,000, worth $50,000; retirement 0.1 BTC cost $5,000, worth $10,000; at $100,000 per BTC.
describe('Hero: all your Bitcoin', () => {
  it('is taxable plus retirement when a retirement wallet holds coins', () => {
    expect(heroFigures(viewOf([...base, ...ira]))).toEqual({ all: true, label: 'All your Bitcoin is worth', region: 'What all your Bitcoin is worth', worthCents: 6_000_000, sats: 60_000_000 });
  });
  it('stays the taxable figures without retirement coins', () => {
    expect(heroFigures(viewOf(base))).toEqual({ all: false, label: 'Your Bitcoin is worth', region: 'What your Bitcoin is worth', worthCents: 5_000_000, sats: 50_000_000 });
  });
  it('says the total gain is unrealized', async () => {
    app = await renderApp(<HeroGainLine view={viewOf([...base, ...ira])} />);
    expect(text()).toBe('up $35,000 (+140%) unrealized');
  });
  it('has no gain line without retirement coins', async () => {
    app = await renderApp(<HeroGainLine view={viewOf(base)} />);
    expect(text()).toBe('');
  });
});

describe('Taxable and retirement split', () => {
  it('labels both parts with their BTC, worth and gain; the phone leaves out the percent', async () => {
    app = await renderApp(
      <MemoryRouter>
        <SplitCard view={viewOf([...base, ...ira])} wide={false} />
      </MemoryRouter>,
    );
    const [taxable, retirement] = [...app.container.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(taxable).toContain('Taxable');
    expect(taxable).toContain('Counts for tax · 0.5000 BTC');
    expect(taxable).toContain('$50,000');
    expect(taxable).toContain('up $30,000');
    expect(retirement).toContain('Retirement');
    expect(retirement).toContain('Kept apart from tax · 0.1000 BTC');
    expect(retirement).toContain('$10,000');
    expect(retirement).toContain('up $5,000');
    expect(text()).not.toContain('%');
  });
  it('shows the gain percent on a wide screen', async () => {
    app = await renderApp(
      <MemoryRouter>
        <SplitCard view={viewOf([...base, ...ira])} wide />
      </MemoryRouter>,
    );
    expect(text()).toContain('up $30,000 (+150%)');
    expect(text()).toContain('up $5,000 (+100%)');
  });
  it('Taxable jumps to the taxable figures; one retirement wallet opens its page', async () => {
    const view = viewOf([...base, ...ira]);
    app = await renderApp(
      <MemoryRouter>
        <SplitCard view={view} wide={false} />
        <TaxableDivider view={view} />
      </MemoryRouter>,
    );
    expect(app.container.querySelector('a')?.getAttribute('href')).toBe('/wallet/ira');
    expect(app.container.querySelector('a')?.textContent).toContain('Open My IRA.');
    await click(app.container.querySelector('button') as HTMLButtonElement);
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe('Taxable');
  });
  it('with several retirement wallets, Retirement jumps to the Held apart list', async () => {
    const roth: Entry[] = [
      { id: 'w3', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'roth', name: 'Roth', type: 'retirement', defaultProof: '' },
      { id: 's2', kind: 'retirement-snapshot', at: '2024-04-01T19:00:00Z', tz: TZ, wallet: 'roth', sats: 5_000_000 },
    ];
    const view = viewOf([...base, ...ira, ...roth]);
    app = await renderApp(
      <MemoryRouter>
        <SplitCard view={view} wide={false} />
        <RetirementCard view={view} />
      </MemoryRouter>,
    );
    expect(app.container.querySelector('section[aria-label="Taxable and retirement"] a')).toBeNull();
    const buttons = app.container.querySelectorAll('section[aria-label="Taxable and retirement"] button');
    expect(buttons).toHaveLength(2);
    // Some of the retirement coins have no logged cost: said on the row and under it.
    expect(buttons[1]?.textContent).toContain('Some cost not logged · 0.1500 BTC');
    expect(text()).toContain('Gain counts only coins with a logged cost.');
    await click(buttons[1] as HTMLButtonElement);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Held apart from tax');
  });
  it('is not shown without retirement coins, and neither is the Taxable label', async () => {
    const view = viewOf([...base, { id: 's0', kind: 'retirement-snapshot', at: '2024-04-01T19:00:00Z', tz: TZ, wallet: 'ira', sats: 0 }]);
    app = await renderApp(
      <MemoryRouter>
        <SplitCard view={view} wide />
        <TaxableDivider view={view} />
      </MemoryRouter>,
    );
    expect(text()).toBe('');
  });
  it('hides every amount and percent with hide amounts on', async () => {
    const view = viewOf([...base, ...ira]);
    app = await renderApp(
      <MemoryRouter>
        <HeroGainLine view={view} />
        <SplitCard view={view} wide />
      </MemoryRouter>,
      { hidden: true },
    );
    expect(text()).not.toMatch(/\$\d/);
    expect(text()).not.toMatch(/\d\.\d{4}/);
    expect(text()).not.toContain('%');
    expect(text()).toContain('unrealized');
    expect(text()).toContain('Taxable');
    expect(text()).toContain('Retirement');
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
    expect(text()).toContain('Not counted in your taxable figures or average cost. Retirement is in the total at the top.');
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
