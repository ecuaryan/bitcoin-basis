import { loanSummary, replay, suggestLoanPayment, type Entry, type LoanPurchase } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook, DEMO_LOAN_ID, DEMO_TODAY } from '../demo/demo-data.ts';
import { describeEntry } from './describe-entry.ts';
import { buildItems, entryRows, kindGroup, NO_FILTER } from './entry-list.ts';
import { breakEvenWords, goneWords, loanTag, loanTagFor, loanTags, paymentNudge, planLinks, purchaseOptions, purchaseWorth, statementDayText, statementToCheck, type PurchaseOption } from './loans-view.ts';

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
