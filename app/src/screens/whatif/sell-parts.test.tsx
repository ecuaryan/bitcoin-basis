// @vitest-environment happy-dom
import { replay, type Entry, type SalePlan } from '@bitcoin-basis/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney, groupedBtc } from '../../lib/format.ts';
import { click, renderApp, type Rendered } from '../../test/render.tsx';
import { LotsUsedTable, PlanCard } from './sell-parts.tsx';
import { planForWallet } from './sell-logic.ts';

let app: Rendered | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

// Synthetic book: an old cheap lot, an Estimated lot, and a recent lot bought above the sale price.
const TZ = 'America/Boise';
const entries: Entry[] = [
  { id: 'w1', kind: 'wallet', at: '2021-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Ex', type: 'exchange', defaultProof: '' },
  { id: 'a', kind: 'buy', at: '2021-03-09T17:00:00Z', tz: TZ, wallet: 'ex', sats: 5_000_000, costCents: 250_000, tier: 'estimated' },
  { id: 'b', kind: 'buy', at: '2021-07-20T17:00:00Z', tz: TZ, wallet: 'ex', sats: 10_000_000, costCents: 320_000, tier: 'documented' },
  { id: 'c', kind: 'buy', at: '2026-02-03T17:00:00Z', tz: TZ, wallet: 'ex', sats: 10_000_000, costCents: 1_100_000, tier: 'documented' },
];

