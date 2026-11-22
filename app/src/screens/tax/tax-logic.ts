import { lossesForYear } from '../../lib/losses.ts';
import { federalTableFor, localDate, taxForYear, yearOf, yearSummary, type Cents, type Term, type Entry, type LedgerState, type Netting, type Settings, type Wallet, stateChoiceFromSettings, giftsOverExclusion, type RecipientTotal, type YearSummary } from '@bitcoin-basis/engine';

/** Years worth choosing: any with activity or a closing, plus this year; newest first. */
export function yearsAvailable(state: LedgerState, today: string): number[] {
  const years = new Set<number>([yearOf(today), ...state.closedYears]);
  for (const list of [state.disposals, state.income, state.gifts, state.charityGifts, state.lost, state.closeOuts, state.recoveries, state.giftsReceived]) for (const i of list) years.add(i.year);
  return [...years].sort((a, b) => b - a);
}

/** The year to open on: last year until filing day (Apr 15), this year after that. */
export function defaultTaxYear(years: readonly number[], today: string): number {
  const thisYear = yearOf(today);
  const beforeFiling = today.slice(5) <= '04-15';
  if (beforeFiling && years.includes(thisYear - 1)) return thisYear - 1;
  return years.includes(thisYear) ? thisYear : (years[0] as number);
}

/** The year is over (its last day is before `today`), so it can be closed once filed. */
export function yearIsOver(year: number, today: string): boolean {
  return yearOf(today) > year;
}

/** `a`, `a and b`, `a, b and c`. */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What the "?" next to a fee-only Yes says. */
export const FEE_SALE_HELP =
  'Moving coins costs a network fee, paid in bitcoin. Paying with bitcoin, even a few sats, counts as selling them, so the year’s answer is Yes. The gain or loss is usually a few cents; it is listed with your sales.';

/** True when the only reason the year is Yes is network fees paid in BTC (a move with a fee). */
export function feeOnlyYes(s: YearSummary): boolean {
  return s.digitalAssetAnswer === 'yes' && s.disposals.length > 0 && s.disposals.every((d) => d.kind === 'fee') && s.income.length === 0 && s.gifts.length + s.charityGifts.length === 0 && s.closeOuts.length === 0 && s.recoveries.length === 0;
}

/** Why the Form 1040 digital-asset question is Yes or No, in plain words. */
export function answerReason(s: YearSummary): string {
  if (feeOnlyYes(s)) return 'Yes — paying a network fee in BTC counts as a tiny sale.';
  const sold = s.disposals.filter((d) => d.kind === 'sell').length;
  const spent = s.disposals.filter((d) => d.kind === 'spend').length;
  const fees = s.disposals.filter((d) => d.kind === 'fee').length;
  const reasons: string[] = [];
  if (sold > 0) reasons.push('sold coins');
  if (spent > 0) reasons.push('spent coins');
  if (fees > 0) reasons.push('paid network fees in BTC');
  if (s.income.length > 0) reasons.push('received promo or reward sats');
  if (s.gifts.length + s.charityGifts.length > 0) reasons.push('gave coins away');
  if (s.closeOuts.length > 0) reasons.push('closed out a frozen platform');
  if (s.recoveries.length > 0) reasons.push('got a payout from a closed platform');
  if (s.digitalAssetAnswer === 'no') return 'You only bought, moved or held coins this year, which does not make it Yes.';
  return `You ${joinWords(reasons)}. Buying and holding alone would be No.`;
}

export interface KindTotals {
  count: number;
  gainCents: Cents;
  stCents: Cents;
  ltCents: Cents;
  proceedsCents: Cents;
}

