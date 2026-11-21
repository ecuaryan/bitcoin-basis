/**
 * Synthetic demo book. Every name, date and amount here is invented: it exists so the screens
 * have something believable to show on first run and in tests. It is never real data.
 *
 * Integers only (sats and cents). A seeded generator keeps the book identical on every load.
 * The book is built to land on the figures in the approved Holdings design: 3.36672105 BTC across
 * Cold storage, Strike and River; an average cost of $41,250.18; 94% documented.
 */
import { createUuidV7, mulDivRoundHalfUp, oldestFirst, replay, SATS_PER_BTC, suggestLoanPayment, type BuyEntry, type Entry, type LedgerState, type LotPick, type Tier, type WalletId } from '@bitcoin-basis/engine';

export const DEMO_TODAY = '2026-11-20';
export const DEMO_PRICE_CENTS = 9_481_240;
/** The demo "yesterday" price, so the hero shows a 1.8% rise. */
export const DEMO_PREV_DAY_CENTS = mulDivRoundHalfUp(DEMO_PRICE_CENTS, 1000, 1018);
export const DEMO_AVERAGE_COST_CENTS_PER_BTC = 4_125_018;

export const W = {
  cold: 'wallet-cold',
  strike: 'wallet-strike',
  river: 'wallet-river',
  coinbase: 'wallet-coinbase',
  harbor: 'wallet-harbor',
  retirement: 'wallet-retirement',
} as const;

/** Final sats per (wallet, year acquired), straight from the design's year bars and wallet cards. */
const TARGET_CELLS: Readonly<Record<string, number>> = {
  [`${W.cold}:2022`]: 42_104_000,
  [`${W.cold}:2023`]: 118_018_000,
  [`${W.cold}:2024`]: 69_112_000,
  [`${W.cold}:2025`]: 31_769_422,
  [`${W.strike}:2025`]: 15_000_000,
  [`${W.strike}:2026`]: 46_882_140,
  [`${W.river}:2025`]: 10_533_578,
  [`${W.river}:2026`]: 3_252_965,
};
const LOT_TARGET = 186;

const DAY = 86_400_000;

// Stylized price curve (USD, whole dollars): invented, not market history.
const CURVE: readonly (readonly [string, number])[] = [
  ['2022-01-01', 40_000],
  ['2022-03-01', 39_000],
  ['2022-06-15', 21_000],
  ['2022-10-01', 19_000],
  ['2023-01-01', 17_000],
  ['2023-05-01', 27_000],
  ['2023-11-20', 33_000],
  ['2024-03-01', 41_000],
  ['2024-08-01', 47_000],
  ['2025-01-01', 52_000],
  ['2025-06-01', 60_000],
  ['2025-11-01', 68_000],
  ['2026-04-01', 78_000],
  ['2026-08-01', 86_000],
  ['2026-10-15', 91_000],
];
const CURVE_MS = CURVE.map(([d, usd]) => [Date.parse(`${d}T00:00:00Z`), usd * 100] as const);

const DEMO_TODAY_MS = Date.parse(`${DEMO_TODAY}T16:00:00Z`);

/** The curve itself at a time: straight-line steps between the curve points, then today's price. */
function demoCurveAt(ms: number): number {
  const pts = [...CURVE_MS, [DEMO_TODAY_MS, DEMO_PRICE_CENTS] as const];
  const first = pts[0] as readonly [number, number];
  if (ms <= first[0]) return first[1];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as readonly [number, number];
    const b = pts[i] as readonly [number, number];
    if (ms <= b[0]) return a[1] + mulDivRoundHalfUp(b[1] - a[1], ms - a[0], b[0] - a[0]);
  }
  return DEMO_PRICE_CENTS;
}

/** Demo price (cents per BTC) at a time, by straight-line steps between the curve points. */
export function demoPriceAt(ms: number): number {
  if (ms >= DEMO_TODAY_MS - DAY) return DEMO_PRICE_CENTS;
  // A little deterministic wobble (up to 6%) so the line looks like a market, not a ruler.
  const wobble = (Math.floor(ms / DAY) * 7919) % 121;
  return mulDivRoundHalfUp(demoCurveAt(ms), 970 + wobble, 1000);
}

