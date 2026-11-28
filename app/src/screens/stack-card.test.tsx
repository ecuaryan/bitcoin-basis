// @vitest-environment happy-dom
import { holdings, replay, type Entry } from '@bitcoin-basis/engine';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHoldingsView } from '../lib/holdings-view.ts';
import { click, renderApp, type Rendered } from '../test/render.tsx';
import { SplitCard, StackCard, YearSheet } from './holdings-parts.tsx';

const TZ = 'America/Boise';
const PRICE = 10_000_000; // $100,000 per BTC
const base: Entry[] = [
  { id: 'w1', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: '' },
  { id: 'w2', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'ira', name: 'My IRA', type: 'retirement', defaultProof: '' },
  { id: 'b1', kind: 'buy', at: '2024-02-01T19:00:00Z', tz: TZ, wallet: 'ex', sats: 50_000_000, costCents: 2_000_000, tier: 'documented' },
];
// Bought in 2025 only inside the IRA: 0.1 BTC for $5,000, worth $10,000.
const iraBuy: Entry = { id: 'r1', kind: 'retirement-buy', at: '2025-03-01T19:00:00Z', tz: TZ, wallet: 'ira', sats: 10_000_000, costCents: 500_000, proof: 'Statement' };
const oldIra: Entry[] = [
  { id: 'w3', kind: 'wallet', at: '2024-01-01T00:00:00Z', tz: TZ, wallet: 'old', name: 'Old IRA', type: 'retirement', defaultProof: '' },
  { id: 's1', kind: 'retirement-snapshot', at: '2025-04-01T19:00:00Z', tz: TZ, wallet: 'old', sats: 12_000_000 },
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
const noop = () => undefined;

describe('Your stack, by year bought', () => {
  for (const wide of [false, true]) {
    const layout = wide ? 'desktop' : 'phone';
    it(`${layout}: retirement purchases are in their year, in their own colour, with a Retirement legend`, async () => {
      app = await renderApp(<StackCard view={viewOf([...base, iraBuy])} wide={wide} onPick={noop} />);
      const years = [...app.container.querySelectorAll('li button')];
      expect(years.map((b) => b.textContent)).toEqual([expect.stringContaining('2024'), expect.stringContaining('2025')]);
      expect(years[1]?.textContent).toContain('0.1000');
      expect(years[1]?.querySelectorAll('.bg-retire')).toHaveLength(1);
      expect(years[0]?.querySelectorAll('.bg-retire')).toHaveLength(0);
      expect(app.container.querySelectorAll('.bg-cream')).toHaveLength(0);
      expect(text()).toContain('Retirement');
      // The documented share is the taxable lots' only, and says so.
      expect(text()).toContain('Taxable: 100% documented.');
      expect(text()).not.toContain('Not in a year');
    });

    it(`${layout}: each year shows what it is worth now and its gain, retirement included`, async () => {
      // 2024: 0.5 BTC for $20,000, worth $50,000. 2025: the IRA's 0.1 BTC for $5,000, worth $10,000.
      app = await renderApp(<StackCard view={viewOf([...base, iraBuy])} wide={wide} onPick={noop} />);
      const years = [...app.container.querySelectorAll('li button')].map((b) => b.textContent);
      expect(years[0]).toContain('$50,000up +$30,000 · +150%');
      expect(years[1]).toContain('$10,000up +$5,000 · +100%');
    });

    it(`${layout}: a year down shows its loss, and no price shows a dash`, async () => {
      const dear: Entry = { id: 'b2', kind: 'buy', at: '2025-05-01T19:00:00Z', tz: TZ, wallet: 'ex', sats: 10_000_000, costCents: 1_250_000, tier: 'documented' };
      app = await renderApp(<StackCard view={viewOf([...base, dear])} wide={wide} onPick={noop} />);
      expect([...app.container.querySelectorAll('li button')][1]?.textContent).toContain('$10,000down −$2,500 · −20%');
      app.unmount();
      const state = replay([...base, dear]);
      app = await renderApp(<StackCard view={buildHoldingsView(state, holdings(state), null, '2026-11-20')} wide={wide} onPick={noop} />);
      const first = [...app.container.querySelectorAll('li button')][0]?.textContent ?? '';
      expect(first).toContain('—Show the 2024 lots');
      expect(first).not.toContain('$');
    });

    it(`${layout}: retirement with balance notes only is named under the years, not dropped`, async () => {
      app = await renderApp(<StackCard view={viewOf([...base, iraBuy, ...oldIra])} wide={wide} onPick={noop} />);
      expect(text()).toContain('Not in a year: 0.1200 BTC in retirement, because no purchases are logged for Old IRA.');
    });
  }

  it('says nothing about taxable or retirement without retirement coins', async () => {
    app = await renderApp(<StackCard view={viewOf(base)} wide={false} onPick={noop} />);
    expect(text()).toContain('100% documented. Pick a year');
    expect(text()).not.toContain('Taxable');
    expect(text()).not.toContain('Retirement');
  });

  it('the "?" explains the Retirement colour when it is there', async () => {
    app = await renderApp(<StackCard view={viewOf([...base, iraBuy])} wide={false} onPick={noop} />);
    await click(app.container.querySelector('button[aria-label="What do the colors mean?"]') as HTMLButtonElement);
    expect(text()).toContain('Retirement (blue): bought in a retirement account, kept apart from tax.');
  });

  it('hide amounts masks every figure, retirement included', async () => {
    app = await renderApp(<StackCard view={viewOf([...base, iraBuy, ...oldIra])} wide onPick={noop} />, { hidden: true });
    expect(text()).not.toMatch(/\d\.\d{4}/);
    expect(text()).toContain('Not in a year:');
  });

  it('the split card uses the retirement colour, not the Reconstructed cream', async () => {
    app = await renderApp(
      <MemoryRouter>
        <SplitCard view={viewOf([...base, iraBuy])} wide={false} />
      </MemoryRouter>,
    );
    expect(app.container.querySelectorAll('.bg-retire')).toHaveLength(2);
    expect(app.container.querySelectorAll('.bg-cream')).toHaveLength(0);
  });
});

describe('Year sheet with a retirement purchase', () => {
  const year = (entries: Entry[], y: number) => viewOf(entries).stack.find((r) => r.year === y) ?? null;

  it('lists it marked Retirement with its worth and gain, and its cost when opened', async () => {
    app = await renderApp(<YearSheet row={year([...base, iraBuy], 2025)} onClose={noop} />, { priceCents: PRICE });
    const sheet = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.textContent).toContain('2025 lots');
    expect(sheet.textContent).toContain('1 lot, newest first.');
    expect(sheet.textContent).toContain('All 2025 lots now $10,000.00 · up $5,000.00 (+100%)');
    const row = sheet.querySelector('li button') as HTMLButtonElement;
    expect(row.textContent).toContain('0.1000 0000');
    expect(row.textContent).toContain('Mar 1, 2025 · My IRA');
    expect(row.textContent).toContain('Now $10,000.00 · up $5,000.00 (+100%)');
    expect(row.textContent).toContain('Retirement');
    expect(row.querySelector('.bg-retire')).not.toBeNull();
    await click(row);
    expect(sheet.textContent).toContain('Retirement purchase in My IRA. Kept apart from tax.');
    expect(sheet.textContent).toContain('$5,000.00 · $50,000.00 per BTC');
    expect(sheet.textContent).toContain('Statement');
    // No tax tier for it.
    expect(sheet.textContent).not.toContain('How sure');
  });

  it('masks its figures with hide amounts on', async () => {
    app = await renderApp(<YearSheet row={year([...base, iraBuy], 2025)} onClose={noop} />, { priceCents: PRICE, hidden: true });
    const sheet = document.querySelector('[role="dialog"]') as HTMLElement;
    await click(sheet.querySelector('li button') as HTMLButtonElement);
    expect(sheet.textContent).not.toMatch(/\$\d/);
    expect(sheet.textContent).not.toMatch(/\d\.\d{4}/);
    expect(sheet.textContent).not.toMatch(/\d%/);
    expect(sheet.textContent).toContain('Retirement');
  });
});
