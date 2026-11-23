// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp, type Rendered } from '../../test/render.tsx';
import { rateHistory } from './loan-details.tsx';
import { HeroMoney, OwedNowParts, PayoffSats } from './loan-parts.tsx';

let app: Rendered | null = null;
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  app?.unmount();
  app = null;
});
const text = () => app?.container.textContent ?? '';
const parts = (unpaid: number, accrued: number, from: string | null, billedThrough: string | null) => ({ unpaidBilledInterestCents: unpaid, accruedInterestCents: accrued, accruedFrom: from, accruedBilledThrough: billedThrough });

describe('Owed now: what it adds to the balance, each part labeled', () => {
  it('Example P: interest billed but not paid, and the days since, not billed yet', async () => {
    app = await renderApp(<OwedNowParts s={parts(2_200, 4_000, '2025-02-01', null)} today="2025-02-20" />);
    expect(text()).toBe('Includes about $22.00 interest billed but not yet paid and about $40.00 since Feb 1, 2025, not billed yet');
  });
  it('only the days since the last payment (a history paid in full)', async () => {
    app = await renderApp(<OwedNowParts s={parts(0, 4_000, '2025-02-01', null)} today="2025-02-20" />);
    expect(text()).toBe('Includes about $40.00 interest since Feb 1, 2025, not billed yet');
  });
  it('days a statement already billed, not paid yet', async () => {
    app = await renderApp(<OwedNowParts s={parts(0, 10_200, '2025-01-01', '2025-01-31')} today="2025-02-20" />);
    expect(text()).toBe('Includes about $102.00 interest since Jan 1, 2025, not paid yet (statement closed Jan 31, 2025)');
  });
  it('only the unpaid part of a billed cycle', async () => {
    app = await renderApp(<OwedNowParts s={parts(10_287, 0, null, null)} today="2025-03-10" />);
    expect(text()).toBe('Includes about $102.87 interest billed but not yet paid');
  });
  it('hides the amounts with Hide amounts', async () => {
    app = await renderApp(<OwedNowParts s={parts(2_200, 4_000, '2025-02-01', null)} today="2025-02-20" />, { hidden: true });
    expect(text()).not.toMatch(/\$\d/);
  });
});

describe('The result after interest: cents, the same on the card and the loan page', () => {
  it('shows every cent (Example L: −$688.73), the cents a size smaller', async () => {
    app = await renderApp(<HeroMoney cents={-68_873} plain />);
    expect(text()).toBe('\u2212$688.73');
    expect(app.container.querySelector('.text-loss')).not.toBeNull();
    app.unmount();
    app = await renderApp(<HeroMoney cents={68_873} plain={false} />);
    expect(text()).toBe('+$688.73');
    expect(app.container.querySelector('.text-gain')).not.toBeNull();
  });
  it('hides with Hide amounts', async () => {
    app = await renderApp(<HeroMoney cents={-68_873} plain />, { hidden: true });
    expect(text()).not.toMatch(/\d/);
  });
});

describe('If paid off today: never better than it is', () => {
  // 0.0342 0001 BTC short is more than 0.0342: it shows 0.0343. 0.2016 9999 BTC left over is less than 0.2017: 0.2016.
  it('rounds a shortfall up and a leftover down at 4 decimals', async () => {
    app = await renderApp(<PayoffSats sats={-3_420_001} estimated={false} />);
    expect(text()).toBe('0.0343 BTC short');
    app.unmount();
    app = await renderApp(<PayoffSats sats={20_169_999} estimated={false} />);
    expect(text()).toBe('0.2016 BTC left over');
    app.unmount();
    // Half-up would show 0.0342 short (understated) and 0.2017 left over (overstated).
    app = await renderApp(<PayoffSats sats={-3_424_999} estimated />);
    expect(text().replace(/\s+/g, ' ')).toBe('≈ about 0.0343 BTC short');
    app.unmount();
    app = await renderApp(<PayoffSats sats={20_165_000} estimated={false} />);
    expect(text()).toBe('0.2016 BTC left over');
  });
  it('never shows a sliver as zero', async () => {
    app = await renderApp(<PayoffSats sats={-3} estimated={false} />);
    expect(text()).toBe('0.0001 BTC short');
    app.unmount();
    app = await renderApp(<PayoffSats sats={4_999} estimated={false} />);
    expect(text()).toBe('0.0000 4999 BTC left over');
  });
  it('is exact in sats, and rounds the same way to the cent in USD', async () => {
    window.localStorage.setItem('bb.unit', 'sats');
    app = await renderApp(<PayoffSats sats={-3_424_999} estimated={false} />);
    expect(text()).toBe('3,424,999 sats short');
    app.unmount();
    window.localStorage.setItem('bb.unit', 'usd');
    // At $94,812.40: 3,424,999 sats is $3,247.3237… : $3,247.33 short, $3,247.32 left over.
    app = await renderApp(<PayoffSats sats={-3_424_999} estimated={false} />);
    expect(text()).toBe('$3,247.33 short');
    app.unmount();
    app = await renderApp(<PayoffSats sats={3_424_999} estimated={false} />);
    expect(text()).toBe('$3,247.32 left over');
  });
  it('hides with Hide amounts', async () => {
    app = await renderApp(<PayoffSats sats={-3_424_999} estimated={false} />, { hidden: true });
    expect(text()).not.toMatch(/\d/);
  });
});

describe('Rate history (loan.rates, oldest first)', () => {
  const r = (from: string, apr: number) => ({ from, aprMillionths: apr, entryId: `rate-${from}` });
  it('one rate: from the start', () => {
    expect(rateHistory([r('2025-03-01', 67_500)], '2026-11-22')).toBe('From the start, Mar 1, 2025.');
  });
  it('a variable rate: since when, then what it was before, newest first', () => {
    expect(rateHistory([r('2025-03-01', 67_500), r('2026-07-01', 72_500)], '2026-11-22')).toBe('Since Jul 1, 2026. Before that: 6.75% from the start, Mar 1, 2025.');
    expect(rateHistory([r('2025-03-01', 67_500), r('2025-09-18', 70_000), r('2026-07-01', 72_500)], '2026-11-22')).toBe(
      'Since Jul 1, 2026. Before that: 7.00% from Sep 18, 2025, 6.75% from the start, Mar 1, 2025.',
    );
  });
  it('a rate set for a day still to come', () => {
    expect(rateHistory([r('2025-03-01', 67_500), r('2026-12-01', 72_500)], '2026-11-22')).toBe('Then 7.25% from Dec 1, 2026. From the start, Mar 1, 2025.');
  });
});
