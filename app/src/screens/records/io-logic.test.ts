import { exportEntriesJson, exportOpeningLotsCsv, replay, createUuidV7, type Entry } from '@bitcoin-basis/engine';
import { describe, expect, it } from 'vitest';
import { buildDemoBook } from '../../demo/demo-data.ts';
import { chunk, guessWalletType, linkedRows, loanEntries, lotsTemplateCsv, newLoanNames, planWallets, previewImport, previewJson, previewLots, walletEntries, withoutBadRows } from './io-logic.ts';

const state = replay(buildDemoBook().entries);
const newId = createUuidV7();
const HEAD = 'wallet,acquired_utc,btc,sats,cost_usd,cost_per_btc,tier,origin';
const good = 'Strike,2021-03-15 15:00:00,0.01000000,1000000,300.00,30000.00,Documented,Email receipt';
const bad = 'Nowhere,2021-04-15 15:00:00,0.01000000,1000000,300.00,30000.00,Documented,Email receipt';

describe('guessWalletType', () => {
  it('calls names that sound like your own keys Self-custody', () => {
    for (const n of ['Cold storage (multisig)', 'My Vault', 'Hardware 2', 'Ledger Nano', 'Trezor', 'Coldcard', 'Self custody']) expect(guessWalletType(n)).toBe('self-custody');
  });
  it('calls everything else an Exchange', () => {
    for (const n of ['Strike', 'River', 'Coinbase']) expect(guessWalletType(n)).toBe('exchange');
  });
});

describe('planWallets', () => {
  const head = HEAD;
  const row = (w: string) => good.replace('Strike', w);
  it('counts new wallets once each, in file order, case and spacing ignored', () => {
    const p = planWallets(`${head}\n${row('Zeta')}\n${row('zeta ')}\n${row('Beta')}\n`, state.wallets);
    expect(p.created).toEqual([{ name: 'Zeta', coins: 2, retirementLike: false }, { name: 'Beta', coins: 1, retirementLike: false }]);
    expect(p.matched).toEqual([]);
  });
  it('keeps exact names as they are and says when a name only differs by case or spacing', () => {
    const name = (state.wallets[0] as { name: string }).name;
    const p = planWallets(`${head}\n${row(name)}\n${row(name.toUpperCase() === name ? name.toLowerCase() : name.toUpperCase())}\n`, state.wallets);
    expect(p.created).toEqual([]);
    expect(p.matched).toHaveLength(1);
    expect(p.matched[0]?.to).toBe(name.trim());
  });
});

describe('previewImport', () => {
  it('makes new wallets before the coins and totals the file', () => {
    const text = `${HEAD}\n${good.replace('Strike', 'Brand New')}\n${good.replace('Strike', 'Brand New')}\n${good.replace('Strike', 'Hardware vault')}\n`;
    const p = previewImport(text, state.wallets, 'America/Boise', newId, [2021]);
    expect(p.problems).toEqual([]);
    expect(p.newWallets.map((w) => [w.name, w.coins, w.guessedType])).toEqual([['Brand New', 2, 'exchange'], ['Hardware vault', 1, 'self-custody']]);
    expect(p.sats).toBe(3_000_000);
    expect(p.costCents).toBe(90_000);
    expect(p.tiers).toEqual({ documented: 3_000_000 });
    expect(p.closedYears).toEqual([2021]);
    const made = walletEntries(p.newWallets, { 'Brand New': 'self-custody' }, '2026-01-01T00:00:00Z', 'America/Boise');
    expect(made.map((w) => w.type)).toEqual(['self-custody', 'self-custody']);
    expect(made.every((w) => w.defaultProof === 'Email receipt')).toBe(true);
    const ids = new Set(made.map((w) => w.wallet));
    expect(p.entries.every((e) => ids.has(e.wallet))).toBe(true);
    expect((made[0]?.id ?? '') < (p.entries[0]?.id ?? '')).toBe(true);
  });
});