export function totalsByKind(s: YearSummary): { sales: KindTotals; spending: KindTotals; fees: KindTotals; other: KindTotals } {
  const blank = (): KindTotals => ({ count: 0, gainCents: 0, stCents: 0, ltCents: 0, proceedsCents: 0 });
  const out = { sales: blank(), spending: blank(), fees: blank(), other: blank() };
  for (const d of s.disposals) {
    const t = d.kind === 'sell' ? out.sales : d.kind === 'spend' ? out.spending : out.fees;
    t.count += 1;
    t.gainCents += d.gainCents;
    t.stCents += d.stGainCents;
    t.ltCents += d.ltGainCents;
    t.proceedsCents += d.proceedsCents;
  }
  for (const c of s.closeOuts) {
    out.other.count += 1;
    out.other.gainCents += c.gainCents;
    out.other.stCents += c.stGainCents;
    out.other.ltCents += c.ltGainCents;
  }
  for (const r of s.recoveries) {
    out.other.count += 1;
    out.other.gainCents += r.gainCents;
    out.other.stCents += r.stGainCents;
    out.other.ltCents += r.ltGainCents;
  }
  return out;
}

/** `short`, `long` or `both` from the holding periods actually used (a $0 gain keeps its real term). */
export function termWord(terms: readonly Term[]): 'short' | 'long' | 'both' {
  const short = terms.includes('short');
  const long = terms.includes('long');
  return short && long ? 'both' : long ? 'long' : 'short';
}

/** One line of the CPA summary's Form 8949 detail: a disposal, a frozen-platform close-out or a payout after one. */
export interface DetailRow {
  key: string;
  date: string;
  wallet: string;
  /** As in the 8949 CSV's kind column: `sell`, `spend`, `fee`, `close-out`, `recovery`. */
  kind: string;
  /** Null for a payout after a close-out (a gain on $0 basis, not coins disposed of). */
  sats: number | null;
  proceedsCents: Cents;
  costCents: Cents;
  gainCents: Cents;
  term: 'short' | 'long' | 'both';
}

/**
 * Everything the 8949 CSV lists for the year, one row per entry, oldest first: disposals, close-out losses (proceeds =
 * what was recovered by the loss date) and payouts after a close-out ($0 cost). The terms come from the lots' holding
 * periods, so a $0 gain says long or short as it is.
 */
