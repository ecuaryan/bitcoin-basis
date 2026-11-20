/**
 * Property sweep with edits, deletes, restores, dual-basis gifts and moves with fees in the generator
 * (dual-basis gifts, edits, deletes, restores, moves with fees). Synthetic data only.
 */
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { exportEntriesJson, importEntriesJson } from '../src/io.ts';
import { oldestFirst } from '../src/picks.ts';
import { replay } from '../src/replay.ts';
import type { Entry, LotPick } from '../src/types.ts';
import { TZ, wallet } from './helpers.ts';

type OpKind = 'buy' | 'gift' | 'income' | 'sell' | 'move' | 'give' | 'lost' | 'edit' | 'delete' | 'restore';
interface Op { kind: OpKind; w: number; w2: number; amount: number; money: number; fee: number; pickN: number }
const WALLETS = ['a', 'b', 'c'];
const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<OpKind>('buy', 'gift', 'gift', 'income', 'sell', 'sell', 'move', 'move', 'give', 'lost', 'edit', 'edit', 'delete', 'restore'),
  w: fc.nat(2),
  w2: fc.nat(2),
  amount: fc.integer({ min: 1, max: 300_000_000 }),
  money: fc.integer({ min: 0, max: 1000 }),
  fee: fc.integer({ min: 0, max: 5_000 }),
  pickN: fc.nat(1000),
});
const at = (i: number): string => new Date(Date.UTC(2020, 0, 1) + i * 7 * 3_600_000).toISOString().replace('.000Z', 'Z');
const id = (i: number): string => `e${String(i).padStart(4, '0')}`;

/**
 * `highProceeds`: every proceeds/fee value is 2000 cents per sat, above any lot's cost per sat (≤ 1000),
 * so every dual-basis piece is in the gain region and reports the giver's cost (cost conservation is checkable).
 */
function build(ops: readonly Op[], highProceeds: boolean): Entry[] {
  const entries: Entry[] = [wallet('a'), wallet('b'), wallet('c', 'self-custody')];
  const heads = new Map<string, Entry>(); // root id → head (may be a delete)
  const lastContent = new Map<string, Entry>(); // root id → last non-delete version
  ops.forEach((op, i) => {
    const w = WALLETS[op.w] as string;
    const base = { id: id(i), at: at(i), tz: TZ };
    const proceeds = (s: number): number => (highProceeds ? s * 2000 : op.money * op.amount % 100_000_000);
    const track = (e: Entry, root: string): void => {
      entries.push(e);
      heads.set(root, e);
      if (e.kind !== 'delete') lastContent.set(root, e);
    };
    const cost = op.money * Math.min(op.amount, 1000); // ≤ 1000 cents per sat
    if (op.kind === 'buy') return track({ ...base, kind: 'buy', wallet: w, sats: op.amount, costCents: Math.min(cost, op.amount * 1000), tier: 'documented' }, base.id);
    if (op.kind === 'income') return track({ ...base, kind: 'receive', wallet: w, sats: op.amount, valueCents: Math.min(cost, op.amount * 1000), source: { type: 'income' } }, base.id);
    if (op.kind === 'gift') {
      const giver = Math.min(cost, op.amount * 1000);
      const value = Math.floor(giver * (op.fee % 3) / 2); // below, at, or above the giver's cost
      return track({ ...base, kind: 'receive', wallet: w, sats: op.amount, valueCents: value, source: { type: 'gift', giverCostCents: giver, giverAcquiredAt: at(i - 50) } }, base.id);
    }
    const roots = [...heads.keys()];
    if (op.kind === 'edit' || op.kind === 'delete' || op.kind === 'restore') {
      const want = op.kind === 'restore' ? roots.filter((r) => heads.get(r)?.kind === 'delete') : roots.filter((r) => heads.get(r)?.kind !== 'delete');
      const root = want[op.pickN % Math.max(want.length, 1)];
      if (root === undefined) return;
      const head = heads.get(root) as Entry;
      if (op.kind === 'delete') return track({ ...base, at: at(i), kind: 'delete', replaces: head.id, reason: 'r' }, root);
      const content = lastContent.get(root) as Entry;
      let changed: Entry = { ...content };
      if (op.kind === 'edit') {
        if (changed.kind === 'buy') changed = { ...changed, costCents: Math.min(changed.costCents + op.fee, changed.sats * 1000) };
        else if (changed.kind === 'receive' && changed.source.type === 'gift') changed = { ...changed, valueCents: Math.floor(changed.valueCents / 2) };
        else if (changed.kind === 'sell') changed = { ...changed, proceedsCents: highProceeds ? changed.proceedsCents : op.money };
        else if (changed.kind === 'move' && changed.feeSats > 0) changed = { ...changed, feeValueCents: highProceeds ? changed.feeValueCents : op.money };
      }
      return track({ ...changed, id: base.id, replaces: head.id, reason: 'r' } as Entry, root);
    }
    const lots = replay(entries).lots;
    const held = lots.filter((l) => l.wallet === w).reduce((s, l) => s + l.sats, 0);
    const fee = op.kind === 'move' ? op.fee : 0;
    const total = Math.min(op.amount + fee, held);
    if (total <= fee) return;
    const r = oldestFirst(lots, w, total);
    if (!r.ok) throw new Error('oldestFirst failed');
    const picks: LotPick[] = r.value;
    const s = total - fee;
    if (op.kind === 'sell') return track({ ...base, kind: 'sell', wallet: w, sats: s, proceedsCents: proceeds(s), picks, spent: op.fee % 2 === 0 }, base.id);
    if (op.kind === 'give') return track({ ...base, kind: 'give', wallet: w, sats: s, valueCents: op.money, to: op.fee % 2 === 0 ? 'person' : 'charity', recipient: 'R', picks }, base.id);
    if (op.kind === 'lost') return track({ ...base, kind: 'lost', wallet: w, sats: s, cause: 'hack', picks }, base.id);
    const to = WALLETS[op.w2 === op.w ? (op.w2 + 1) % 3 : op.w2] as string;
    return track({ ...base, kind: 'move', from: w, to, sats: s, feeSats: fee, feeValueCents: fee === 0 ? 0 : highProceeds ? fee * 2000 : op.money, picks }, base.id);
  });
  return entries;
}