describe('chunk', () => {
  it('splits a list into batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('previewLots', () => {
  it('accepts a clean file', () => {
    const p = previewLots(`${HEAD}\n${good}\n`, state.wallets, 'America/Boise', newId);
    expect(p.problems).toEqual([]);
    expect(p.entries).toHaveLength(1);
  });
  it('lists each bad row and counts the good ones', () => {
    const p = previewLots(`${HEAD}\n${good}\n${bad}\n${good}\n`, state.wallets, 'America/Boise', newId);
    expect(p.entries).toEqual([]);
    expect(p.problems).toEqual([{ row: 3, message: 'no wallet named "Nowhere"' }]);
    expect(p.goodRows).toBe(2);
  });
  it('can drop the bad rows and import the rest', () => {
    const text = `${HEAD}\n${good}\n${bad}\n${good}\n`;
    const p = previewLots(text, state.wallets, 'America/Boise', newId);
    const again = previewLots(withoutBadRows(text, p.problems), state.wallets, 'America/Boise', newId);
    expect(again.problems).toEqual([]);
    expect(again.entries).toHaveLength(2);
  });
  it('reports a missing header column once', () => {
    const p = previewLots('wallet,sats\nStrike,1\n', state.wallets, 'America/Boise', newId);
    expect(p.problems).toHaveLength(1);
    expect(p.goodRows).toBe(0);
  });
  it('round-trips the book\'s own export', () => {
    const csv = exportOpeningLotsCsv(state).csv;
    expect(previewLots(csv, state.wallets, 'America/Boise', newId, state.loans).problems).toEqual([]);
  });
});

describe('previewJson', () => {
  it('separates new entries from ones already in the book', () => {
    const entries = buildDemoBook().entries;
    const text = exportEntriesJson(entries);
    const half = new Set(entries.slice(0, 10).map((e) => e.id));
    const p = previewJson(text, half);
    expect(p.entries).toHaveLength(entries.length);
    expect(p.fresh).toHaveLength(entries.length - 10);
  });
  it('explains a file that is not ours', () => {
    expect(previewJson('{"a":1}', new Set()).problems[0]?.message).toMatch(/not a Bitcoin Basis/);
    expect(previewJson('nope', new Set()).problems[0]?.index).toBeNull();
  });
});

describe('lotsTemplateCsv', () => {
  it('has the importer columns and an example row that imports cleanly', () => {
    const csv = lotsTemplateCsv('Strike', 'America/Boise');
    expect(csv.split(/\r?\n/)[0]).toBe(`${HEAD},tz`);
    const p = previewLots(csv, state.wallets, 'America/Boise', newId);
    expect(p.problems).toEqual([]);
    expect(p.entries).toHaveLength(1);
  });
});

describe('funded_by: purchases paid with a loan', () => {
  const FHEAD = `${HEAD},funded_by`;
  it('plans a loan the book does not have yet and links its rows', () => {
    const p = previewImport(`${FHEAD}\n${good},HELOC\n${good.replace('2021-03-15', '2021-02-01')}, heloc \n${good},\n`, state.wallets, 'America/Boise', newId, [], state.loans);
    expect(p.problems).toEqual([]);
    expect(p.newLoans).toHaveLength(1);
    expect(p.newLoans[0]).toMatchObject({ name: 'HELOC', coins: 2, opened: '2021-02-01' });
    expect(p.links).toHaveLength(2);
    expect(p.links.every((l) => l.loan === p.newLoans[0]?.id)).toBe(true);
  });
  it('uses a loan the book already has (case ignored)', () => {
    const p = previewImport(`${FHEAD}\n${good},home EQUITY line\n`, state.wallets, 'America/Boise', newId, [], state.loans);
    expect(p.newLoans).toEqual([]);
    expect(p.links[0]?.loan).toBe('loan-home-equity');
  });
  it('makes the loan entries only once every new loan has a readable rate', () => {
    const p = previewImport(`${FHEAD}\n${good},HELOC\n`, state.wallets, 'America/Boise', newId, [], state.loans);
    expect(loanEntries(p.newLoans, {}, '2026-01-01T00:00:00Z', 'America/Boise')).toBeNull();
    expect(loanEntries(p.newLoans, { HELOC: 'abc' }, '2026-01-01T00:00:00Z', 'America/Boise')).toBeNull();
    const made = loanEntries(p.newLoans, { HELOC: '7.875' }, '2026-01-01T00:00:00Z', 'America/Boise');
    expect(made?.[0]).toMatchObject({ kind: 'loan', name: 'HELOC', aprMillionths: 78_750, opened: '2021-03-15' });
    // Saved together, the book takes it without problems.
    const after = replay([...buildDemoBook().entries, ...(made ?? []), ...p.entries, ...p.links]);
    expect(after.errors).toEqual([]);
    expect(after.loans.find((l) => l.name === 'HELOC')?.draws).toHaveLength(1);
  });
  it('lists only names that are new', () => {
    expect(newLoanNames(`${FHEAD}\n${good},HELOC\n${good},Heloc\n${good},Home equity line\n`, state.loans)).toEqual(['HELOC']);
    expect(newLoanNames(`${HEAD}\n${good}\n`, state.loans)).toEqual([]);
  });
});

describe('funded_by_id and split purchases', () => {
  const H = `${HEAD},funded_by,funded_by_id,funded_draw_usd,funded_draw_date,origin_id`;
  it('a known loan id is never a new loan, and rows of one purchase make one link', () => {
    const text = `${H}\n${good},Renamed,loan-home-equity,,,\n${good},HELOC,,,2021-03-01,P1\n${good},HELOC,,,,P1\n`;
    expect(newLoanNames(text, state.loans)).toEqual(['HELOC']);
    const p = previewImport(text, state.wallets, 'America/Boise', newId, [], state.loans);
    expect(p.problems).toEqual([]);
    expect(p.links).toHaveLength(2);
    expect(p.newLoans[0]).toMatchObject({ name: 'HELOC', coins: 2, opened: '2021-03-01' });
    expect(linkedRows(p.links)).toBe(3);
  });
});

describe('retirement rows', () => {
  it('a row for a retirement wallet you have becomes a retirement purchase, counted on its own', () => {
    const row = good.replace('Strike', 'Retirement account').replace(',Documented,', ',,');
    const p = previewImport(`${HEAD}\n${good}\n${row}\n`, state.wallets, 'America/Boise', newId, []);
    expect(p.problems).toEqual([]);
    expect(p.newWallets).toEqual([]);
    expect(p.entries).toHaveLength(1);
    expect(p.retirementBuys).toHaveLength(1);
    expect(p.goodRows).toBe(2);
    expect([p.sats, p.costCents, p.retirementSats, p.retirementCostCents]).toEqual([1_000_000, 30_000, 1_000_000, 30_000]);
  });
  it('the coins spreadsheet carries the retirement purchases back', () => {
    const p = previewImport(exportOpeningLotsCsv(state).csv, state.wallets, 'America/Boise', newId, state.closedYears, state.loans);
    expect(p.problems).toEqual([]);
    expect(p.retirementBuys.map((b) => b.sats)).toEqual(state.retirementBuys.map((b) => b.sats));
  });
});

describe('a new wallet whose rows are written as retirement purchases', () => {
  const ira = good.replace('Strike', 'Swan IRA').replace(',Documented,', ',,');
  const text = `${HEAD}\n${good}\n${ira}\n${ira.replace('2021-03-15', '2021-05-01')}\n`;
  it('is flagged as possibly retirement, and is never read as one until the person says so', () => {
    const p = previewImport(text, state.wallets, 'America/Boise', newId, []);
    expect(p.newWallets.map((w) => [w.name, w.retirementLike, w.guessedType])).toEqual([['Swan IRA', true, 'exchange']]);
    expect(p.retirementBuys).toEqual([]);
    expect(p.problems.map((x) => x.row)).toEqual([3, 4]);
    expect(p.problems[0]?.message).toContain('the tier is empty');
    expect(p.problems[0]?.message).toContain('Retirement wallet');
  });
  it('once named a retirement account, its rows become retirement purchases and the wallet is made as Retirement', () => {
    const p = previewImport(text, state.wallets, 'America/Boise', newId, [], [], ['Swan IRA']);
    expect(p.problems).toEqual([]);
    expect(p.entries).toHaveLength(1);
    expect(p.retirementBuys).toHaveLength(2);
    expect(p.retirementBuys.every((b) => b.wallet === p.newWallets[0]?.id)).toBe(true);
    expect(walletEntries(p.newWallets, { 'Swan IRA': 'retirement' }, '2026-01-01T00:00:00Z', 'UTC')[0]?.type).toBe('retirement');
  });
  it('a wallet with any tier or loan column filled in is never offered as retirement', () => {
    const mixed = `${HEAD}\n${good.replace('Strike', 'New Place')}\n${ira.replace('Swan IRA', 'New Place')}\n`;
    const p = previewImport(mixed, state.wallets, 'America/Boise', newId, [], [], ['New Place']);
    expect(p.newWallets[0]?.retirementLike).toBe(false);
    expect(p.retirementBuys).toEqual([]);
    expect(walletEntries(p.newWallets, { 'New Place': 'retirement' }, '2026-01-01T00:00:00Z', 'UTC')[0]?.type).toBe('exchange');
  });
});

describe('an import that stopped part way, then tried again or chosen again', () => {
  const FHEAD = `${HEAD},funded_by`;
  const row = (day: string, loan = '') => `${good.replace('Strike', 'Brand New').replace('2021-03-15', `2021-03-${day}`)},${loan}`;
  // Five rows: a new wallet and a new loan; two rows are identical (two buys the same second).
  const text = `${FHEAD}\n${row('01', 'HELOC')}\n${row('02')}\n${row('02')}\n${row('03', 'HELOC')}\n${row('04')}\n`;
  const base = buildDemoBook().entries;
  const bookOf = (entries: readonly Entry[]) => ({ entries, applied: replay(entries).applied });

  it('first time, nothing is skipped', () => {
    const p = previewImport(text, state.wallets, 'America/Boise', newId, [], state.loans, [], bookOf(base));
    expect(p.skipped).toBe(0);
    expect(p.entries).toHaveLength(5);
  });

  it('leaves out the rows already added, so nothing is added twice, and still links the loans', () => {
    const first = previewImport(text, state.wallets, 'America/Boise', newId, [], state.loans, [], bookOf(base));
    const made = [...(loanEntries(first.newLoans, { HELOC: '7' }, '2026-01-01T00:00:00Z', 'America/Boise') ?? []), ...walletEntries(first.newWallets, {}, '2026-01-01T00:00:00Z', 'America/Boise')];
    // The first batch (loan, wallet) and the first two lots were saved; then it failed. The links were never saved.
    const saved = [...base, ...made, ...first.entries.slice(0, 2)];
    const after = replay(saved);
    const again = previewImport(text, after.wallets, 'America/Boise', newId, [], after.loans, [], bookOf(saved));
    expect(again.problems).toEqual([]);
    expect(again.newWallets).toEqual([]);
    expect(again.newLoans).toEqual([]);
    expect(again.skipped).toBe(2);
    // One of the two identical rows was added; the other still is not.
    expect(again.entries.map((e) => e.acquiredAt.slice(0, 10))).toEqual(['2021-03-02', '2021-03-03', '2021-03-04']);
    // The link for the row already added points at the coins already in the book.
    expect(again.links.map((k) => k.lot)).toEqual([first.entries[0]?.id, again.entries[1]?.id]);
    const done = [...saved, ...again.entries, ...again.links];
    const book = replay(done);
    expect(book.errors).toEqual([]);
    expect(book.lots.filter((l) => l.wallet === first.newWallets[0]?.id)).toHaveLength(5);
    expect(book.loans.find((l) => l.name === 'HELOC')?.draws).toHaveLength(2);
    // Chosen once more: everything is there, links included.
    const third = previewImport(text, book.wallets, 'America/Boise', newId, [], book.loans, [], bookOf(done));
    expect([third.skipped, third.entries.length, third.links.length, third.newWallets.length, third.newLoans.length]).toEqual([5, 0, 0, 0, 0]);
  });

  it('retirement purchases already added are skipped too', () => {
    const ira = good.replace('Strike', 'Retirement account').replace(',Documented,', ',,');
    const first = previewImport(`${HEAD}\n${ira}\n${ira}\n`, state.wallets, 'America/Boise', newId, [], [], [], bookOf(base));
    const saved = [...base, ...first.retirementBuys.slice(0, 1)];
    const again = previewImport(`${HEAD}\n${ira}\n${ira}\n`, state.wallets, 'America/Boise', newId, [], [], [], bookOf(saved));
    expect([again.skipped, again.retirementBuys.length]).toEqual([1, 1]);
  });
});
