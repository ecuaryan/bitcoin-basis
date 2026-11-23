import { loanSummary, replay, suggestLoanPayment, type Entry, type LoanPurchase } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_LOAN_ID, DEMO_TODAY } from '../demo/demo-data.ts';
import { describeEntry } from './describe-entry.ts';
import { buildItems, entryRows, kindGroup, NO_FILTER } from './entry-list.ts';
import { breakEvenWords, fundedRemoval, gaugeLeft, goneWords, loanTag, loanTagFor, loanTags, paymentNudge, planLinks, purchaseOptions, purchaseWorth, recordedBalanceOn, statementDayText, statementToCheck, type LinkPlan, type PurchaseOption } from './loans-view.ts';

const book = buildDemoBook();
const state = replay(book.entries);
const loan = state.loans.find((l) => l.id === DEMO_LOAN_ID);

describe('loan words', () => {
  it('tags a home equity line HELOC and anything else Loan', () => {
    expect(loanTag('HELOC')).toBe('HELOC');
    expect(loanTag('Home equity line')).toBe('HELOC');
    expect(loanTag('Margin loan')).toBe('Loan');
  });
  it('says how far the price is from break-even in the nearest whole percent', () => {
    expect(breakEvenWords(7_000_000, 10_000_000)).toBe('Price is 30% below break-even');
    expect(breakEvenWords(12_299_999, 10_000_000)).toBe('Price is 23% above break-even');
    expect(breakEvenWords(10_000_000, 10_000_000)).toBe('Price is at break-even');
    expect(breakEvenWords(10_049_999, 10_000_000)).toBe('Price is within 1% of break-even');
    expect(breakEvenWords(10_050_000, 10_000_000)).toBe('Price is 1% above break-even');
    // Short, for the loan card's gauge.
    expect(breakEvenWords(7_000_000, 10_000_000, false, true)).toBe('30% below');
    expect(breakEvenWords(12_299_999, 10_000_000, false, true)).toBe('23% above');
    expect(breakEvenWords(10_000_000, 10_000_000, false, true)).toBe('At break-even');
    expect(breakEvenWords(10_049_999, 10_000_000, false, true)).toBe('Within 1%');
    expect(breakEvenWords(7_000_000, 10_000_000, true, true)).not.toMatch(/\d/);
    expect(breakEvenWords(null, 10_000_000)).toBeNull();
    expect(breakEvenWords(10_000_000, null)).toBeNull();
    // Hide amounts: the percent hides (one fixed shape), the words stay.
    expect(breakEvenWords(7_000_000, 10_000_000, true)).toBe('Price is ••••••• below break-even');
    expect(breakEvenWords(12_299_999, 10_000_000, true)).toBe('Price is ••••••• above break-even');
    expect(breakEvenWords(10_049_999, 10_000_000, true)).toBe('Price is within ••••••• of break-even');
    expect(breakEvenWords(10_000_000, 10_000_000, true)).toBe('Price is at break-even');
  });
  it('names the statement day', () => {
    expect(statementDayText(null)).toBe('Not set');
    expect(statementDayText(1)).toBe('The 1st');
    expect(statementDayText(12)).toBe('The 12th');
    expect(statementDayText(22)).toBe('The 22nd');
    expect(statementDayText(23)).toBe('The 23rd');
    expect(statementDayText(31)).toBe('Last day of the month');
  });
});

