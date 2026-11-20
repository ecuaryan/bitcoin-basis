/** Property tests over random histories (spec: "Property tests"). */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { exportEntriesJson, importEntriesJson } from '../src/io.ts';
import { oldestFirst } from '../src/picks.ts';
import { replay } from '../src/replay.ts';
import type { Entry, LedgerState, LotPick } from '../src/types.ts';
import { TZ, wallet } from './helpers.ts';

type OpKind = 'buy' | 'income' | 'sell' | 'move' | 'give' | 'lost';
interface Op {
  kind: OpKind;
  w: number;
  w2: number;
  amount: number;
  money: number;
  fee: number;
  bad: boolean;
}

const WALLETS = ['a', 'b', 'c'];
const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<OpKind>('buy', 'buy', 'income', 'sell', 'move', 'give', 'lost'),
  w: fc.nat(2),
  w2: fc.nat(2),
  amount: fc.integer({ min: 1, max: 300_000_000 }),
  money: fc.integer({ min: 0, max: 10_000_000_000 }),
  fee: fc.integer({ min: 0, max: 5_000 }),
  bad: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
});

const at = (i: number): string => new Date(Date.UTC(2020, 0, 1) + i * 7 * 3_600_000).toISOString().replace('.000Z', 'Z');
const id = (i: number): string => `e${String(i).padStart(4, '0')}`;

/** Build a history step by step, picking from the state replayed so far (sometimes badly on purpose). */
function build(ops: readonly Op[]): Entry[] {
  const entries: Entry[] = [wallet('a'), wallet('b'), wallet('c', 'self-custody')];
  ops.forEach((op, i) => {
    const w = WALLETS[op.w] as string;
    const base = { id: id(i), at: at(i), tz: TZ };
    if (op.kind === 'buy') {
      entries.push({ ...base, kind: 'buy', wallet: w, sats: op.amount, costCents: op.money, tier: 'documented' });
      return;
    }
    if (op.kind === 'income') {
      entries.push({ ...base, kind: 'receive', wallet: w, sats: op.amount, valueCents: op.money % 1_000_000, source: { type: 'income' } });
      return;
    }
    const lots = replay(entries).lots;
    const held = lots.filter((l) => l.wallet === w).reduce((s, l) => s + l.sats, 0);
    const fee = op.kind === 'move' ? op.fee : 0;
    let picks: LotPick[];
    let total: number;
    if (op.bad) {
      // Deliberately questionable: whole requested amount from the first lot anywhere.
      const target = lots[op.amount % Math.max(lots.length, 1)];
      total = op.amount + fee;
      picks = [{ lotId: target?.id ?? 'missing', sats: total }];
    } else {
      total = Math.min(op.amount + fee, held);
      if (total <= fee) return;
      const r = oldestFirst(lots, w, total);
      if (!r.ok) throw new Error('oldestFirst failed on a valid amount');
      picks = r.value;
    }
    const sats = total - fee;
    if (op.kind === 'sell') entries.push({ ...base, kind: 'sell', wallet: w, sats, proceedsCents: op.money, picks, spent: op.fee % 2 === 0 });
    if (op.kind === 'give') entries.push({ ...base, kind: 'give', wallet: w, sats, valueCents: op.money, to: op.fee % 2 === 0 ? 'person' : 'charity', recipient: 'R', picks });
    if (op.kind === 'lost') entries.push({ ...base, kind: 'lost', wallet: w, sats, cause: 'hack', picks });
    if (op.kind === 'move') {
      const to = WALLETS[op.w2 === op.w ? (op.w2 + 1) % 3 : op.w2] as string;
      entries.push({ ...base, kind: 'move', from: w, to, sats, feeSats: fee, feeValueCents: fee === 0 ? 0 : op.money % 10_000, picks });
    }
  });
  return entries;
}

const historyArb = fc.array(opArb, { minLength: 1, maxLength: 25 }).map(build);
const RUNS = { numRuns: 1000 };

const total = (xs: readonly { sats: number }[]): number => xs.reduce((s, x) => s + x.sats, 0);
const totalCost = (xs: readonly { costCents: number }[]): number => xs.reduce((s, x) => s + x.costCents, 0);

