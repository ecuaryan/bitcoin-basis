/**
 * Pure logic behind the Log sheet and the wallet screens: amount parsing, time zones, coin choice,
 * trial replays (what would happen if this entry were saved) and the plain-language tax effect.
 * Money stays integer cents and sats; nothing here touches the DOM.
 */
import {
  federalTableFor,
  formatBtc,
  formatCents,
  giftsOverExclusion,
  incrementalTax,
  lowestCostOrder,
  mulDivRoundHalfUp,
  oldestFirstOrder,
  parseBtc,
  parseDollars,
  picksFor,
  replay,
  SATS_PER_BTC,
  taxContext,
  taxInput,
  taxYear,
  type Entry,
  type LedgerState,
  type Lot,
  type LotPick,
  type Wallet,
} from '@bitcoin-basis/engine';
import { formatWhen } from '../../lib/format.ts';
import { hasLosses } from '../../lib/losses.ts';

// ---- Amounts ---------------------------------------------------------------------------

export type AmountUnit = 'btc' | 'sats' | 'usd';

/** Strip spaces, commas and a dollar sign; `.5` becomes `0.5`. */
export function cleanNumber(text: string): string {
  return text.replace(/[\s,$]/g, '').replace(/^\./, '0.');
}

/** Sats from what was typed in the chosen unit. USD needs a price (cents per BTC). Null when unreadable or zero-priced. */
export function parseAmount(text: string, unit: AmountUnit, priceCents: number | null): number | null {
  const t = cleanNumber(text);
  if (t === '') return null;
  if (unit === 'btc') return parseBtc(t);
  if (unit === 'sats') {
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (priceCents === null || priceCents <= 0) return null;
  const cents = parseDollars(t);
  return cents === null ? null : mulDivRoundHalfUp(cents, SATS_PER_BTC, priceCents);
}

/** Sats as text in a unit (used when switching units so the number stays the same amount). */
export function amountText(sats: number | null, unit: AmountUnit, priceCents: number | null): string {
  if (sats === null) return '';
  if (unit === 'btc') return formatBtc(sats);
  if (unit === 'sats') return String(sats);
  return priceCents === null || priceCents <= 0 ? '' : formatCents(mulDivRoundHalfUp(sats, priceCents, SATS_PER_BTC));
}

export function centsText(cents: number | null): string {
  return cents === null ? '' : formatCents(cents);
}

/** Value of sats at a price, in cents. */
export function valueOf(sats: number, priceCents: number): number {
  return mulDivRoundHalfUp(sats, priceCents, SATS_PER_BTC);
}

// ---- Time ------------------------------------------------------------------------------

const partFormatters = new Map<string, Intl.DateTimeFormat>();
function partsAt(tz: string, ms: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  let f = partFormatters.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    partFormatters.set(tz, f);
  }
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return { y: v['year'] ?? 1970, mo: v['month'] ?? 1, d: v['day'] ?? 1, h: v['hour'] ?? 0, mi: v['minute'] ?? 0, s: v['second'] ?? 0 };
}

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 19) + 'Z';
const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` on the clock in `tz` for a UTC instant (the value of a datetime-local box). */
export function localInputFor(instant: string, tz: string): string {
  const p = partsAt(tz, Date.parse(instant));
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** The UTC instant for a wall-clock `YYYY-MM-DDTHH:mm` in `tz`, or null if it is not a real time. */
export function zonedInstant(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (m === null) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(asUtc) || Number(m[1]) < 1970) return null;
  const offset = (ms: number): number => {
    const p = partsAt(tz, ms);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms;
  };
  let guess = asUtc - offset(asUtc);
  guess = asUtc - offset(guess);
  return iso(guess);
}

/** Noon on a calendar date in `tz` (for "date of death" and other date-only answers). */
export function noonOn(date: string, tz: string): string | null {
  return zonedInstant(`${date}T12:00`, tz);
}

export function nowInstant(nowMs: number): string {
  return iso(nowMs);
}

/** The day after a `YYYY-MM-DD` date. */
export function nextDay(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** `2026-11-02` as `Nov 2, 2026` (one definition, in lib/format). */
export { longDate } from '../../lib/format.ts';

// ---- Wallets ---------------------------------------------------------------------------

/** Wallets coins can be bought into, moved between and sold from (not retirement, not frozen; archived only if already chosen). */
export function usableWallets(state: LedgerState, keep?: string): Wallet[] {
  return state.wallets.filter((w) => w.id === keep || (w.type !== 'retirement' && !w.frozen && !w.archived));
}

/** The wallet used for the last entry of these kinds, else the first usable one. */
export function usualWallet(entries: readonly Entry[], state: LedgerState, kinds: readonly Entry['kind'][]): string {
  const usable = usableWallets(state);
  const ids = new Set(usable.map((w) => w.id));
  const applied = new Set(state.applied);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as Entry;
    if (!kinds.includes(e.kind) || !applied.has(e.id)) continue;
    const w = 'wallet' in e ? e.wallet : e.kind === 'move' ? e.to : undefined;
    if (w !== undefined && ids.has(w)) return w;
  }
  return (usable.find((w) => w.type === 'exchange') ?? usable[0])?.id ?? '';
}

// ---- Coin choice -----------------------------------------------------------------------

/** The wallet's coins that already existed at `at`, oldest first. */
export function lotsAvailable(state: LedgerState, entries: readonly Entry[], wallet: string, at: string): Lot[] {
  const madeAt = new Map(entries.map((e) => [e.id, e.at]));
  const t = Date.parse(at);
  const ok = state.lots.filter((l) => l.wallet === wallet && l.sats > 0 && Date.parse(madeAt.get(l.id.split(':')[0] as string) ?? l.acquiredAt) <= t);
  return oldestFirstOrder(ok, wallet);
}

/** The automatic orders: oldest first (sales, moves, losses) and lowest cost first (gifts). */
export type AutoOrder = 'oldest' | 'lowest-cost';
export type PickMode = AutoOrder | 'hand';

/**
 * Picks for `sats`: in the automatic order from everything, or in that same order from only the coins ticked
 * (`auto` says which order hand picks follow). Null if they fall short.
 */
export function choosePicks(available: readonly Lot[], sats: number | null, mode: PickMode, chosen: ReadonlySet<string>, auto: AutoOrder = 'oldest'): LotPick[] | null {
  if (sats === null || sats <= 0) return null;
  const pool = mode === 'hand' ? available.filter((l) => chosen.has(l.id)) : available;
  const order = mode === 'lowest-cost' || (mode === 'hand' && auto === 'lowest-cost') ? lowestCostOrder(pool, pool[0]?.wallet ?? '') : pool;
  const r = picksFor(order, sats);
  return r.ok ? r.value : null;
}

/** The saved picks when an edit still asks for exactly the same amount from exactly the same lots: never re-split them. */
export function keepSavedPicks(saved: readonly LotPick[] | undefined, savedSats: number | undefined, sats: number | null, mode: PickMode, chosen: ReadonlySet<string>): LotPick[] | null {
  if (saved === undefined || mode !== 'hand' || sats === null || sats !== savedSats) return null;
  const ids = new Set(saved.map((p) => p.lotId));
  return ids.size === chosen.size && [...chosen].every((id) => ids.has(id)) ? [...saved] : null;
}

// ---- Trial replay ----------------------------------------------------------------------

/** An entry and every older version it replaces. */
export function chainIds(entries: readonly Entry[], headId: string): Set<string> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out = new Set<string>();
  let cur = byId.get(headId);
  while (cur !== undefined && !out.has(cur.id)) {
    out.add(cur.id);
    cur = cur.replaces === undefined ? undefined : byId.get(cur.replaces);
  }
  return out;
}

export function friendlyProblem(code: string, message: string): string {
  switch (code) {
    case 'closed-year':
      return `${message.charAt(0).toUpperCase()}${message.slice(1)}. Unlock it in Records, then try again.`;
    case 'insufficient-sats':
      return 'The wallet does not hold enough coins at that time.';
    case 'unknown-lot':
    case 'wrong-wallet':
    case 'picks-sum-mismatch':
    case 'duplicate-pick':
    case 'invalid-amount':
      return 'The lots picked no longer fit. Pick them again.';
    case 'wallet-frozen':
      return 'That wallet is frozen. Coins cannot go in or out until it is closed out.';
    case 'retirement-wallet':
      return 'Retirement wallets are kept apart from tax math. Log their purchases on the wallet’s own page.';
    case 'not-retirement-wallet':
      return 'That wallet is not a retirement wallet.';
    case 'wallet-archived':
      return 'That wallet is archived. Bring it back from its options first.';
    default:
      return message;
  }
}

export interface Trial {
  /** The book without this entry (and, for an edit, without the version it replaces). */
  before: LedgerState;
  /** The book with it. */
  after: LedgerState;
  /** Why saving would not work, in plain words. Empty when it is fine. */
  problems: string[];
}

/** Replay the book with `add` appended and report what would break. `replacingId` is the entry an edit or delete targets. */
export function trialReplay(entries: readonly Entry[], current: LedgerState, add: readonly Entry[], replacingId?: string): Trial {
  const chain = replacingId === undefined ? new Set<string>() : chainIds(entries, replacingId);
  const before = replacingId === undefined ? current : replay(entries.filter((e) => !chain.has(e.id)));
  const after = replay([...entries, ...add]);
  const mine = new Set(add.map((e) => e.id));
  const known = new Set(current.errors.map((e) => `${e.entryId}:${e.code}`));
  const problems: string[] = [];
  for (const err of after.errors) {
    if (mine.has(err.entryId)) problems.push(friendlyProblem(err.code, err.message));
    // The engine decides what is refused. Lot ids stay the same across edits, so a later sale only breaks if its own picks no longer fit.
    else if (!known.has(`${err.entryId}:${err.code}`)) problems.push(`A later entry would stop working: ${err.message}`);
  }
  if (after.conflicts.length > current.conflicts.length) problems.push('Another copy of this entry was changed elsewhere. Resolve that first.');
  for (const e of add) if (e.kind !== 'delete' && !after.applied.includes(e.id) && problems.length === 0) problems.push('This entry could not be applied to your book.');
  return { before, after, problems: [...new Set(problems)] };
}

// ---- Tax effect ------------------------------------------------------------------------

export interface EffectLine {
  label: string;
  cents: number;
  /** Show with a plus or minus sign. */
  signed?: boolean;
}

export interface Effect {
  /** `none` = no tax now; `taxable` = a gain or loss; `income` = counts as income. */
  tone: 'none' | 'taxable' | 'income';
  headline: string;
  lines: EffectLine[];
  /** Estimated tax added (negative = saved), when it can be worked out. */
  taxCents: number | null;
  notes: string[];
  /** "Confirm with your CPA" items. */
  cpa: string[];
}

const NONE = (headline: string, notes: string[] = [], cpa: string[] = []): Effect => ({ tone: 'none', headline, lines: [], taxCents: null, notes, cpa });

function capitalTax(before: LedgerState, year: number, date: string, st: number, lt: number): number | null {
  try {
    const ctx = taxContext(before, before.settings, year, date);
    return incrementalTax(taxInput(ctx, 0, 0), taxInput(ctx, st, lt)).total;
  } catch {
    return null;
  }
}

function gainLines(st: number, lt: number): EffectLine[] {
  const lines: EffectLine[] = [];
  if (st !== 0) lines.push({ label: st < 0 ? 'Short-term loss' : 'Short-term gain', cents: st, signed: true });
  if (lt !== 0) lines.push({ label: lt < 0 ? 'Long-term loss' : 'Long-term gain', cents: lt, signed: true });
  if (lines.length === 0) lines.push({ label: 'Gain or loss', cents: 0 });
  return lines;
}

function laterPayoutNote(st: number, lt: number): string {
  if (st !== 0 && lt !== 0) return 'Any later payout counts as a gain with $0 cost, part short-term and part long-term, in the same proportions as this loss.';
  return `Any later payout counts as a ${lt !== 0 ? 'long' : 'short'}-term gain with $0 cost.`;
}

/** What saving `entry` does to taxes, read from the book replayed with it (`after`) and without it (`before`). */
export function computeEffect(entry: Entry, before: LedgerState, after: LedgerState): Effect {
  switch (entry.kind) {
    case 'buy':
      return NONE('No tax', ['Buying is not taxed. Your cost is saved so a later sale can be worked out.']);
    case 'receive': {
      const src = entry.source;
      if (src.type === 'income') {
        return { tone: 'income', headline: 'Counts as income', lines: [{ label: 'Income', cents: entry.valueCents }], taxCents: null, notes: ['Taxed as ordinary income at what it was worth when you got it. That value also becomes your cost for these coins.'], cpa: [] };
      }
      if (src.type === 'gift') {
        const gift = after.giftsReceived.find((g) => g.entryId === entry.id);
        return NONE(
          'No tax now',
          [gift?.costKnown ? "You take over the giver's cost and date." : "Without the giver's cost, your cost counts as $0 and the coins are marked Unknown. A sale would be taxed on the whole amount."],
          gift?.dualBasis ? ["The gift was worth less than the giver's cost (dual basis). Confirm with your CPA."] : [],
        );
      }
      if (src.type === 'inherited') return NONE('No tax now', ['Inherited coins take their value on the date of death as cost and always count as long-term.']);
      const rec = after.recoveries.find((r) => r.entryId === entry.id);
      if (rec !== undefined) {
        const tax = capitalTax(before, rec.year, rec.date, rec.stGainCents, rec.ltGainCents);
        return { tone: 'taxable', headline: 'Taxable gain', lines: gainLines(rec.stGainCents, rec.ltGainCents), taxCents: tax, notes: ['This wallet was already closed out, so the payout is a gain with $0 cost.'], cpa: [] };
      }
      return NONE('No tax yet', ['A payout counts toward what you got back. It lowers the loss you record when you close the wallet out.']);
    }
    case 'move': {
      const d = after.disposals.find((x) => x.entryId === entry.id);
      if (d === undefined) return NONE('No tax', ['Moving your own coins between your own wallets is not taxed.']);
      const tax = capitalTax(before, d.year, d.date, d.stGainCents, d.ltGainCents);
      return { tone: 'taxable', headline: 'Tiny taxable gain from the fee', lines: [{ label: 'Fee worth', cents: d.proceedsCents }, ...gainLines(d.stGainCents, d.ltGainCents)], taxCents: tax, notes: ['Moving is not taxed. Paying the network fee in Bitcoin counts as a very small sale.'], cpa: [] };
    }
    case 'sell': {
      const d = after.disposals.find((x) => x.entryId === entry.id);
      if (d === undefined) return NONE('No tax');
      const tax = capitalTax(before, d.year, d.date, d.stGainCents, d.ltGainCents);
      const head = d.gainCents < 0 ? 'Taxable loss' : 'Taxable gain';
      const covered = tax === 0 && d.gainCents > 0 && hasLosses(before.settings, d.year, d.date);
      return {
        tone: 'taxable',
        headline: entry.spent ? `${head} (spent)` : head,
        lines: [{ label: entry.spent ? 'Worth when spent' : 'Dollars received', cents: d.proceedsCents }, { label: 'Cost of these coins', cents: d.costCents }, ...gainLines(d.stGainCents, d.ltGainCents)],
        taxCents: tax,
        notes: covered ? ['Covered by losses from past years.'] : [],
        cpa: [],
      };
    }
    case 'give': {
      const gift = after.gifts.find((g) => g.entryId === entry.id);
      if (entry.to === 'person') {
        const year = taxYear(entry.at, entry.tz);
        const over = giftsOverExclusion(after, year, federalTableFor(year).table.giftAnnualExclusion).find((t) => t.recipient.trim().toLowerCase() === entry.recipient.trim().toLowerCase());
        return NONE(
          'No tax for you',
          [gift === undefined ? 'A gift is not a sale.' : 'A gift is not a sale. The person takes over your cost and dates, and the gift note shows them.'],
          over === undefined ? [] : [`Gifts to ${over.recipient} this year are over the yearly gift limit. A gift tax return may be needed. Confirm with your CPA.`],
        );
      }
      const c = after.charityGifts.find((g) => g.entryId === entry.id);
      const cpa = ['Held over a year, a gift to a charity counts at its value that day. Held a year or less, it counts at the lower of cost and value.'];
      if (c?.appraisalFlag === true) cpa.push('Charity gifts this year are over $5,000: a qualified appraisal is needed.');
      return { tone: 'none', headline: 'No gain or loss', lines: c === undefined ? [] : [{ label: 'Counts as a deduction, if you itemize', cents: c.deductionCents }], taxCents: null, notes: ['A gift to a charity is not a sale, so there is no gain to report.'], cpa: [...cpa, 'Confirm all of this with your CPA.'] };
    }
    case 'retirement-buy':
      return NONE('No tax', ['Retirement coins are kept apart. This purchase never changes a gain, a cost or a tax estimate.']);
    case 'lost':
      return NONE('No deduction recorded', ['The coins leave your holdings. No loss is counted.'], ['Ask your CPA whether any loss can be claimed, and keep notes on what happened.']);
    case 'wallet-close-out': {
      const c = after.closeOuts.find((x) => x.entryId === entry.id);
      if (c === undefined) return NONE('No tax');
      const tax = capitalTax(before, c.year, c.lossDate, c.stGainCents, c.ltGainCents);
      return {
        tone: 'taxable',
        headline: c.gainCents < 0 ? 'Capital loss' : 'Capital gain',
        lines: [{ label: 'Cost of the coins', cents: c.costCents }, { label: 'Paid back to you', cents: c.recoveredCents }, ...gainLines(c.stGainCents, c.ltGainCents)],
        taxCents: tax,
        notes: [`Recorded in ${c.year}, on the loss date. ${laterPayoutNote(c.stGainCents, c.ltGainCents)}`],
        cpa: ['The loss date and whether this is the right treatment depend on your situation. Confirm with your CPA.'],
      };
    }
    default:
      return NONE('No tax');
  }
}

/** Kinds that can be edited from a wallet's history. */
export const EDITABLE_KINDS: ReadonlySet<Entry['kind']> = new Set<Entry['kind']>(['buy', 'receive', 'move', 'sell', 'give', 'retirement-buy']);
/** Kinds that can be removed (balance confirmations are not listed, so they have no Remove; a loan itself is closed, not removed). */
export const DELETABLE_KINDS: ReadonlySet<Entry['kind']> = new Set<Entry['kind']>(['buy', 'receive', 'move', 'sell', 'give', 'lost', 'retirement-buy', 'loan-update', 'loan-draw', 'loan-link', 'loan-payment', 'loan-statement']);
const TAX_KINDS: ReadonlySet<Entry['kind']> = new Set<Entry['kind']>(['buy', 'receive', 'move', 'sell', 'give', 'lost', 'wallet-close-out']);

/** The closed year an entry sits in, or null if it can still be changed. */
export function lockedYear(e: Entry, state: LedgerState): number | null {
  if (!TAX_KINDS.has(e.kind)) return null;
  const y = taxYear(e.at, e.tz);
  return state.closedYears.includes(y) ? y : null;
}

/** `Today, 5:55 PM` or `Nov 20, 2025 · 5:55 PM` on the clock in `tz`. */
export function whenLabel(at: string, tz: string, nowMs: number = Date.now()): string {
  return formatWhen(at, nowMs, tz);
}