describe('the demo loan', () => {
  it('replays without problems and matches its statement', () => {
    expect(state.errors).toEqual([]);
    const s = loanSummary(state, DEMO_LOAN_ID, book.priceCents, DEMO_TODAY);
    expect(s?.purchaseCount).toBe(4);
    expect(s?.statements.every((x) => x.matches)).toBe(true);
    expect(s?.interestPaidCents).toBeGreaterThan(0);
  });
  it('tags its four purchases, and a moved piece by the purchase it came from', () => {
    const tags = loanTags(state);
    expect(tags.size).toBe(4);
    const [lot] = [...tags.keys()];
    expect(loanTagFor(state, `M9:${lot}`)).toEqual({ loanId: DEMO_LOAN_ID, name: 'Home equity line', tag: 'HELOC' });
    expect(loanTagFor(state, 'nothing')).toBeNull();
  });
  it('is paid up on the demo day, so there is no reminder', () => {
    expect(paymentNudge(state, DEMO_TODAY)).toBeNull();
  });
  it('asks for the November payment once November’s statement has closed', () => {
    const n = paymentNudge(state, '2026-12-03');
    expect(n?.cycleEnd).toBe('2026-11-30');
    expect(n?.interestCents).toBe(suggestLoanPayment(state, DEMO_LOAN_ID, '2026-12-03')?.interestCents);
  });
  it('checks the latest statement against what the records say was owed then', () => {
    if (loan === undefined) throw new Error('no demo loan');
    const ask = statementToCheck(state, loan, DEMO_TODAY);
    expect(ask.date).toBe('2026-10-31');
    expect(ask.owedCents).toBe(loanSummary(state, DEMO_LOAN_ID, null, '2026-10-31')?.principalOwedCents);
  });
});

describe('purchases to link', () => {
  const options = purchaseOptions(book.entries, state);
  it('lists every purchase and imported lot, newest first, with its loan', () => {
    expect(options.length).toBe(book.entries.filter((e) => e.kind === 'buy' || e.kind === 'opening-lot').length);
    expect(options.filter((o) => o.loanId === DEMO_LOAN_ID)).toHaveLength(4);
    for (let i = 1; i < options.length; i++) expect((options[i - 1] as PurchaseOption).date >= (options[i] as PurchaseOption).date).toBe(true);
  });
  it('plans new links, removals and changed draw dates', () => {
    const mine = options.filter((o) => o.loanId === DEMO_LOAN_ID);
    const [a, b] = mine as [PurchaseOption, PurchaseOption];
    const free = options.find((o) => o.loanId === null) as PurchaseOption;
    const chosen = new Map<string, string | null>([
      [a.lotId, null],
      [b.lotId, '2025-01-02'],
      [free.lotId, null],
    ]);
    const plan = planLinks(DEMO_LOAN_ID, options, chosen);
    expect(plan.add).toEqual([{ lot: free.lotId }]);
    expect(plan.change).toEqual([{ entryId: b.linkEntryId, lot: b.lotId, drawDate: '2025-01-02' }]);
    expect(plan.remove).toHaveLength(2);
  });
  it('plans nothing when nothing changed', () => {
    const chosen = new Map(options.filter((o) => o.loanId === DEMO_LOAN_ID).map((o) => [o.lotId, null] as const));
    expect(planLinks(DEMO_LOAN_ID, options, chosen)).toEqual({ add: [], remove: [], change: [] });
  });
});

describe('a purchase as worth-now', () => {
  it('uses the engine figures and the nearest whole percent', () => {
    const base = { heldSats: 1, heldCostCents: 30_000, valueCents: 10_000 };
    expect(purchaseWorth({ ...base, upDownCents: -20_000 } as never).percent).toBe(-67);
    expect(purchaseWorth({ ...base, upDownCents: 3_299 } as never).percent).toBe(11);
    expect(purchaseWorth({ ...base, valueCents: null, upDownCents: null } as never).percent).toBeNull();
  });
});

describe('loan records in entry lists', () => {
  const items = buildItems(book.entries);
  const wallets = new Map(state.wallets.map((w) => [w.id, w]));
  it('hides loan records unless the list is filtered to Loan', () => {
    const all = entryRows(items, NO_FILTER, wallets);
    expect(all.some((r) => kindGroup(r.item.current.kind) === 'loans')).toBe(false);
    const loans = entryRows(items, { ...NO_FILTER, group: 'loans' }, wallets);
    expect(loans.length).toBe(book.entries.filter((e) => e.kind.startsWith('loan')).length);
  });
  it('words loan records with the loan’s name', () => {
    const names = new Map([[DEMO_LOAN_ID, 'Home equity line']]);
    const pay = book.entries.find((e) => e.kind === 'loan-payment') as Entry;
    expect(describeEntry(pay, wallets, names).detail).toBe('Home equity line');
    const rate = book.entries.find((e) => e.kind === 'loan-update') as Entry;
    expect(describeEntry(rate, wallets, names).title).toBe('Rate changed');
  });
});

