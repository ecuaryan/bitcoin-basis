import { formatAprPercent, localDate, retirementPurchases, type Entry, type LedgerState, type Wallet } from '@bitcoin-basis/engine';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { usePrice } from '../data/price-provider.tsx';
import { loanTags, statementDayText } from '../lib/loans-view.ts';
import { LoanBadge } from './loans/loan-parts.tsx';
import { cx } from '../lib/cx.ts';
import { describeEntry, entryNoun } from '../lib/describe-entry.ts';
import { isRecheck, userEdited, type EntryItem, type EntryRun } from '../lib/entry-list.ts';
import { countOf, heldLabel, longDate, shortDate } from '../lib/format.ts';
import { TIER_LABEL } from '../lib/origin.ts';
import { entryWorth, type PartKind } from '../lib/worth-now.ts';
import { Amount, Money } from '../ui/Amount.tsx';
import { useLogSheet } from '../ui/AppShell.tsx';
import { Button } from '../ui/Button.tsx';
import { PencilIcon, TrashIcon } from '../ui/more-icons.tsx';
import { PlainMoney } from '../ui/plain-money.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { GainWords } from '../ui/WorthLine.tsx';
import { DELETABLE_KINDS, EDITABLE_KINDS, lockedYear } from './log/model.ts';

/** A small word next to an entry's title. Removed is the only thing that strikes the title through. */
function Badge({ tone, children }: { tone: 'soft' | 'loss' | 'amber'; children: ReactNode }) {
  return (
    <span className={cx('flex-none rounded-md bg-surface-2 px-1.5 py-px text-[11px] font-semibold leading-4', tone === 'loss' ? 'text-loss' : tone === 'amber' ? 'text-amber' : 'text-soft')}>
      {children}
    </span>
  );
}

function badgeFor(item: EntryItem): ReactNode {
  if (item.conflict) return <Badge tone="amber">Needs a decision</Badge>;
  if (item.deleted) return <Badge tone="loss">Removed</Badge>;
  if (userEdited(item)) return <Badge tone="soft">Edited</Badge>;
  return null;
}