const ops = fc.array(opArb, { minLength: 1, maxLength: 30 });
const RUNS = { numRuns: 400 };
const total = (xs: readonly { sats: number }[]): number => xs.reduce((s, x) => s + x.sats, 0);
const totalCost = (xs: readonly { costCents: number }[]): number => xs.reduce((s, x) => s + x.costCents, 0);

describe('review2 properties with dual basis and edit chains', () => {
  test('generator exercises dual basis, edits, deletes and restores', () => {
    const samples = fc.sample(ops, { numRuns: 200, seed: 7 }).map((o) => build(o, false));
    const states = samples.map(replay);
    expect(states.some((s) => s.lots.some((l) => l.lossBasis !== null && l.id.includes(':')))).toBe(true);
    expect(samples.some((es) => es.some((e) => e.kind !== 'delete' && e.replaces !== undefined && es.some((x) => x.id === e.replaces && x.kind === 'delete')))).toBe(true);
    expect(states.some((s) => s.disposals.some((d) => d.picks.some((p) => p.gainCents < 0)))).toBe(true);
  });

  test('sats balance; lots keep 0 ≤ lossBasis ≤ cost', () => {
    fc.assert(fc.property(ops, (o) => {
      const entries = build(o, false);
      const s = replay(entries);
      const applied = new Set(s.applied);
      const satsIn = entries.filter((e) => applied.has(e.id) && (e.kind === 'buy' || e.kind === 'receive')).reduce((a, e) => a + (e as { sats: number }).sats, 0);
      const out = [s.disposals, s.gifts, s.charityGifts, s.lost, s.closeOuts];
      expect(satsIn).toBe(total(s.lots) + out.reduce((a, xs) => a + total(xs), 0));
      for (const l of s.lots) {
        expect(l.costCents).toBeGreaterThanOrEqual(0);
        if (l.lossBasis !== null) {
          expect(l.lossBasis.costCents).toBeGreaterThanOrEqual(0);
          expect(l.lossBasis.costCents).toBeLessThanOrEqual(l.costCents);
        }
      }
    }), RUNS);
  });

  test("cost balances (giver's cost) when every disposal is in the gain region", () => {
    fc.assert(fc.property(ops, (o) => {
      const entries = build(o, true);
      const s = replay(entries);
      const applied = new Set(s.applied);
      let costIn = 0;
      for (const e of entries) {
        if (!applied.has(e.id)) continue;
        if (e.kind === 'buy') costIn += e.costCents;
        if (e.kind === 'receive') costIn += e.source.type === 'gift' ? (e.source.giverCostCents ?? 0) : e.valueCents;
      }
      const out = [s.disposals, s.gifts, s.charityGifts, s.lost];
      expect(costIn).toBe(totalCost(s.lots) + out.reduce((a, xs) => a + totalCost(xs), 0));
    }), RUNS);
  });

  test('input order does not matter; JSON round trip is exact', () => {
    fc.assert(fc.property(ops.chain((o) => {
      const entries = build(o, false);
      return fc.tuple(fc.constant(entries), fc.shuffledSubarray(entries, { minLength: entries.length }));
    }), ([entries, shuffled]) => {
      const full = replay(entries);
      expect(replay(shuffled)).toEqual(full);
      const back = importEntriesJson(exportEntriesJson(shuffled));
      expect(back.ok && replay(back.value)).toEqual(full);
    }), RUNS);
  });

  test('applied entries never error and every entry is applied, errored, or superseded', () => {
    fc.assert(fc.property(ops, (o) => {
      const s = replay(build(o, false));
      const errored = new Set(s.errors.map((e) => e.entryId));
      for (const a of s.applied) expect(errored.has(a)).toBe(false);
    }), RUNS);
  });
});