export function form8949Detail(s: YearSummary): DetailRow[] {
  const rows: DetailRow[] = [
    ...s.disposals.map((d) => ({ key: d.entryId, date: d.date, wallet: d.wallet, kind: d.kind as string, sats: d.sats, proceedsCents: d.proceedsCents, costCents: d.costCents, gainCents: d.gainCents, term: termWord(d.picks.map((p) => p.term)) })),
    ...s.closeOuts.map((c) => ({ key: c.entryId, date: c.lossDate, wallet: c.wallet, kind: 'close-out', sats: c.sats, proceedsCents: c.recoveredCents, costCents: c.costCents, gainCents: c.gainCents, term: termWord(c.pieces.map((p) => p.term)) })),
    ...s.recoveries.map((r) => ({
      key: r.entryId,
      date: r.date,
      wallet: r.wallet,
      kind: 'recovery',
      sats: null,
      proceedsCents: r.gainCents,
      costCents: 0,
      gainCents: r.gainCents,
      term: termWord([...(r.stGainCents !== 0 ? ['short' as const] : []), ...(r.ltGainCents !== 0 || r.stGainCents === 0 ? ['long' as const] : [])]),
    })),
  ];
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface YearTaxView {
  /** Totals before losses from past years. */
  stCents: Cents;
  ltCents: Cents;
  carriedIn: { st: Cents; lt: Cents };
  netting: Netting;
  carryOut: { st: Cents; lt: Cents };
  limitCents: Cents;
  tableYear: number;
  fellBack: boolean;
  giftExclusionCents: Cents;
}

/**
 * ST and LT totals after losses from past years. The only ones the app knows are those in Settings, saved for one
 * year (the current year when no year was saved); other years show their own totals without them.
 */
export function yearTaxView(state: LedgerState, settings: Settings, year: number, today: string): YearTaxView {
  const s = yearSummary(state, year);
  const carriedIn = lossesForYear(settings, year, today);
  const r = taxForYear({ year, filingStatus: settings.filingStatus, wages: settings.wagesCents, st: s.stGainCents, lt: s.ltGainCents, carryforward: carriedIn, state: stateChoiceFromSettings(settings) });
  const { table, fellBack } = federalTableFor(year);
  return {
    stCents: s.stGainCents,
    ltCents: s.ltGainCents,
    carriedIn,
    netting: r.netting,
    carryOut: r.carryforwardOut,
    limitCents: r.assumptions.capitalLossLimit,
    tableYear: table.year,
    fellBack,
    giftExclusionCents: table.giftAnnualExclusion,
  };
}

export interface Form1099Row {
  wallet: Wallet;
  /** Sales and spending an exchange should report on a 1099-DA. */
  sales: number;
  proceedsCents: Cents;
  /** Gifts logged from this wallet: some exchanges report gifts sent to other users as sales. */
  gifts: number;
  giftValueCents: Cents;
  giftCostCents: Cents;
}

/**
 * Per exchange wallet with activity that year: what its 1099-DA should show, and the gifts that could show up as
 * "sales". Self-custody wallets are not listed (no broker form). `entries` lets a year with only purchases or moves
 * still count as activity.
 */
export function form1099Rows(state: LedgerState, year: number, entries: readonly Entry[] = []): Form1099Row[] {
  const touched = new Set<string>();
  // The tax year of an entry is its local date (as everywhere), not the UTC year of its instant.
  for (const e of entries) if ('wallet' in e && typeof e.wallet === 'string' && yearOf(localDate(e.at, e.tz)) === year) touched.add(e.wallet);
  const rows: Form1099Row[] = [];
  for (const w of state.wallets) {
    if (w.type !== 'exchange') continue;
    const sold = state.disposals.filter((d) => d.year === year && d.wallet === w.id && (d.kind === 'sell' || d.kind === 'spend'));
    const gifts = [...state.gifts, ...state.charityGifts].filter((g) => g.year === year && g.wallet === w.id);
    if (sold.length === 0 && gifts.length === 0 && !touched.has(w.id)) continue;
    rows.push({
      wallet: w,
      sales: sold.length,
      proceedsCents: sold.reduce((s, d) => s + d.proceedsCents, 0),
      gifts: gifts.length,
      giftValueCents: gifts.reduce((s, g) => s + g.valueCents, 0),
      giftCostCents: gifts.reduce((s, g) => s + g.costCents, 0),
    });
  }
  return rows;
}

/** Recipients of gifts over the yearly per-person limit. */
export function overExclusion(state: LedgerState, year: number): { over: RecipientTotal[]; limitCents: Cents } {
  const limitCents = federalTableFor(year).table.giftAnnualExclusion;
  return { over: giftsOverExclusion(state, year, limitCents), limitCents };
}

/** CPA flags (dual basis, lost coins, qualified appraisal) for entries in a year. */
export function flagsForYear(state: LedgerState, year: number): LedgerState['cpaFlags'] {
  const inYear = new Set<string>();
  for (const list of [state.lost, state.charityGifts, state.giftsReceived, state.gifts]) for (const i of list) if (i.year === year) inYear.add(i.entryId);
  return state.cpaFlags.filter((f) => inYear.has(f.entryId));
}

/** Entries that closed or unlocked years, newest first, for the history under "closed years". */
export function yearLockHistory(entries: readonly Entry[]): { id: string; year: number; kind: 'close-year' | 'unlock-year'; at: string; tz: string; reason: string | undefined }[] {
  return entries
    .flatMap((e) => (e.kind === 'close-year' || e.kind === 'unlock-year' ? [{ id: e.id, year: e.year, kind: e.kind, at: e.at, tz: e.tz, reason: e.reason }] : []))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** What closing `year` leaves for the next one, or null when there is nothing to carry or Settings already say so. */
export function nextYearLosses(state: LedgerState, settings: Settings, year: number, today: string): { st: Cents; lt: Cents } | null {
  const out = yearTaxView(state, settings, year, today).carryOut;
  if (out.st + out.lt === 0) return null;
  const next = settings.carryforwardByYear[String(year + 1)];
  const saved = next !== undefined && next.st === out.st && next.lt === out.lt;
  return saved ? null : out;
}
