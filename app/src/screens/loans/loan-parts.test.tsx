// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, type Rendered } from '../../test/render.tsx';
import { floorDollars, OwedNowParts } from './loan-parts.tsx';

let app: Rendered | null = null;
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

describe('Including interest: whole dollars rounded down', () => {
  it('never understates a loss or overstates a gain (Example L: −$688.73 is −$689)', () => {
    expect(floorDollars(-68_873)).toBe(-68_900);
    expect(floorDollars(68_873)).toBe(68_800);
    expect(floorDollars(-68_800)).toBe(-68_800);
    // Under a dollar keeps its cents.
    expect(floorDollars(-50)).toBe(-50);
    expect(floorDollars(99)).toBe(99);
  });
});
