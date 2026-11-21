/**
 * Targeted tests added from mutation testing (`npm run mutate`): each one pins down behavior that a
 * mutant of money.ts, tax/*, picks.ts or sell-guard.ts survived. Exact values, no snapshots.
 */
import { describe, expect, test } from 'vitest';
import { divRoundHalfUp, mulDivOrNull, mulDivRoundHalfUp, splitProportional } from '../src/money.ts';
import { lowestTaxOrder, withProceeds, type Piece } from '../src/picks.ts';
import { canSellFrom } from '../src/sell-guard.ts';
import { capitalTaxEffect, marginalRates, taxForYear, type TaxInput } from '../src/tax/tax.ts';
import { federalTableFor } from '../src/tax/tables/index.ts';
import { STATUTORY_SOURCES } from '../src/tax/tables/statutory.ts';
import type { Lot, Wallet } from '../src/types.ts';

describe('money guards', () => {
  test('division by zero is refused by name', () => {
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(/division by zero/);
  });
  test('a negative divisor flips signs; halves go away from zero', () => {
    expect(divRoundHalfUp(1n, -2n)).toBe(-1n);
    expect(divRoundHalfUp(-1n, -2n)).toBe(1n);
    expect(divRoundHalfUp(-1n, 2n)).toBe(-1n);
    expect(divRoundHalfUp(0n, 5n)).toBe(0n);
  });
  test('each mulDiv argument is checked as a safe integer, by name', () => {
    expect(() => mulDivOrNull(1.5, 1, 1)).toThrow(/^a must be a safe integer/);
    expect(() => mulDivOrNull(1, 2 ** 53, 1)).toThrow(/^b must be a safe integer/);
    expect(() => mulDivOrNull(1, 1, 0.5)).toThrow(/^c must be a safe integer/);
  });
  test('an unsafe result is null, or refused', () => {
    expect(mulDivOrNull(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1)).toBeNull();
    expect(() => mulDivRoundHalfUp(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1)).toThrow(/safe integer/);
  });
  test('splitProportional checks total and weights by name and refuses zero weights', () => {
    expect(() => splitProportional(1.5, [1])).toThrow(/^total must be a safe integer/);
    expect(() => splitProportional(10, [1, 0.5])).toThrow(/^weight must be a safe integer/);
    expect(() => splitProportional(10, [0, 0])).toThrow(/weights sum to zero/);
    expect(splitProportional(10, [])).toEqual([]);
  });
});

const base: TaxInput = { year: 2026, filingStatus: 'single', wages: 100_000_00, st: 0, lt: 0, carryforward: { st: 0, lt: 0 }, state: { customRate: 0 } };
const io = (patch: Partial<TaxInput>): TaxInput => ({ ...base, ...patch });

describe('tax input validation names the bad field', () => {
  const bad: [Partial<TaxInput>, RegExp][] = [
    [{ wages: -1 }, /^wages must not be negative/],
    [{ wages: 1.5 }, /^wages must be a safe integer/],
    [{ st: 0.5 }, /^st must be a safe integer/],
    [{ lt: 2 ** 53 }, /^lt must be a safe integer/],
    [{ carryforward: { st: -1, lt: 0 } }, /^carryforward\.st must not be negative/],
    [{ carryforward: { st: 0, lt: -1 } }, /^carryforward\.lt must not be negative/],
    [{ year: 2026.5 }, /^year must be an integer/],
    [{ state: { customRate: 10_001 } }, /^custom state rate must be 0\.\.10000/],
    [{ state: { customRate: -1 } }, /^custom state rate must be 0\.\.10000/],
    [{ state: { customRate: 0.5 } }, /^custom state rate must be 0\.\.10000/],
    [{ state: { code: 'ZZ' as never } }, /^unknown state ZZ/],
    [{ st: Number.MAX_SAFE_INTEGER, lt: Number.MAX_SAFE_INTEGER }, /^net is too large/],
  ];
  test.each(bad)('%j', (patch, message) => {
    expect(() => taxForYear(io(patch))).toThrow(RangeError);
    expect(() => taxForYear(io(patch))).toThrow(message);
  });
  test('a zero custom rate and a 100% custom rate are both allowed', () => {
    expect(taxForYear(io({ st: 1000_00, state: { customRate: 0 } })).state).toBe(0);
    expect(taxForYear(io({ st: 1000_00, state: { customRate: 10_000 } })).state).toBe(1000_00);
  });
});

describe('tax netting', () => {
  test('a short gain with a long loss has no preferential income and is taxed as ordinary', () => {
    const r = taxForYear(io({ st: 5000_00, lt: -2000_00 }));
    expect(r.netting).toEqual({ st: 5000_00, lt: -2000_00, net: 3000_00, lossDeduction: 0, includedInIncome: 3000_00, preferential: 0, taxableIncome: 86_900_00 });
    expect(r.federalParts).toEqual({ ordinary: 13_830_00, longTerm: 0, niit: 0 });
  });
  test('a net loss with a long gain has no preferential income; the deduction is capped at $3,000', () => {
    const r = taxForYear(io({ st: -10_000_00, lt: 2000_00 }));
    expect(r.netting).toEqual({ st: -10_000_00, lt: 2000_00, net: -8000_00, lossDeduction: 3000_00, includedInIncome: -3000_00, preferential: 0, taxableIncome: 80_900_00 });
    expect(r.federal).toBe(12_510_00);
    expect(r.carryforwardOut).toEqual({ st: 5000_00, lt: 0 });
  });
  test('equal short loss and long gain net to zero: nothing included, nothing deducted', () => {
    const r = taxForYear(io({ st: -2000_00, lt: 2000_00 }));
    expect(r.netting).toMatchObject({ net: 0, lossDeduction: 0, includedInIncome: 0, preferential: 0, taxableIncome: 83_900_00 });
    expect(r.federal).toBe(13_170_00);
  });
  test('capital tax effect on a short gain adds federal and state exactly', () => {
    expect(capitalTaxEffect(io({ st: 5000_00, state: { customRate: 500 } }))).toMatchObject({ federal: 1100_00, state: 250_00, total: 1350_00 });
  });
});

