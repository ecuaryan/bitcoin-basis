/** Planner worked examples, end to end through replay + planSale. All data is synthetic. */
import { describe, expect, test } from 'vitest';
import { replay, DEFAULT_SETTINGS } from '../src/replay.ts';
import { averageCostPerBtc, holdings } from '../src/reports.ts';
import { capitalTaxEffect } from '../src/tax/tax.ts';
import { carryforwardFor, stateChoiceFromSettings } from '../src/tax/settings.ts';
import { picksAfterMove } from '../src/picks.ts';
import { givingDue, givingOnSale, planBorrow, planPrepareSale, planSale, taxContext, taxInput, DEFERRED_NOTE } from '../src/planner/index.ts';
import type { Entry, LedgerState, Settings } from '../src/types.ts';
import { buy, cents, give, noon, pick, receive, sats, sell, testBook, TZ, wallet } from './helpers.ts';

const DATE = '2026-11-15';
const PRICE = cents('75000');
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, filingStatus: 'married-joint', wagesCents: cents('130000') };

function plans(entries: Entry[], settings: Settings = SETTINGS, satsToSell = sats('0.25'), price = PRICE) {
  const state = replay(entries);
  const r = planSale(state, settings, { wallet: 'ex', sats: satsToSell, priceCents: price, onDate: DATE, year: 2026 });
  if (!r.ok) throw new Error(r.error.message);
  return { state, ...r.value };
}