describe('where a loan\'s Bitcoin went', () => {
  const piece = (kind: LoanPurchase['gone'][number]['kind'], sats: number) => ({ kind, entryId: 'e', date: '2026-01-01', lotId: 'l', sats, costCents: 0, proceedsCents: 0 });
  const p = (gone: ReturnType<typeof piece>[]) => ({ gone }) as unknown as LoanPurchase;
  it('names only the ways it left, most first, with the total', () => {
    expect(goneWords([p([piece('given', 300_000), piece('fees', 1_000)]), p([piece('sold', 70_000), piece('spent', 5_981), piece('given', 1_000)])])).toEqual({
      sats: 377_981,
      words: 'later given away, sold, spent or paid as network fees',
    });
    expect(goneWords([p([piece('lost', 5)])])).toEqual({ sats: 5, words: 'later lost' });
    expect(goneWords([p([piece('closed-out', 5), piece('sold', 9)])])?.words).toBe('later sold or closed out on a frozen platform');
    expect(goneWords([p([])])).toBeNull();
  });
});

// ---- Fixes from an independent review (synthetic data) ----------------------------------------

const TZ = 'America/Boise';
const noon = (d: string) => `${d}T19:00:00Z`;
const ex: Entry = { id: 'w-ex', kind: 'wallet', at: '2015-01-01T00:00:00Z', tz: TZ, wallet: 'ex', name: 'Exchange', type: 'exchange', defaultProof: 'Email receipt' };
const heloc: Entry = { id: 'loan-h', kind: 'loan', at: noon('2024-01-01'), tz: TZ, loan: 'h', name: 'HELOC', opened: '2024-01-01', aprMillionths: 65_000 };
const row = (id: string, acquired: string): Entry => ({ id, kind: 'opening-lot', at: noon('2024-06-01'), tz: TZ, wallet: 'ex', acquiredAt: noon(acquired), sats: 10_000_000, costCents: 600_000, tier: 'documented', origin: 'Import' });
const buyOf = (id: string, date: string): Entry => ({ id, kind: 'buy', at: noon(date), tz: TZ, wallet: 'ex', sats: 10_000_000, costCents: 1_000_000, tier: 'documented' });

describe('a CSV purchase split over two rows is one link', () => {
  // One $12,000.00 purchase imported as two rows (L1 on Mar 1, L2 on Mar 3) sharing one link.
  const entries: Entry[] = [ex, heloc, row('L1', '2024-03-01'), row('L2', '2024-03-03'), { id: 'K', kind: 'loan-link', at: noon('2024-06-01'), tz: TZ, loan: 'h', lot: 'L1', alsoLots: ['L2'], drawCents: 1_200_000 }];
  const st = replay(entries);
  const options = purchaseOptions(entries, st);
  const both = new Map<string, string | null>([['L1', null], ['L2', null]]);
  it('knows both rows belong to the link, drawn from the earliest', () => {
    expect(options.map((o) => [o.lotId, o.linkLots, o.drawDefault])).toEqual([['L2', ['L1', 'L2'], '2024-03-01'], ['L1', ['L1', 'L2'], '2024-03-01']]);
    expect(planLinks('h', options, both)).toEqual({ add: [], remove: [], change: [] });
  });
  it('unticking one row keeps the link; unticking both removes it once', () => {
    expect(planLinks('h', options, new Map([['L1', null]]))).toEqual({ add: [], remove: [], change: [] });
    expect(planLinks('h', options, new Map())).toEqual({ add: [], remove: ['K'], change: [] });
  });
  it('a new draw date keeps the other row and the amount', () => {
    const plan = planLinks('h', options, new Map([['L1', '2024-02-15'], ['L2', '2024-02-15']]));
    expect(plan.change).toEqual([{ entryId: 'K', lot: 'L1', alsoLots: ['L2'], drawCents: 1_200_000, drawDate: '2024-02-15' }]);
    const { entryId, ...link } = plan.change[0] as LinkPlan['change'][number];
    const after = replay([...entries, { id: 'K2', kind: 'loan-link', at: noon('2024-06-01'), tz: TZ, loan: 'h', ...link, replaces: entryId, reason: 'Draw date changed' }]);
    expect(after.errors).toEqual([]);
    expect(loanSummary(after, 'h', null, '2024-06-01')?.drawnCents).toBe(1_200_000);
  });
});