/** A rally in the demo chart: up to this many permille above the curve, peaking on this day, over about two months. */
const RALLY_PEAK_MS = Date.parse('2026-09-24T00:00:00Z');
const RALLY_PERMILLE = 115;
const RALLY_HALF_WIDTH_DAYS = 32;
let walkCache: { start: number; steps: number[]; highs: number[] } | null = null;

/** A seeded, mean-reverting day-to-day drift (permille) from the curve's first day to the demo's today, and each day's intraday high. */
function demoWalk(): { start: number; steps: number[]; highs: number[] } {
  if (walkCache) return walkCache;
  const start = Math.floor((CURVE_MS[0] as readonly [number, number])[0] / DAY);
  const end = Math.floor(DEMO_TODAY_MS / DAY);
  const rand = mulberry32(2_100_000);
  const steps: number[] = [];
  const highs: number[] = [];
  let walk = 0;
  for (let d = start; d <= end; d++) {
    walk += Math.floor(rand() * 51) - 25 - Math.trunc(walk / 12);
    steps.push(walk);
    highs.push(4 + Math.floor(rand() * 22));
  }
  walkCache = { start, steps, highs };
  return walkCache;
}

/**
 * The demo chart's daily prices (cents per BTC) for the UTC day starting at `dayMs`: the curve, a rally in the
 * autumn of 2026, and day-to-day moves of a few percent, easing into today's price over the last two weeks.
 * Invented, like the rest of the demo. Integers only.
 */
export function demoDailyPrice(dayMs: number): { closeCents: number; highCents: number } {
  const day = Math.floor(dayMs / DAY);
  const toToday = Math.floor(DEMO_TODAY_MS / DAY) - day;
  if (toToday <= 0) return { closeCents: DEMO_PRICE_CENTS, highCents: mulDivRoundHalfUp(DEMO_PRICE_CENTS, 1006, 1000) };
  const w = demoWalk();
  const i = Math.min(w.steps.length - 1, Math.max(0, day - w.start));
  const ease = Math.min(14, toToday);
  const fromPeak = Math.abs(day - Math.floor(RALLY_PEAK_MS / DAY));
  const rally = fromPeak >= RALLY_HALF_WIDTH_DAYS ? 0 : mulDivRoundHalfUp(RALLY_PERMILLE, (RALLY_HALF_WIDTH_DAYS - fromPeak) ** 2, RALLY_HALF_WIDTH_DAYS ** 2);
  const permille = 1000 + mulDivRoundHalfUp((w.steps[i] as number) + rally, ease, 14);
  const closeCents = mulDivRoundHalfUp(demoCurveAt(day * DAY + DAY / 2), permille, 1000);
  return { closeCents, highCents: mulDivRoundHalfUp(closeCents, 1000 + (w.highs[i] as number), 1000) };
}

/** The demo chart's series: one point per UTC day for the `days` days ending on the day of `endMs`, oldest first. */
export function demoPriceSeries(endMs: number, days: number): { dayMs: number; closeCents: number; highCents: number }[] {
  const last = Math.floor(endMs / DAY) * DAY;
  return Array.from({ length: days }, (_, k) => {
    const dayMs = last - (days - 1 - k) * DAY;
    return { dayMs, ...demoDailyPrice(dayMs) };
  });
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (date: string, hour = 17): number => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 19) + 'Z';