describe('sell planner: spec examples', () => {
  test('1, 2, 3: test book, 0.25 BTC at $75,000', () => {
    const { oldestFirst, lowestTax } = plans(testBook());
    expect(oldestFirst.picks).toEqual([pick('L1', '0.25')]);
    expect(oldestFirst).toMatchObject({ strategy: 'oldest-first', costCents: cents('14000'), ltGainCents: cents('4750'), stGainCents: 0, federalTaxCents: cents('547.50'), stateTaxCents: cents('251.75'), totalTaxCents: cents('799.25'), coinsFrom: '2021-03-15', coinsTo: '2021-03-15', headsUp: false, deferredNote: null, givingCents: null, estimatedSats: 0, estimatedShareBp: 0 });
    expect(lowestTax.picks).toEqual([pick('L3', '0.2'), pick('L4', '0.05')]);
    expect(lowestTax).toMatchObject({ ltGainCents: cents('-4500'), stGainCents: cents('-650'), totalTaxCents: cents('-519'), coinsFrom: '2025-02-10', coinsTo: '2025-12-20', deferredNote: DEFERRED_NOTE });
    expect(lowestTax.carryforwardOut).toEqual({ st: 0, lt: cents('2150') });
    expect(oldestFirst.totalTaxCents - lowestTax.totalTaxCents).toBe(cents('1318.25'));
  });

  test('hand-picked is a third plan; bad picks are errors', () => {
    const state = replay(testBook());
    const req = { wallet: 'ex', sats: sats('0.25'), priceCents: PRICE, onDate: DATE, year: 2026 };
    const ok = planSale(state, SETTINGS, { ...req, handPicks: [pick('L2', '0.25')] });
    expect(ok.ok && ok.value.handPicked).toMatchObject({ strategy: 'hand-picked', costCents: cents('5625'), ltGainCents: cents('13125') });
    const bad = planSale(state, SETTINGS, { ...req, handPicks: [pick('L2', '0.2')] });
    expect(bad).toMatchObject({ ok: false, error: { code: 'picks-sum-mismatch' } });
  });

  test('errors: unknown wallet, too many sats, bad amount, frozen, retirement', () => {
    const state = replay([...testBook(), wallet('ret', 'retirement')]);
    const req = { wallet: 'ex', sats: sats('0.25'), priceCents: PRICE, onDate: DATE, year: 2026 };
    expect(planSale(state, SETTINGS, { ...req, wallet: 'nope' })).toMatchObject({ ok: false, error: { code: 'unknown-wallet' } });
    expect(planSale(state, SETTINGS, { ...req, sats: sats('5') })).toMatchObject({ ok: false, error: { code: 'insufficient-sats' } });
    expect(planSale(state, SETTINGS, { ...req, sats: 0 })).toMatchObject({ ok: false, error: { code: 'invalid-amount' } });
    expect(planSale(state, SETTINGS, { ...req, wallet: 'ret' })).toMatchObject({ ok: false, error: { code: 'retirement-wallet' } });
    const frozen = replay([...testBook(), { id: 'F', kind: 'wallet-freeze', at: noon('2026-01-01'), tz: TZ, wallet: 'ex' }]);
    expect(planSale(frozen, SETTINGS, req)).toMatchObject({ ok: false, error: { code: 'wallet-frozen' } });
  });

  test('18: selling from self-custody is refused with prepare-sale guidance', () => {
    const state = replay([wallet('cold', 'self-custody'), buy('B', 'cold', '2021-01-01', '1', '10000')]);
    const r = planSale(state, SETTINGS, { wallet: 'cold', sats: sats('0.1'), priceCents: PRICE, onDate: DATE, year: 2026 });
    expect(r).toMatchObject({ ok: false, error: { code: 'prepare-sale' } });
  });

  test('already-realized gains that year are the base; heads-up over $1,000', () => {
    const entries = [...testBook(), sell('S0', 'ex', '2026-03-01', [pick('L1', '0.25')], '18750')];
    const { oldestFirst } = plans(entries);
    // base: $4,750 LT already realized, so the next 0.25 of L1 sits on top
    expect(oldestFirst.picks).toEqual([pick('L1', '0.25')]);
    expect(oldestFirst.ltGainCents).toBe(cents('4750'));
    expect(oldestFirst.totalTaxCents).toBe(cents('964.25')); // tax on $9,500 of long gain less tax on the $4,750 already realized
    const big = plans(testBook(), SETTINGS, sats('0.5'), cents('200000'));
    expect(big.oldestFirst.headsUp).toBe(true);
  });

  test('16: $4,750 long gain with a $6,000 long carryforward', () => {
    const settings = { ...SETTINGS, carryforwardLtCents: cents('6000') };
    const { oldestFirst, state } = plans(testBook(), settings);
    expect(oldestFirst.carryforwardOut).toEqual({ st: 0, lt: 0 });
    const ctx = taxContext(state, settings, 2026, DATE);
    expect(capitalTaxEffect(taxInput(ctx, oldestFirst.stGainCents, oldestFirst.ltGainCents)).total).toBe(cents('-216.25'));
  });

  test('losses from past years apply only to the year they are saved for', () => {
    const saved = { ...SETTINGS, carryforwardLtCents: cents('6000') };
    expect(carryforwardFor(saved, 2026)).toEqual({ st: 0, lt: cents('6000') });
    expect(carryforwardFor(saved, 2030, 2026)).toEqual({ st: 0, lt: 0 });
    expect(carryforwardFor(saved, 2026, 2026)).toEqual({ st: 0, lt: cents('6000') });
    expect(carryforwardFor({ ...saved, carryforwardYear: 2026 }, 2026, 2030)).toEqual({ st: 0, lt: cents('6000') });
    expect(carryforwardFor({ ...saved, carryforwardYear: 2027 }, 2026)).toEqual({ st: 0, lt: 0 });
    const other = plans(testBook(), { ...saved, carryforwardYear: 2027 });
    expect(other.oldestFirst.totalTaxCents).toBe(cents('799.25'));
    expect(plans(testBook(), { ...saved, carryforwardYear: 2026 }).oldestFirst.carryforwardOut).toEqual({ st: 0, lt: 0 });
  });

  test('settings state maps to the tax module', () => {
    expect(stateChoiceFromSettings({ state: { kind: 'none' } })).toEqual({ customRate: 0 });
    expect(stateChoiceFromSettings({ state: { kind: 'flat', state: 'ID' } })).toEqual({ code: 'ID' });
    expect(stateChoiceFromSettings({ state: { kind: 'custom', rate: 530 } })).toEqual({ customRate: 530 });
    const none = { ...SETTINGS, state: { kind: 'none' as const } };
    expect(plans(testBook(), none).oldestFirst.totalTaxCents).toBe(cents('547.50'));
  });

  test('12: average cost of the test book', () => {
    const h = holdings(replay(testBook()));
    expect(averageCostPerBtc(h.totalCostCents, h.totalSats)).toBe(5_441_667);
  });

  test('S: carryforward into next year $8,846.90 vs $25,546.90', () => {
    const entries: Entry[] = [
      wallet('ex'),
      buy('A', 'ex', '2021-03-15', '0.25', '5796.90'),
      buy('B', 'ex', '2025-02-10', '0.25', '22496.90'),
    ];
    const settings = { ...SETTINGS, carryforwardLtCents: cents('24800') };
    const { oldestFirst, lowestTax } = plans(entries, settings);
    expect(oldestFirst.picks).toEqual([pick('A', '0.25')]);
    expect(oldestFirst.ltGainCents).toBe(cents('12953.10'));
    expect(lowestTax.picks).toEqual([pick('B', '0.25')]);
    expect(lowestTax.ltGainCents).toBe(cents('-3746.90'));
    expect(oldestFirst.carryforwardOut).toEqual({ st: 0, lt: cents('8846.90') });
    expect(lowestTax.carryforwardOut).toEqual({ st: 0, lt: cents('25546.90') });
    expect(oldestFirst.baseCarryforwardOut.lt).toBe(cents('21800'));
  });

  test('estimated and unknown cost share', () => {
    const entries: Entry[] = [wallet('ex'), buy('A', 'ex', '2021-01-01', '0.1', '1000', 'estimated'), buy('B', 'ex', '2022-01-01', '0.1', '1000', 'documented'), buy('C', 'ex', '2023-01-01', '0.1', '1000', 'unknown')];
    const { oldestFirst } = plans(entries, SETTINGS, sats('0.3'));
    expect(oldestFirst).toMatchObject({ estimatedSats: sats('0.2'), estimatedShareBp: 6667 });
  });
});