describe('removing a loan-funded purchase', () => {
  // P1 and P2 linked at $10,000.00 each, $5,000.00 repaid.
  const entries: Entry[] = [
    ex,
    heloc,
    buyOf('P1', '2025-01-10'),
    buyOf('P2', '2025-01-20'),
    { id: 'K1', kind: 'loan-link', at: noon('2025-01-10'), tz: TZ, loan: 'h', lot: 'P1' },
    { id: 'K2', kind: 'loan-link', at: noon('2025-01-20'), tz: TZ, loan: 'h', lot: 'P2' },
    { id: 'Y', kind: 'loan-payment', at: noon('2025-03-01'), tz: TZ, loan: 'h', interestCents: 0, principalCents: 500_000 },
  ];
  const st = replay(entries);
  it('names the loan and the draw, and keeps what is owed', () => {
    const r = fundedRemoval(entries, st, 'P2');
    expect(r).toMatchObject({ loanId: 'h', loanName: 'HELOC', drawCents: 1_000_000, drawDate: '2025-01-20' });
    const removed: Entry[] = [{ id: 'Z', kind: 'delete', at: noon('2025-06-01'), tz: TZ, replaces: 'P2', reason: 'Typo' }, { ...(r?.keepLink as object), id: 'K2b' } as Entry];
    const after = replay([...entries, ...removed]);
    expect(after.errors).toEqual([]);
    expect(loanSummary(after, 'h', null, '2025-06-01')).toMatchObject({ principalOwedCents: 1_500_000, purchaseCount: 1, otherDrawsCents: 1_000_000 });
    expect(fundedRemoval(entries, st, 'nothing')).toBeNull();
  });
});

describe('the statement check after paying more than was drawn', () => {
  const entries: Entry[] = [ex, { ...heloc, statementDay: 31 } as Entry, buyOf('P1', '2025-01-10'), { id: 'K1', kind: 'loan-link', at: noon('2025-01-10'), tz: TZ, loan: 'h', lot: 'P1' }, { id: 'Y', kind: 'loan-payment', at: noon('2025-02-10'), tz: TZ, loan: 'h', interestCents: 0, principalCents: 1_010_000 }];
  const st = replay(entries);
  const l = st.loans[0] as NonNullable<(typeof st.loans)[number]>;
  it('asks about the balance the engine checks against: a $100.00 credit', () => {
    expect(statementToCheck(st, l, '2025-03-05')).toEqual({ date: '2025-02-28', owedCents: -10_000 });
  });
  it('a draw of the gap makes it match the engine', () => {
    // The statement shows $500.00 owed: the gap is $600.00 (not $500.00), and the engine then agrees.
    const gap = 50_000 - recordedBalanceOn(st, 'h', '2025-02-28');
    const after = replay([...entries, { id: 'D', kind: 'loan-draw', at: noon('2025-02-28'), tz: TZ, loan: 'h', cents: gap }, { id: 'T', kind: 'loan-statement', at: noon('2025-02-28'), tz: TZ, loan: 'h', balanceCents: 50_000 }]);
    expect(gap).toBe(60_000);
    expect(loanSummary(after, 'h', null, '2025-03-05')?.statements.map((s) => s.matches)).toEqual([true]);
  });
});

describe('gaugeLeft: where the price sits on the break-even gauge', () => {
  it('puts break-even in the middle and each percent away one percent of the width', () => {
    expect(gaugeLeft(10_000_000, 10_000_000)).toBe(50);
    expect(gaugeLeft(7_800_000, 10_000_000)).toBeCloseTo(28);
    expect(gaugeLeft(12_100_000, 10_000_000)).toBeCloseTo(71);
  });
  it('keeps the dot on the track far from break-even', () => {
    expect(gaugeLeft(1_000_000, 10_000_000)).toBe(4);
    expect(gaugeLeft(40_000_000, 10_000_000)).toBe(96);
  });
});