function inflow(entries: readonly Entry[], state: LedgerState): { sats: number; cost: number } {
  const applied = new Set(state.applied);
  let sats = 0;
  let cost = 0;
  for (const e of entries) {
    if (!applied.has(e.id)) continue;
    if (e.kind === 'buy') {
      sats += e.sats;
      cost += e.costCents;
    }
    if (e.kind === 'receive') {
      sats += e.sats;
      cost += e.valueCents;
    }
  }
  return { sats, cost };
}

describe('properties', () => {
  test('the generator produces disposals, fees and rejected entries', () => {
    const states = fc.sample(historyArb, { numRuns: 300, seed: 1 }).map(replay);
    expect(states.some((s) => s.disposals.some((d) => d.kind === 'fee'))).toBe(true);
    expect(states.some((s) => s.disposals.some((d) => d.kind === 'sell'))).toBe(true);
    expect(states.some((s) => s.errors.some((e) => e.code === 'insufficient-sats'))).toBe(true);
    expect(states.some((s) => s.charityGifts.length > 0 && s.lost.length > 0)).toBe(true);
  });

  test('1. sats and cost always balance: in = held + out', () => {
    fc.assert(
      fc.property(historyArb, (entries) => {
        const s = replay(entries);
        const out = [s.disposals, s.gifts, s.charityGifts, s.lost, s.closeOuts];
        const inn = inflow(entries, s);
        expect(inn.sats).toBe(total(s.lots) + out.reduce((acc, xs) => acc + total(xs), 0));
        expect(inn.cost).toBe(totalCost(s.lots) + out.reduce((acc, xs) => acc + totalCost(xs), 0));
      }),
      RUNS,
    );
  });

  test('2. no lot ever goes negative; bad picks are rejected, not clamped', () => {
    fc.assert(
      fc.property(historyArb, (entries) => {
        const s = replay(entries);
        for (const l of s.lots) {
          expect(l.sats).toBeGreaterThan(0);
          expect(l.costCents).toBeGreaterThanOrEqual(0);
        }
        const failed = new Set(s.errors.map((e) => e.entryId));
        for (const e of entries) expect(failed.has(e.id) !== s.applied.includes(e.id)).toBe(true);
      }),
      RUNS,
    );
  });

  test('3. saved disposals never change when an unrelated earlier purchase is added', () => {
    fc.assert(
      fc.property(historyArb, fc.nat(2), fc.integer({ min: 1, max: 100_000_000 }), (entries, w, sats) => {
        const earlier: Entry = { id: 'zz-late-id', kind: 'buy', at: '2019-06-01T00:00:00Z', tz: TZ, wallet: WALLETS[w] as string, sats, costCents: 1, tier: 'estimated' };
        const before = replay(entries);
        const after = replay([...entries, earlier]);
        expect(after.disposals).toEqual(before.disposals);
        expect(after.gifts).toEqual(before.gifts);
        expect(after.lost).toEqual(before.lost);
      }),
      RUNS,
    );
  });

  test('4. input order does not matter; replaying a prefix agrees with the full replay', () => {
    fc.assert(
      fc.property(historyArb.chain((entries) => fc.tuple(fc.constant(entries), fc.shuffledSubarray(entries, { minLength: entries.length }), fc.nat(entries.length))), ([entries, shuffled, cut]) => {
        const full = replay(entries);
        expect(replay(shuffled)).toEqual(full);
        const prefix = replay(entries.slice(0, cut));
        expect(full.disposals.slice(0, prefix.disposals.length)).toEqual(prefix.disposals);
      }),
      RUNS,
    );
  });

  test('5. export then import reproduces every number', () => {
    fc.assert(
      fc.property(historyArb, (entries) => {
        const back = importEntriesJson(exportEntriesJson(entries));
        expect(back.ok).toBe(true);
        if (back.ok) expect(replay(back.value)).toEqual(replay(entries));
      }),
      RUNS,
    );
  });

  test('6. splits add back exactly', () => {
    fc.assert(
      fc.property(historyArb, (entries) => {
        const s = replay(entries);
        for (const d of s.disposals) {
          expect(totalCost(d.picks)).toBe(d.costCents);
          expect(d.picks.reduce((acc, p) => acc + p.proceedsCents, 0)).toBe(d.proceedsCents);
          expect(d.stGainCents + d.ltGainCents).toBe(d.gainCents);
          expect(total(d.picks)).toBe(d.sats);
        }
        for (const g of [...s.gifts, ...s.charityGifts]) expect(g.picks.reduce((acc, p) => acc + p.valueCents, 0)).toBe(g.valueCents);
      }),
      RUNS,
    );
  });
});