type Base = { at: number; cell?: string };
type Draft =
  | (Base & { t: 'wallet'; wallet: WalletId; name: string; type: 'exchange' | 'self-custody' | 'retirement'; proof: string })
  | (Base & { t: 'update'; wallet: WalletId; archived: boolean })
  | (Base & { t: 'freeze'; wallet: WalletId })
  | (Base & { t: 'settings' })
  | (Base & { t: 'buy'; wallet: WalletId; sats: number; tier: Tier; cell?: string; costPinned?: number })
  | (Base & { t: 'opening'; wallet: WalletId; sats: number; tier: Tier; origin: string })
  | (Base & { t: 'payout'; wallet: WalletId; from: WalletId; sats: number; valueCents: number })
  | (Base & { t: 'income'; wallet: WalletId; sats: number; description: string })
  | (Base & { t: 'gift-in'; wallet: WalletId; sats: number; giverCostCents: number; giverAcquiredAt: string })
  | (Base & { t: 'move-all'; from: WalletId; to: WalletId; feeSats: number })
  | (Base & { t: 'sell-spent'; wallet: WalletId; sats: number; description: string })
  | (Base & { t: 'give'; wallet: WalletId; sats: number; recipient: string })
  | (Base & { t: 'confirm'; wallet: WalletId })
  | (Base & { t: 'snapshot'; wallet: WalletId; sats: number });

interface Counts {
  coinbase2022: number;
  coinbase2023: number;
  strike2024: number;
  strike2025a: number;
  strike2025b: number;
  strike2026: number;
}

/** Evenly spread times between two dates with a little deterministic wobble. */
function spread(from: string, to: string, n: number, rand: () => number): number[] {
  const a = at(from);
  const b = at(to);
  return Array.from({ length: n }, (_, i) => {
    const base = a + Math.floor(((b - a) * (i + 0.5)) / n);
    return base + Math.floor((rand() - 0.5) * DAY * 1.2);
  });
}