describe('giving', () => {
  test('11: $41,250 lot sold for $50,000 at 10% before tax = $875.00', () => {
    expect(givingOnSale({ percent: 1000, gains: cents('8750'), mode: 'before-tax', estimatedTax: 0 })).toBe(cents('875'));
    const entries = [wallet('ex'), buy('B', 'ex', '2020-01-01', '1', '41250')];
    const settings = { ...SETTINGS, givingEnabled: true };
    const { oldestFirst } = plans(entries, settings, sats('1'), cents('50000'));
    expect(oldestFirst.givingCents).toBe(cents('875'));
  });
  test('after-tax subtracts the tax; losses give nothing; half-up', () => {
    expect(givingOnSale({ percent: 1000, gains: 10_000, mode: 'after-tax', estimatedTax: 2_500 })).toBe(750);
    expect(givingOnSale({ percent: 1000, gains: -500, mode: 'before-tax', estimatedTax: 0 })).toBe(0);
    expect(givingOnSale({ percent: 1000, gains: 5, mode: 'before-tax', estimatedTax: 0 })).toBe(1);
    expect(givingOnSale({ percent: 1000, gains: 4, mode: 'before-tax', estimatedTax: 0 })).toBe(0);
  });
  const book: Entry[] = [
    ...testBook(),
    sell('S1', 'ex', '2026-03-01', [pick('L1', '0.25')], '18750'),
    sell('S2', 'ex', '2026-04-01', [pick('L1', '0.25')], '20000'),
    sell('S3', 'ex', '2025-04-01', [pick('L2', '0.1')], '5000'),
    receive('R', 'ex', '2026-05-01', '0.001', '25', { type: 'income' }),
    { id: 'P', kind: 'giving-paid', at: noon('2026-06-01'), tz: TZ, year: 2026, cents: cents('100') },
  ];
  test('giving due: sales minus paid; income listed separately', () => {
    const state = replay(book);
    const d = givingDue(state, { ...SETTINGS, givingEnabled: true, givingName: 'Tithe' }, 2026);
    expect(d.sales.map((s) => [s.entryId, s.givingCents])).toEqual([['S1', cents('475')], ['S2', cents('600')]]);
    expect(d).toMatchObject({ enabled: true, name: 'Tithe', dueCents: cents('1075'), paidCents: cents('100'), owedCents: cents('975'), incomeCents: cents('25') });
    expect(d.income).toHaveLength(1);
    expect(d.paidEntries).toHaveLength(1);
  });
  test('after-tax mode uses each sale\'s own incremental tax in order', () => {
    const state = replay(book);
    const d = givingDue(state, { ...SETTINGS, givingEnabled: true, givingMode: 'after-tax' }, 2026);
    expect(d.sales[0]).toMatchObject({ estimatedTaxCents: cents('799.25'), givingCents: Math.round((cents('4750') - cents('799.25')) / 10) });
    expect(d.sales[1]?.estimatedTaxCents).toBeGreaterThan(0);
  });
  test('spending counts like a sale; network fees do not', () => {
    const withSpend: Entry[] = [...book, sell('SP', 'ex', '2026-07-01', [pick('L2', '0.01')], '750', true)];
    const d = givingDue(replay(withSpend), { ...SETTINGS, givingEnabled: true }, 2026);
    // 0.01 BTC of L2 cost $225.00, spent for $750.00 → $525.00 gain → $52.50 at 10%
    expect(d.sales.map((s) => [s.entryId, s.givingCents])).toEqual([['S1', cents('475')], ['S2', cents('600')], ['SP', cents('52.50')]]);
  });
  test('off: nothing due, paid still shown', () => {
    const d = givingDue(replay(book), SETTINGS, 2026);
    expect(d).toMatchObject({ enabled: false, sales: [], dueCents: 0, paidCents: cents('100'), owedCents: -cents('100') });
  });
});