/** One row in any list of entries (Records, a wallet). A button: it opens the entry with its history and actions. */
export function EntryRow({ run, wallets, onOpen, last }: { run: EntryRun; wallets: ReadonlyMap<string, Wallet>; today: string; onOpen(): void; last: boolean }) {
  const { item, count, net } = run;
  const { state } = useLedger();
  const e = item.current;
  const line = describeEntry(e, wallets, loanNames(state));
  const paidWith = (e.kind === 'buy' || e.kind === 'opening-lot') && !item.deleted ? loanTags(state).get(item.id) : undefined;
  return (
    <li className={cx(!last && 'border-b border-line')}>
      <button type="button" aria-haspopup="dialog" onClick={onOpen} className="flex min-h-[60px] w-full items-center gap-3 bg-transparent py-1.5 text-left text-text">
        <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-[11px] bg-accent/12 text-[15px] font-bold text-amber">
          {line.glyph}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <span className={cx('truncate', item.deleted && 'text-muted line-through')}>
              {line.title}
              {count > 1 ? ` ×${count}` : ''}
            </span>
            {paidWith ? <LoanBadge tag={paidWith.tag} /> : null}
            {badgeFor(item)}
          </span>
          <span className="text-xs text-muted [overflow-wrap:anywhere]">
            {net ?? line.detail} · {shortDate(localDate(e.at, e.tz))}
          </span>
        </span>
        <span className="flex flex-none flex-col items-end gap-0.5">
          <span className={cx('text-sm font-semibold', item.deleted && 'text-muted')}>
            {line.sats !== null ? (
              <>
                {line.sign}
                <Amount sats={line.sats} short interactive={false} />
              </>
            ) : line.cents !== null ? (
              <PlainMoney cents={line.cents} />
            ) : null}
          </span>
          {line.sats !== null && line.cents !== null ? (
            <span className="text-xs text-muted">
              <PlainMoney cents={line.cents} />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

const namesCache = new WeakMap<LedgerState, Map<string, string>>();
/** Loan id to name, worked out once per replayed state. */
function loanNames(state: LedgerState): Map<string, string> {
  let m = namesCache.get(state);
  if (m === undefined) {
    m = new Map(state.loans.map((l) => [l.id, l.name]));
    namesCache.set(state, m);
  }
  return m;
}

function facts(e: Entry, name: (id: string) => string, loan: (id: string) => string): [string, ReactNode][] {
  const coins = (label: string, sats: number): [string, ReactNode] => [label, <Amount key={label} sats={sats} showUnit interactive={false} />];
  const cash = (label: string, cents: number): [string, ReactNode] => [label, <Money key={label} cents={cents} />];
  switch (e.kind) {
    case 'buy':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Paid', e.costCents), ['Documentation', TIER_LABEL[e.tier]]];
    case 'receive':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Value that day', e.valueCents), ['Source', e.source.type]];
    case 'move':
      return [['From', name(e.from)], ['To', name(e.to)], coins('Coins arriving', e.sats), coins('Network fee', e.feeSats), ['Lots used', countOf(e.picks.length, 'lot')]];
    case 'sell':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash(e.spent ? 'Value spent' : 'Proceeds', e.proceedsCents), ['Lots used', countOf(e.picks.length, 'lot')], ...(e.description ? ([['What for', e.description]] as [string, ReactNode][]) : [])];
    case 'give':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Value that day', e.valueCents), ['To', `${e.recipient} (${e.to})`], ['Lots used', countOf(e.picks.length, 'lot')]];
    case 'lost':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), ['Cause', e.cause.replace('-', ' ')]];
    case 'retirement-buy':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Paid', e.costCents), ['Counts for tax', 'No, retirement']];
    case 'opening-lot':
      return [['Wallet', name(e.wallet)], coins('Coins', e.sats), cash('Cost', e.costCents), ['Documentation', TIER_LABEL[e.tier]], ['Where the record is', e.origin]];
    case 'balance-confirm':
    case 'retirement-snapshot':
      return [['Wallet', name(e.wallet)], coins('Balance', e.sats)];
    case 'giving-paid':
    case 'close-year':
    case 'unlock-year':
      return [['Year', String(e.year)]];
    case 'loan':
      return [['Loan', e.name], ['Rate', formatAprPercent(e.aprMillionths)], ['Started', longDate(e.opened)], ['Statement closing day', statementDayText(e.statementDay ?? null)], ...(e.creditLimitCents === undefined ? [] : [cash('Credit limit', e.creditLimitCents)])];
    case 'loan-update':
      return [
        ['Loan', loan(e.loan)],
        ...(e.name !== undefined ? ([['New name', e.name]] as [string, ReactNode][]) : []),
        ...(e.aprMillionths !== undefined ? ([['New rate', `${formatAprPercent(e.aprMillionths)}${e.rateFrom ? ` from ${longDate(e.rateFrom)}` : ''}`]] as [string, ReactNode][]) : []),
        ...(e.creditLimitCents !== undefined ? [cash('Credit limit', e.creditLimitCents)] : []),
        ...(e.statementDay !== undefined ? ([['Statement closing day', statementDayText(e.statementDay)]] as [string, ReactNode][]) : []),
        ...(e.closed !== undefined ? ([['Status', e.closed ? 'Closed' : 'Open']] as [string, ReactNode][]) : []),
      ];
    case 'loan-draw':
      return [['Loan', loan(e.loan)], cash('Drawn', e.cents)];
    case 'loan-link':
      return [['Loan', loan(e.loan)], ...(e.drawDate ? ([['Money drawn on', longDate(e.drawDate)]] as [string, ReactNode][]) : []), ...(e.drawCents !== undefined ? [cash('Drawn', e.drawCents)] : [])];
    case 'loan-payment':
      return [['Loan', loan(e.loan)], cash('Paid', e.interestCents + e.principalCents), cash('Interest part', e.interestCents), cash('Lowered what you owe by', e.principalCents)];
    case 'loan-statement':
      return [['Loan', loan(e.loan)], cash('Statement shows owed', e.balanceCents)];
    default:
      return 'wallet' in e ? [['Wallet', name(e.wallet)]] : [];
  }
}

const GONE_WORD: Record<PartKind, string> = { sold: 'sold', spent: 'spent', fees: 'paid in network fees', given: 'given away', lost: 'lost' };
const BOUGHT_KINDS = new Set(['buy', 'receive', 'opening-lot']);

/** What the coins from one buy or receive are worth now, wherever they moved to. */
function WorthBlock({ item, state }: { item: EntryItem; state: LedgerState; today: string }) {
  const { quote } = usePrice();
  const priceCents = quote?.usdCents ?? null;
  const w = useMemo(() => entryWorth(state, [item.id, ...item.versions.map((v) => v.id)], priceCents), [state, item, priceCents]);
  const none = w.held.sats === 0;
  const rows: [string, ReactNode][] = [
    ['Cost', <Money key="c" cents={w.held.costCents} />],
    ['Worth now', w.held.valueCents === null ? '—' : <Money key="v" cents={w.held.valueCents} />],
    ['Change', <GainWords key="g" worth={w.held} />],
  ];
  return (
    <section aria-label="What these coins are worth now" className="flex flex-col gap-2">
      <h2 className="m-0 text-[15px] font-semibold">What these coins are worth now</h2>
      {none ? (
        <p className="m-0 text-sm text-muted">None of these coins are left.</p>
      ) : (
        <>
          <p className="m-0 text-xs text-muted">
            <Amount sats={w.held.sats} showUnit interactive={false} /> still held, in any wallet.
          </p>
          <FactList rows={rows} />
        </>
      )}
      {w.gone.map((g, i) => (
        <p key={i} className="m-0 text-sm text-soft">
          <Amount sats={g.sats} showUnit interactive={false} /> of it {GONE_WORD[g.kind]} on {shortDate(g.date)}
        </p>
      ))}
    </section>
  );
}

/** A retirement purchase: what it cost, what it is worth now and how long it has been held. */
function RetirementWorthBlock({ item, state, today }: { item: EntryItem; state: LedgerState; today: string }) {
  const { quote } = usePrice();
  const priceCents = quote?.usdCents ?? null;
  const p = useMemo(() => retirementPurchases(state, null, priceCents, today).find((x) => x.id === item.id), [state, priceCents, today, item.id]);
  if (p === undefined) return null;
  const rows: [string, ReactNode][] = [
    ['Cost', <Money key="c" cents={p.costCents} />],
    ['Worth now', p.valueCents === null ? '—' : <Money key="v" cents={p.valueCents} />],
    ['Change', <GainWords key="g" worth={p} />],
    ['Held', heldLabel(p.heldDays).replace(/^Held /, '')],
  ];
  return (
    <section aria-label="What these coins are worth now" className="flex flex-col gap-2">
      <h2 className="m-0 text-[15px] font-semibold">What these coins are worth now</h2>
      <FactList rows={rows} />
    </section>
  );
}

function FactList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 flex flex-col rounded-2xl border border-line bg-bg px-4 py-1">
      {rows.map(([k, v], i) => (
        <div key={k} className={cx('flex min-h-11 items-center justify-between gap-4 text-sm', i < rows.length - 1 && 'border-b border-line')}>
          <dt className="text-soft">{k}</dt>
          <dd className="m-0 text-right font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Edit and Remove, named for what they act on. Each goes through a review that says what happens. */
function EntryActions({ run, state, onClose }: { run: EntryRun; state: LedgerState; onClose(): void }) {
  const { open } = useLogSheet();
  const { item, count } = run;
  const e = item.current;
  if (item.deleted || item.conflict) return null;
  const locked = lockedYear(e, state);
  if (locked !== null) return <p className="m-0 text-sm font-semibold text-amber">Locked: {locked} is closed. Unlock the year in Records to change this.</p>;
  const noun = entryNoun(e);
  const canEdit = count === 1 && EDITABLE_KINDS.has(e.kind);
  const canRemove = count === 1 && DELETABLE_KINDS.has(e.kind);
  if (!canEdit && !canRemove) return null;
  const go = (preset: Parameters<typeof open>[0]) => {
    onClose();
    open(preset);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit ? (
        <Button variant="secondary" onClick={() => go({ edit: e.id })}>
          <PencilIcon size={16} />
          Edit {noun}
        </Button>
      ) : null}
      {canRemove ? (
        <Button variant="danger" onClick={() => go({ remove: e.id })}>
          <TrashIcon size={16} />
          Remove this {noun}
        </Button>
      ) : null}
    </div>
  );
}

function versionLabel(v: Entry, n: number, total: number): string {
  if (v.kind === 'delete') return 'Removed';
  if (n === 1) return 'First entered';
  if (isRecheck(v)) return 'Checked again';
  return `Edited (version ${n} of ${total})`;
}

/** One entry (or a run of look-alikes): what it says, what its coins are worth now, its history, and Edit / Remove. */
export function EntrySheet({ run, state, today, onClose }: { run: EntryRun; state: LedgerState; today: string; onClose(): void }) {
  const { item, count } = run;
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const name = (id: string) => wallets.get(id)?.name ?? 'Unknown wallet';
  const loans = loanNames(state);
  const e = item.current;
  const line = describeEntry(e, wallets, loans);
  const paidWith = (e.kind === 'buy' || e.kind === 'opening-lot') && !item.deleted ? loanTags(state).get(item.id) : undefined;
  const rows: [string, ReactNode][] = [
    ['When', `${shortDate(localDate(e.at, e.tz))} · ${e.tz.replace('_', ' ')}`],
    ...facts(e, name, (id) => loans.get(id) ?? 'A loan'),
    ...(paidWith
      ? ([
          [
            'Paid with',
            <Link key="loan" to={`/loans/${paidWith.loanId}`} onClick={onClose} className="font-semibold">
              {paidWith.name}
            </Link>,
          ],
        ] as [string, ReactNode][])
      : []),
    ...(e.proof ? ([['Receipt', e.proof]] as [string, ReactNode][]) : []),
    ...(e.note ? ([['Note', e.note]] as [string, ReactNode][]) : []),
  ];
  const history = [...item.versions].reverse();
  const problems = state.errors.filter((x) => item.versions.some((v) => v.id === x.entryId));
  const title = item.deleted ? `${line.title} (removed)` : count > 1 ? `${line.title} ×${count}` : line.title;
  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="flex flex-col gap-4 pb-3">
        {item.deleted ? <p className="m-0 rounded-xl border border-line px-3 py-2 text-[13px] text-loss">Removed. It no longer counts in your totals; its history is kept below.</p> : null}
        {item.conflict && <p className="m-0 rounded-xl border border-accent px-3 py-2 text-[13px] text-amber">Two devices edited this entry. Neither applies until one is removed.</p>}
        {problems.map((p) => (
          <p key={p.entryId + p.code} className="m-0 rounded-xl border border-line px-3 py-2 text-[13px] text-loss">
            Not counted: {p.message}
          </p>
        ))}
        {run.net !== null ? <p className="m-0 text-sm text-soft">{countOf(count, 'change')} in a row: {run.net}.</p> : null}
        <FactList rows={rows} />
        {e.kind === 'give' && e.to === 'person' && !item.deleted ? (
          <Link to={`/gift-note/${e.id}`} onClick={onClose} className="w-fit text-sm font-semibold">
            Open the gift note
          </Link>
        ) : null}
        <EntryActions run={run} state={state} onClose={onClose} />
        {!item.deleted && BOUGHT_KINDS.has(e.kind) && <WorthBlock item={item} state={state} today={today} />}
        {!item.deleted && e.kind === 'retirement-buy' && <RetirementWorthBlock item={item} state={state} today={today} />}
        <section aria-label="History" className="flex flex-col gap-2">
          <h2 className="m-0 text-[15px] font-semibold">History</h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {history.map((v, i) => {
              const l = describeEntry(v, wallets, loans);
              const n = history.length - i;
              const isNow = v.id === e.id && !item.deleted && i === 0;
              return (
                <li key={v.id} className="flex flex-col gap-0.5 rounded-xl border border-line bg-bg px-3 py-2 text-sm">
                  <span className="flex items-center justify-between gap-3">
                    <span className={cx('font-semibold', v.kind === 'delete' && 'text-loss')}>
                      {versionLabel(v, n, history.length)}
                      {isNow && ' · now'}
                    </span>
                    <span className="text-xs text-muted">{shortDate(localDate(v.at, v.tz))}</span>
                  </span>
                  {v.kind !== 'delete' && (
                    <span className="text-xs text-soft">
                      {l.sats !== null && <Amount sats={l.sats} showUnit interactive={false} />}
                      {l.sats !== null && l.cents !== null && ' · '}
                      {l.cents !== null && <PlainMoney cents={l.cents} />}
                    </span>
                  )}
                  {v.reason && !isRecheck(v) && <span className="text-xs text-muted">Why: {v.reason}</span>}
                </li>
              );
            })}
          </ol>
          <p className="m-0 text-xs text-muted">Edits and removals are saved as new entries. The older versions are kept.</p>
        </section>
      </div>
    </Sheet>
  );
}