function drafts(counts: Counts, adj: Readonly<Record<string, number>>, rand: () => number): Draft[] {
  const out: Draft[] = [];
  const buys = (wallet: WalletId, from: string, to: string, n: number, total: number, cell: string, tier: Tier = 'documented') => {
    const times = spread(from, to, n, rand);
    // Uneven but deterministic sizes that add up to `total`.
    const weights = times.map(() => 60 + Math.floor(rand() * 80));
    const wsum = weights.reduce((s, x) => s + x, 0);
    let used = 0;
    times.forEach((t, i) => {
      const last = i === n - 1;
      const sats = last ? total - used : Math.floor((total * (weights[i] as number)) / wsum / 1000) * 1000;
      used += sats;
      out.push({ t: 'buy', at: t, wallet, sats: sats + (last ? (adj[cell] ?? 0) : 0), tier, ...(last ? { cell } : {}) });
    });
  };

  out.push(
    { t: 'wallet', at: at('2022-01-02', 9), wallet: W.coinbase, name: 'Coinbase', type: 'exchange', proof: 'Email receipt' },
    { t: 'wallet', at: at('2022-01-02', 9) + 1, wallet: W.harbor, name: 'Harbor Earn', type: 'exchange', proof: 'Email receipt' },
    { t: 'wallet', at: at('2022-01-02', 9) + 2, wallet: W.cold, name: 'Cold storage', type: 'self-custody', proof: 'Exchange receipt + wallet export' },
    { t: 'wallet', at: at('2022-01-02', 9) + 3, wallet: W.strike, name: 'Strike', type: 'exchange', proof: 'App history export' },
    { t: 'wallet', at: at('2022-01-02', 9) + 4, wallet: W.river, name: 'River', type: 'exchange', proof: 'Email receipt' },
    { t: 'wallet', at: at('2022-01-02', 9) + 5, wallet: W.retirement, name: 'Retirement account', type: 'retirement', proof: 'Quarterly statement' },
    { t: 'settings', at: at('2022-01-02', 10) },
  );

  // Harbor Earn: bought, then frozen in July 2022.
  out.push({ t: 'buy', at: at('2022-02-03'), wallet: W.harbor, sats: 50_000_000, tier: 'documented', costPinned: 2_000_000 });
  out.push({ t: 'freeze', at: at('2022-07-13', 15), wallet: W.harbor });

  // Coinbase, 2022 and 2023.
  buys(W.coinbase, '2022-03-01', '2022-12-20', counts.coinbase2022, 42_104_000 - 9_000_000 - 16_800_000, `${W.cold}:2022`);
  out.push({ t: 'opening', at: at('2022-05-14'), wallet: W.coinbase, sats: 9_000_000, tier: 'reconstructed', origin: 'Rebuilt from bank statements' });
  out.push({ t: 'payout', at: at('2022-10-05'), wallet: W.coinbase, from: W.harbor, sats: 16_800_000, valueCents: 320_000 });
  buys(W.coinbase, '2023-01-05', '2023-12-20', counts.coinbase2023, 118_018_000 - 6_000_000, `${W.cold}:2023`);
  out.push({ t: 'opening', at: at('2023-06-10'), wallet: W.coinbase, sats: 6_000_000, tier: 'reconstructed', origin: 'Rebuilt from bank statements' });
  out.push({ t: 'move-all', at: at('2024-01-15'), from: W.coinbase, to: W.cold, feeSats: 5_200 });
  out.push({ t: 'update', at: at('2024-01-16'), wallet: W.coinbase, archived: true });

  // Strike, 2024: bought through the year, then withdrawn to cold storage.
  buys(W.strike, '2024-01-08', '2025-01-02', counts.strike2024, 69_112_000 - 2_600_000, `${W.cold}:2024`);
  out.push({ t: 'buy', at: at('2024-05-09'), wallet: W.strike, sats: 2_600_000, tier: 'reconstructed' });
  out.push({ t: 'move-all', at: at('2025-01-08'), from: W.strike, to: W.cold, feeSats: 3_900 });
  // 2025, first half.
  buys(W.strike, '2025-01-15', '2025-06-25', counts.strike2025a, 31_769_422 - 2_600_000, `${W.cold}:2025`);
  out.push({ t: 'buy', at: at('2025-03-12'), wallet: W.strike, sats: 2_600_000, tier: 'reconstructed' });
  out.push({ t: 'move-all', at: at('2025-07-01'), from: W.strike, to: W.cold, feeSats: 4_400 });
  // 2025, second half, stays on Strike.
  buys(W.strike, '2025-07-08', '2025-12-28', counts.strike2025b, 15_000_000, `${W.strike}:2025`);
  // River.
  buys(W.river, '2025-05-02', '2025-12-18', 3, 10_533_578 - 1_000_000, `${W.river}:2025`);
  out.push({ t: 'gift-in', at: at('2025-08-20'), wallet: W.river, sats: 1_000_000, giverCostCents: 41_000, giverAcquiredAt: '2025-02-10T12:00:00Z' });
  buys(W.river, '2026-02-03', '2026-10-20', 4, 3_252_965, `${W.river}:2026`);
  // Strike, 2026.
  buys(W.strike, '2026-01-06', '2026-11-17', counts.strike2026, 46_882_140 - 55_000, `${W.strike}:2026`);
  out.push({ t: 'income', at: at('2026-05-05'), wallet: W.strike, sats: 55_000, description: 'Promo sats' });
  out.push({ t: 'give', at: at('2026-02-14'), wallet: W.strike, sats: 500_000, recipient: 'Sam' });
  out.push({ t: 'sell-spent', at: at('2026-03-10'), wallet: W.strike, sats: 150_000, description: 'Bike repair' });

  out.push({ t: 'snapshot', at: at('2025-12-31', 20), wallet: W.retirement, sats: 31_500_000 });
  out.push({ t: 'snapshot', at: at('2026-10-31', 20), wallet: W.retirement, sats: 35_000_000 });
  out.push({ t: 'confirm', at: at('2026-10-30', 18), wallet: W.river });
  out.push({ t: 'confirm', at: at('2026-11-02', 18), wallet: W.cold });
  out.push({ t: 'confirm', at: at('2026-11-20', 16), wallet: W.strike });
  return out.sort((a, b) => a.at - b.at);
}

interface Tuning {
  counts: Counts;
  /** Sat adjustment on each cell's last buy. */
  adj: Record<string, number>;
  /** Scale on raw buy costs, as a ratio. */
  costNum: number;
  costDen: number;
  /** Cents added to the final Strike buy so the average cost lands exactly. */
  costAdj: number;
}