describe('tax table fallback notes', () => {
  test('before the first table: earliest is used and said so; after the last: latest', () => {
    expect(capitalTaxEffect(io({ year: 2020, st: 5000_00 })).assumptions).toMatchObject({ tableYear: 2025, fellBack: true, notes: ['No 2020 federal table; used the earliest one (2025).'] });
    expect(capitalTaxEffect(io({ year: 2035, st: 5000_00 })).assumptions).toMatchObject({ tableYear: 2027, fellBack: true, notes: ['No 2035 federal table; used the latest one (2027).'] });
    expect(federalTableFor(2024).table.year).toBe(2025);
    expect(federalTableFor(2025).fellBack).toBe(false);
    expect(federalTableFor(2028).table.year).toBe(2027);
  });
  test('statutory sources list the three Code sections', () => {
    expect(STATUTORY_SOURCES).toHaveLength(3);
  });
});

describe('marginal rates', () => {
  test('a short gain is taxed at 10% while the long-term dollar is in the 0% band: the rates are not replaced by the wages-only ones', () => {
    // Wages-only position has no taxable income (both rates 0); with $20,000 short and $1,000 long gains the next
    // short dollar costs 10% and the next long dollar 0%.
    expect(marginalRates(io({ wages: 0, st: 20_000_00, lt: 1000_00 }))).toEqual({ st: 0.1, lt: 0 });
  });
});

describe('sell guard', () => {
  const w = (patch: Partial<Wallet>): Wallet => ({ id: 'x', name: 'X', type: 'exchange', defaultProof: '', archived: false, frozen: false, closeOutEntryId: null, recoveredCents: 0, ...patch });
  test('refusals carry the wallet id, and self-custody gets three steps', () => {
    const retirement = canSellFrom(w({ type: 'retirement' }));
    expect(retirement).toMatchObject({ ok: false, error: { code: 'retirement-wallet', wallet: 'x' } });
    expect(canSellFrom(w({ frozen: true }))).toMatchObject({ ok: false, error: { code: 'wallet-frozen', wallet: 'x' } });
    const self = canSellFrom(w({ type: 'self-custody' }));
    expect(self).toMatchObject({ ok: false, error: { code: 'prepare-sale', wallet: 'x' } });
    if (!self.ok && self.error.code === 'prepare-sale') expect(self.error.steps).toHaveLength(3);
  });
});

const lot = (id: string, sats: number, cost: number, extra: Partial<Lot> = {}): Lot => ({
  id, wallet: 'ex', sats, costCents: cost, acquiredDate: '2020-01-01', acquiredAt: '2020-01-01T12:00:00Z', tier: 'documented', proof: '',
  originEntryId: id, alwaysLongTerm: false, tz: 'America/Boise', lossBasis: null, ...extra,
});

describe('gift dual basis at the boundaries', () => {
  // A gift worth $100 when received (loss basis) whose giver paid $200 (our cost for a gain).
  const piece: Piece = { lotId: 'g', sats: 100, costCents: 200_00, acquiredDate: '2019-01-01', tier: 'documented', term: 'long', inherited: false, lossBasis: { costCents: 100_00, acquiredDate: '2024-03-01', term: 'short' } };
  test('proceeds above the giver\'s cost: a gain on the giver\'s cost and date', () => {
    expect(withProceeds(piece, 250_00)).toMatchObject({ costCents: 200_00, gainCents: 50_00, acquiredDate: '2019-01-01', term: 'long' });
  });
  test('proceeds equal to the giver\'s cost: no gain or loss', () => {
    expect(withProceeds(piece, 200_00)).toMatchObject({ costCents: 200_00, gainCents: 0, acquiredDate: '2019-01-01' });
  });
  test('proceeds between the two bases: no gain or loss; cost reported equals proceeds', () => {
    expect(withProceeds(piece, 150_00)).toMatchObject({ costCents: 150_00, gainCents: 0, acquiredDate: '2019-01-01', term: 'long' });
  });
  test('proceeds exactly the value at the gift: no gain or loss, still on the giver\'s date and term (not the gift date)', () => {
    expect(withProceeds(piece, 100_00)).toMatchObject({ costCents: 100_00, gainCents: 0, acquiredDate: '2019-01-01', term: 'long' });
  });
  test('proceeds below the value at the gift: a loss against the value, on the gift date and term', () => {
    expect(withProceeds(piece, 50_00)).toMatchObject({ costCents: 100_00, gainCents: -50_00, acquiredDate: '2024-03-01', term: 'short' });
  });
});

describe('lowest-tax order for a gift', () => {
  const opts = { stRate: 0.3, ltRate: 0.2, onDate: '2026-01-01' };
  test('priced below the value at the gift, it ranks by the loss on that value (1/sat basis), using the gift date for the term', () => {
    const gift = lot('gift', 100, 200, { lossBasis: { costCents: 100, acquiredDate: '2025-12-01' } });
    const other = lot('other', 100, 120); // loses 0.7/sat long-term at 0.5/sat
    // price 0.5/sat: gift loses 0.5/sat short-term (rate 0.3 -> -0.15); other loses 0.7 (rate 0.2 -> -0.14)
    expect(lowestTaxOrder([other, gift], 'ex', { ...opts, priceCents: 50_000_000 }).map((l) => l.id)).toEqual(['gift', 'other']);
  });
});