function plans(priceCents: number): { oldestFirst: SalePlan; lowestTax: SalePlan } {
  const state = replay(entries);
  const settings = { ...state.settings, wagesCents: 12_000_000 };
  const r = planForWallet({ ...state, settings }, settings, { wallet: 'ex', sats: 15_000_000, priceCents, onDate: '2026-11-15', year: 2026 }).plans;
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const text = (): string => app?.container.textContent ?? '';

describe('PlanCard', () => {
  it('shows every row in the same order, with the tax as its math and what you keep', async () => {
    const { oldestFirst: p } = plans(9_600_000);
    app = await renderApp(<PlanCard title="Oldest first" plan={p} active onSelect={() => undefined} pill="Least tax" />);
    const t = text();
    const order = ['Least tax', 'Oldest first', 'Tax this adds', 'Federal', 'You keep after tax', 'sale −', 'Short-term gain', 'Long-term gain', 'Losses left for next year', 'On Estimated or Unknown cost', 'Lots used'];
    const at = order.map((w) => t.indexOf(w));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(t).toContain(`Federal ${formatMoney(p.federalTaxCents)} + state ${formatMoney(p.stateTaxCents)}`);
    expect(p.federalTaxCents + p.stateTaxCents).toBe(p.totalTaxCents);
    expect(t).toContain(`${formatMoney(p.afterTaxCents)}${formatMoney(p.proceedsCents)} sale − ${formatMoney(p.totalTaxCents)} tax`);
    // Oldest first sells only long-term lots: short-term is an empty, muted $0.00. A third of it is Estimated.
    expect(t).toContain('Short-term gain$0.00');
    expect(t).toContain('On Estimated or Unknown cost34%');
    expect(t).toContain('Lots usedMar–Jul\u00a020212 lots');
    const radio = app.container.querySelector('[role="radio"]');
    expect(radio?.getAttribute('aria-checked')).toBe('true');
    expect(radio?.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('says "Tax this saves" in green when the sale lowers tax', async () => {
    const { lowestTax: p } = plans(5_000_000);
    expect(p.totalTaxCents).toBeLessThan(0);
    app = await renderApp(<PlanCard title="Lowest tax" plan={p} active={false} onSelect={() => undefined} />);
    expect(text()).toContain(`Tax this saves${formatMoney(-p.totalTaxCents)}`);
    expect(text()).toContain(`sale + ${formatMoney(-p.totalTaxCents)} tax saved`);
    expect(app.container.querySelector('.text-gain')?.textContent).toBe(formatMoney(-p.totalTaxCents));
    expect(text()).toContain('Short-term loss');
    expect(app.container.querySelector('[role="radio"]')?.getAttribute('aria-describedby')).toBeNull();
  });

  it('Hide amounts hides every figure, the percent too', async () => {
    const { oldestFirst: p } = plans(9_600_000);
    app = await renderApp(<PlanCard title="Oldest first" plan={p} active onSelect={() => undefined} />, { hidden: true });
    // Only the lots' dates and count keep their digits.
    expect(text()).toMatch(/Lots usedMar–Jul\u00a020212 lots$/);
    expect(text().replace(/Lots used.*$/, '')).not.toMatch(/\d/);
  });
});

describe('Lots used table', () => {
  it('lists each lot with cost, sold for and gain; the Total row adds up to the plan', async () => {
    const { lowestTax: p } = plans(9_600_000);
    app = await renderApp(<LotsUsedTable planName="Lowest tax" plan={p} />);
    const rows = [...app.container.querySelectorAll('li')];
    expect(rows).toHaveLength(p.pieces.length);
    p.pieces.forEach((piece, i) => {
      const row = rows[i]?.textContent ?? '';
      expect(row).toContain(groupedBtc(piece.sats));
      expect(row).toContain(formatMoney(piece.costCents));
      expect(row).toContain(formatMoney(piece.proceedsCents));
      expect(row).toContain(formatMoney(piece.gainCents, { signed: true }));
      expect(row).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
    });
    const total = app.container.querySelector('[aria-label="Total of the lots used"]')?.textContent ?? '';
    expect(total).toContain(groupedBtc(15_000_000));
    expect(total).toContain(formatMoney(p.costCents));
    expect(total).toContain(formatMoney(p.proceedsCents));
    expect(total).toContain(formatMoney(p.stGainCents + p.ltGainCents, { signed: true }));
    expect(text()).toContain(`Lots used in Lowest tax`);
  });

  it('marks Estimated lots and folds away', async () => {
    const { oldestFirst: p } = plans(9_600_000);
    app = await renderApp(<LotsUsedTable planName="Oldest first" plan={p} />);
    expect(app.container.querySelector('li')?.textContent).toContain('Long-term · Estimated');
    const toggle = app.container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(app.container.querySelector(`#${CSS.escape(toggle.getAttribute('aria-controls') ?? '')}`)?.hasAttribute('hidden')).toBe(true);
  });

  it('starts folded when the plan uses more than 8 lots', async () => {
    const many: Entry[] = [entries[0] as Entry, ...Array.from({ length: 9 }, (_, i): Entry => ({ id: `m${i}`, kind: 'buy', at: `2024-0${i + 1}-01T17:00:00Z`, tz: TZ, wallet: 'ex', sats: 1_000_000, costCents: 50_000, tier: 'documented' }))];
    const state = replay(many);
    const r = planForWallet(state, state.settings, { wallet: 'ex', sats: 9_000_000, priceCents: 9_600_000, onDate: '2026-11-15', year: 2026 }).plans;
    if (!r.ok) throw new Error(r.error.message);
    app = await renderApp(<LotsUsedTable planName="Oldest first" plan={r.value.oldestFirst} />);
    expect(app.container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    expect(text()).toContain('9 lots · Jan–Sep\u00a02024');
  });

  it('Hide amounts hides every figure', async () => {
    const { oldestFirst: p } = plans(9_600_000);
    app = await renderApp(<LotsUsedTable planName="Oldest first" plan={p} />, { hidden: true });
    // Only dates (with years) and the lot count keep digits.
    const figures = [...app.container.querySelectorAll('li > span:not(:first-child), [aria-label="Total of the lots used"] > span:not(:first-child):not(:nth-child(2))')].map((s) => s.textContent ?? '');
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) expect(f).not.toMatch(/\d/);
  });
});