function build(t: Tuning): Entry[] {
  const rand = mulberry32(20_261_120);
  const ds = drafts(t.counts, t.adj, rand);
  const tzOpt = { tz: 'America/Boise' } as const;
  const entries: Entry[] = [];
  let clock = 0;
  const nextId = createUuidV7({
    now: () => clock,
    random: (bytes) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
    },
  });
  const lastStrike2026 = ds.findLast((d) => d.t === 'buy' && d.wallet === W.strike && d.cell === `${W.strike}:2026`);
  const priceAtMs = (ms: number): number => demoPriceAt(ms);
  const value = (sats: number, ms: number): number => mulDivRoundHalfUp(sats, priceAtMs(ms), SATS_PER_BTC);
  const jitter = (ms: number): number => 985 + (Math.floor(ms / 3_600_000) % 31);
  const cost = (sats: number, ms: number): number => mulDivRoundHalfUp(mulDivRoundHalfUp(value(sats, ms), jitter(ms), 1000), t.costNum, t.costDen);

  for (const d of ds) {
    clock = d.at;
    const base = { id: nextId(), at: iso(d.at), ...tzOpt };
    switch (d.t) {
      case 'wallet':
        entries.push({ ...base, kind: 'wallet', wallet: d.wallet, name: d.name, type: d.type, defaultProof: d.proof });
        break;
      case 'update':
        entries.push({ ...base, kind: 'wallet-update', wallet: d.wallet, archived: d.archived });
        break;
      case 'freeze':
        entries.push({ ...base, kind: 'wallet-freeze', wallet: d.wallet, note: 'Withdrawals paused by the platform' });
        break;
      case 'settings':
        entries.push({
          ...base,
          kind: 'settings',
          patch: { filingStatus: 'married-joint', wagesCents: 13_000_000, state: { kind: 'flat', state: 'ID' }, carryforwardLtCents: 2_480_000, carryforwardYear: 2026 },
        });
        break;
      case 'buy': {
        const pinned = d.costPinned;
        const c = pinned ?? cost(d.sats, d.at) + (d === lastStrike2026 ? t.costAdj : 0);
        entries.push({ ...base, kind: 'buy', wallet: d.wallet, sats: d.sats, costCents: c, tier: d.tier });
        break;
      }
      case 'opening':
        entries.push({ ...base, kind: 'opening-lot', wallet: d.wallet, acquiredAt: iso(d.at), sats: d.sats, costCents: cost(d.sats, d.at), tier: d.tier, origin: d.origin });
        break;
      case 'payout':
        entries.push({ ...base, kind: 'receive', wallet: d.wallet, sats: d.sats, valueCents: d.valueCents, source: { type: 'frozen-payout', fromWallet: d.from }, note: 'Partial payout from Harbor Earn' });
        break;
      case 'income':
        entries.push({ ...base, kind: 'receive', wallet: d.wallet, sats: d.sats, valueCents: value(d.sats, d.at), source: { type: 'income', description: d.description } });
        break;
      case 'gift-in':
        entries.push({ ...base, kind: 'receive', wallet: d.wallet, sats: d.sats, valueCents: value(d.sats, d.at), source: { type: 'gift', giverCostCents: d.giverCostCents, giverAcquiredAt: d.giverAcquiredAt }, note: 'Birthday gift' });
        break;
      case 'move-all': {
        const state = replay(entries);
        const have = state.lots.filter((l) => l.wallet === d.from).reduce((s, l) => s + l.sats, 0);
        const picks = pick(state, d.from, have);
        entries.push({ ...base, kind: 'move', from: d.from, to: d.to, sats: have - d.feeSats, feeSats: d.feeSats, feeValueCents: value(d.feeSats, d.at), picks, note: 'Withdrawal to cold storage' });
        break;
      }
      case 'sell-spent': {
        const picks = pick(replay(entries), d.wallet, d.sats);
        entries.push({ ...base, kind: 'sell', wallet: d.wallet, sats: d.sats, proceedsCents: value(d.sats, d.at), picks, spent: true, description: d.description });
        break;
      }
      case 'give': {
        const picks = pick(replay(entries), d.wallet, d.sats);
        entries.push({ ...base, kind: 'give', wallet: d.wallet, sats: d.sats, valueCents: value(d.sats, d.at), to: 'person', recipient: d.recipient, picks });
        break;
      }
      case 'confirm': {
        const sats = replay(entries).lots.filter((l) => l.wallet === d.wallet).reduce((s, l) => s + l.sats, 0);
        entries.push({ ...base, kind: 'balance-confirm', wallet: d.wallet, sats });
        break;
      }
      case 'snapshot':
        entries.push({ ...base, kind: 'retirement-snapshot', wallet: d.wallet, sats: d.sats });
        break;
    }
  }
  return entries;
}