describe('prepare sale', () => {
  const entries: Entry[] = [wallet('cold', 'self-custody'), wallet('ex'), wallet('ret', 'retirement'), buy('A', 'cold', '2021-01-01', '0.5', '10000'), buy('B', 'cold', '2022-01-01', '0.5', '20000')];
  const state = replay(entries);
  test('a move draft with the chosen picks, then picks for the sale', () => {
    const picks = [pick('A', '0.5'), pick('B', '0.1')];
    const r = planPrepareSale(state, { fromWallet: 'cold', toWallet: 'ex', picks });
    expect(r).toEqual({ ok: true, value: { kind: 'move', from: 'cold', to: 'ex', sats: sats('0.6'), feeSats: 0, feeValueCents: 0, picks } });
    const fee = planPrepareSale(state, { fromWallet: 'cold', toWallet: 'ex', picks, feeSats: 2000, feeValueCents: 150 });
    if (!fee.ok) throw new Error('x');
    expect(fee.value).toMatchObject({ sats: sats('0.6') - 2000, feeSats: 2000, feeValueCents: 150 });
    const moved = replay([...entries, { ...fee.value, id: 'M', at: noon('2026-02-01'), tz: TZ }]);
    expect(moved.errors).toEqual([]);
    const sellPicks = picksAfterMove('M', picks, fee.value.sats);
    const after = planSale(moved, SETTINGS, { wallet: 'ex', sats: fee.value.sats, priceCents: PRICE, onDate: DATE, year: 2026, handPicks: sellPicks });
    expect(after.ok).toBe(true);
  });
  test('errors', () => {
    const picks = [pick('A', '0.1')];
    const code = (r: ReturnType<typeof planPrepareSale>): string | null => (r.ok ? null : r.error.code);
    expect(code(planPrepareSale(state, { fromWallet: 'nope', toWallet: 'ex', picks }))).toBe('unknown-wallet');
    expect(code(planPrepareSale(state, { fromWallet: 'cold', toWallet: 'nope', picks }))).toBe('unknown-wallet');
    expect(code(planPrepareSale(state, { fromWallet: 'cold', toWallet: 'cold', picks }))).toBe('same-wallet');
    expect(code(planPrepareSale(state, { fromWallet: 'ret', toWallet: 'ex', picks }))).toBe('wallet-unavailable');
    expect(code(planPrepareSale(state, { fromWallet: 'ex', toWallet: 'cold', picks }))).toBe('cannot-sell-from-destination');
    expect(code(planPrepareSale(state, { fromWallet: 'cold', toWallet: 'ex', picks: [pick('B', '0.9')] }))).toBe('insufficient-sats');
    expect(code(planPrepareSale(state, { fromWallet: 'cold', toWallet: 'ex', picks, feeSats: sats('0.1') }))).toBe('invalid-amount');
  });
});