function pick(state: LedgerState, wallet: WalletId, sats: number): LotPick[] {
  const r = oldestFirst(state.lots, wallet, sats);
  if (!r.ok) throw new Error(`demo data: ${r.error.message}`);
  return r.value;
}

const FROZEN = new Set<string>([W.harbor]);

function measure(entries: readonly Entry[]): { cells: Map<string, number>; cost: number; sats: number; lots: number } {
  const state = replay(entries);
  const cells = new Map<string, number>();
  let cost = 0;
  let sats = 0;
  let lots = 0;
  for (const l of state.lots) {
    if (FROZEN.has(l.wallet)) continue;
    const key = `${l.wallet}:${l.acquiredDate.slice(0, 4)}`;
    cells.set(key, (cells.get(key) ?? 0) + l.sats);
    cost += l.costCents;
    sats += l.sats;
    lots += 1;
  }
  return { cells, cost, sats, lots };
}

/** The demo's loan: a made-up home equity line that paid for four Strike purchases in 2025. */
export const DEMO_LOAN_ID = 'loan-home-equity';

/**
 * A synthetic HELOC so the demo shows loan tracking: opened mid-2025, four purchases paid with it, two rate
 * cuts, interest-only payments on the 15th for the month before (one also pays some of it down) and a matching
 * statement. Interest is the engine's own estimate for each month, so the records and the statement agree.
 */
function demoLoan(coins: readonly Entry[]): Entry[] {
  const rand = mulberry32(20_250_701);
  let clock = 0;
  const nextId = createUuidV7({
    now: () => clock,
    random: (bytes) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
    },
  });
  const tz = 'America/Boise';
  const out: Entry[] = [];
  const add = (atMs: number, e: Record<string, unknown>): void => {
    clock = atMs;
    out.push({ id: nextId(), at: iso(atMs), tz, ...e } as unknown as Entry);
  };
  add(at('2025-07-01', 16), { kind: 'loan', loan: DEMO_LOAN_ID, name: 'Home equity line', opened: '2025-07-01', aprMillionths: 82_500, creditLimitCents: 1_000_000, statementDay: 31 });
  // The four largest Strike purchases from July to October 2025, oldest first.
  const picked = coins
    .filter((e): e is BuyEntry => e.kind === 'buy' && e.wallet === W.strike && e.at >= '2025-07-01' && e.at < '2025-11-01')
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 4)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  for (const b of picked) add(Date.parse(b.at) + 60_000, { kind: 'loan-link', loan: DEMO_LOAN_ID, lot: b.id });
  add(at('2025-09-18', 16), { kind: 'loan-update', loan: DEMO_LOAN_ID, aprMillionths: 80_000, rateFrom: '2025-09-18' });
  add(at('2025-12-11', 16), { kind: 'loan-update', loan: DEMO_LOAN_ID, aprMillionths: 77_500, rateFrom: '2025-12-11' });
  out.sort((a, b) => (a.at < b.at ? -1 : 1));
  for (let m = 0; m < 15; m++) {
    const month = 9 + m; // Sep 2025 to Nov 2026 (nothing was owed in July)
    const date = `${2025 + Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, '0')}-15`;
    const s = suggestLoanPayment(replay([...coins, ...out]), DEMO_LOAN_ID, date);
    const principalCents = date === '2026-04-15' ? 30_000 : 0;
    add(at(date), { kind: 'loan-payment', loan: DEMO_LOAN_ID, interestCents: s?.interestCents ?? 0, principalCents });
  }
  const owed = replay([...coins, ...out]).loans.find((l) => l.id === DEMO_LOAN_ID);
  const drawn = (owed?.draws ?? []).reduce((n, d) => n + d.cents, 0) - (owed?.payments ?? []).reduce((n, p) => n + p.principalCents, 0);
  add(at('2026-10-31', 20), { kind: 'loan-statement', loan: DEMO_LOAN_ID, balanceCents: drawn });
  return out;
}

/**
 * Three made-up purchases inside the demo's retirement account, so its page shows cost and gain. They add up to the
 * account's latest balance note (0.35 BTC on Oct 31, 2026), so the note matches.
 */
function demoRetirement(): Entry[] {
  const rand = mulberry32(20_220_210);
  let clock = 0;
  const nextId = createUuidV7({
    now: () => clock,
    random: (bytes) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
    },
  });
  const buys: readonly (readonly [string, number, number])[] = [
    ['2022-02-10', 15_000_000, 618_000],
    ['2024-01-18', 16_500_000, 693_000],
    ['2026-03-05', 3_500_000, 280_000],
  ];
  return buys.map(([date, sats, costCents]) => {
    clock = at(date, 15);
    return { id: nextId(), kind: 'retirement-buy', at: iso(clock), tz: 'America/Boise', wallet: W.retirement, sats, costCents, proof: 'Quarterly statement' };
  });
}

export interface DemoBook {
  entries: Entry[];
  /** `YYYY-MM-DD` the book was built to. */
  today: string;
  priceCents: number;
  prevDayPriceCents: number;
}

let cached: DemoBook | null = null;

/** The demo book. Deterministic; the first call solves the exact sat and cent totals (a few ms). */
export function buildDemoBook(): DemoBook {
  if (cached) return cached;
  const targetSats = Object.values(TARGET_CELLS).reduce((s, x) => s + x, 0);
  const targetCost = mulDivRoundHalfUp(DEMO_AVERAGE_COST_CENTS_PER_BTC, targetSats, SATS_PER_BTC);
  const tuning: Tuning = {
    counts: { coinbase2022: 12, coinbase2023: 36, strike2024: 52, strike2025a: 20, strike2025b: 24, strike2026: 30 },
    adj: {},
    costNum: 1000,
    costDen: 1000,
    costAdj: 0,
  };
  let entries = build(tuning);
  // Lot count: nudge the Strike 2026 purchase count to match the design.
  for (let i = 0; i < 40; i++) {
    const m = measure(entries);
    if (m.lots === LOT_TARGET) break;
    tuning.counts.strike2026 += LOT_TARGET - m.lots;
    entries = build(tuning);
  }
  // Scale all buy costs so the total is about right, then settle exact sats and cents.
  const first = measure(entries);
  tuning.costNum = targetCost;
  tuning.costDen = first.cost;
  entries = build(tuning);
  for (let i = 0; i < 12; i++) {
    const m = measure(entries);
    let clean = m.cost === targetCost;
    for (const [cell, want] of Object.entries(TARGET_CELLS)) {
      const d = (m.cells.get(cell) ?? 0) - want;
      if (d !== 0) {
        tuning.adj[cell] = (tuning.adj[cell] ?? 0) - d;
        clean = false;
      }
    }
    if (m.cost !== targetCost) tuning.costAdj += targetCost - m.cost;
    if (clean) break;
    entries = build(tuning);
  }
  entries = [...entries, ...demoLoan(entries), ...demoRetirement()];
  cached = { entries, today: DEMO_TODAY, priceCents: DEMO_PRICE_CENTS, prevDayPriceCents: DEMO_PREV_DAY_CENTS };
  return cached;
}