describe('borrow planner', () => {
  const lotsState: LedgerState = replay(testBook());
  const base = (over: Partial<Parameters<typeof planBorrow>[0]> = {}): Parameters<typeof planBorrow>[0] => ({
    ...taxContext(lotsState, SETTINGS, 2026, DATE),
    loanCents: cents('25000'), ratePerYear: 1150, marginCallLtv: 7000, liquidationLtv: 8000, pledgedSats: sats('1'), priceCents: cents('94812.40'), lots: lotsState.lots, wallets: lotsState.wallets, wallet: 'ex', ...over,
  });
  test('mockup: $25,000 loan, 1 BTC, 11.5%, 70%/80% at $94,812.40', () => {
    const r = planBorrow(base());
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value).toMatchObject({ ltvBp: 2637, marginCallPriceCents: cents('35714.29'), liquidationPriceCents: cents('31250'), interestPerYearCents: cents('2875'), dropToLiquidationBp: 6704, dropToMarginCallBp: 6233 });
    expect(r.value.liquidation.satsSold).toBe(sats('0.8'));
    // oldest first from the pledged wallet: all of L1 (0.5) then 0.3 of L2
    expect(r.value.liquidation.picks).toEqual([pick('L1', '0.5'), pick('L2', '0.3')]);
    expect(r.value.liquidation.sale).toMatchObject({ proceedsCents: cents('25000'), costCents: cents('28000') + cents('6750') });
  });
  test('13: $25,000 against 1 BTC at $75,000, liquidation 80%', () => {
    const r = planBorrow(base({ priceCents: PRICE }));
    expect(r.ok && r.value).toMatchObject({ ltvBp: 3333, liquidationPriceCents: cents('31250'), marginCallPriceCents: cents('35714.29') });
  });
  test('errors and caps', () => {
    expect(planBorrow(base({ loanCents: 0 }))).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(planBorrow(base({ marginCallLtv: 9000 }))).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(planBorrow(base({ pledgedSats: sats('5') }))).toMatchObject({ ok: false, error: { code: 'insufficient-sats' } });
    const big = replay([wallet('ex'), buy('B', 'ex', '2024-01-01', '100', '1')]);
    expect(planBorrow(base({ lots: big.lots, wallets: big.wallets, loanCents: 1, pledgedSats: sats('100'), liquidationLtv: 10_000, marginCallLtv: 10_000 }))).toMatchObject({ ok: false, error: { code: 'invalid-input', message: 'the loan is too small to price' } });
    expect(planBorrow(base({ priceCents: 0 }))).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(planBorrow(base({ liquidationLtv: 10_001 }))).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(planBorrow(base({ loanCents: 100_000_000_000_001 }))).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    // Figures that would not be safe integers are refused, never returned rounded.
    expect(planBorrow(base({ loanCents: 1_000_000, pledgedSats: 1, marginCallLtv: 1, liquidationLtv: 10_000 }))).toMatchObject({ ok: false, error: { code: 'invalid-input', message: 'these numbers are too large to compute' } });
    const full = planBorrow(base({ liquidationLtv: 10_000, marginCallLtv: 10_000, pledgedSats: sats('0.5'), loanCents: 7 }));
    expect(full.ok && full.value.liquidation.satsSold).toBeLessThanOrEqual(sats('0.5'));
  });
});

describe('borrow planner: the pledging wallet', () => {
  const freeze: Entry = { id: 'F', kind: 'wallet-freeze', at: noon('2025-01-01'), tz: TZ, wallet: 'cel' };
  const archive: Entry = { id: 'A', kind: 'wallet-update', at: noon('2025-01-01'), tz: TZ, wallet: 'old', archived: true };
  const state = replay([wallet('ex'), wallet('cel'), wallet('old'), wallet('ret', 'retirement'), buy('B', 'cel', '2023-01-01', '1', '20000'), buy('O', 'old', '2023-01-01', '1', '20000'), freeze, archive]);
  const req = (w: string): Parameters<typeof planBorrow>[0] => ({ ...taxContext(state, SETTINGS, 2026, DATE), loanCents: cents('1000'), ratePerYear: 0, marginCallLtv: 7000, liquidationLtv: 8000, pledgedSats: sats('0.5'), priceCents: PRICE, lots: state.lots, wallets: state.wallets, wallet: w });
  test.each([
    ['nope', 'unknown-wallet'],
    ['ret', 'retirement-wallet'],
    ['cel', 'wallet-frozen'],
    ['old', 'wallet-archived'],
    ['ex', 'insufficient-sats'],
  ])('%s → %s', (w, code) => {
    expect(planBorrow(req(w))).toMatchObject({ ok: false, error: { code } });
  });
});

describe('give entry still unaffected by planner (sanity)', () => {
  test('gift removes lots with no gain', () => {
    const s = replay([...testBook(), give('G', 'ex', DATE, [pick('L2', '0.01')], '750', 'person', 'Sam')]);
    expect(s.disposals).toEqual([]);
  });
});
