import { localDate, type LedgerState, type Wallet } from '@bitcoin-basis/engine';
import { Fragment, type ReactNode } from 'react';
import { useLedger } from '../data/ledger-provider.tsx';
import { cx } from '../lib/cx.ts';
import { userEdited, type EntryItem, type EntryRun } from '../lib/entry-list.ts';
import { rowLine, type RowLine } from '../lib/entry-row.ts';
import { shortDate } from '../lib/format.ts';
import { loanTags } from '../lib/loans-view.ts';
import { Amount } from '../ui/Amount.tsx';
import { PlainMoney } from '../ui/plain-money.tsx';
import { LoanBadge } from './loans/loan-parts.tsx';
import { RetirementTag } from './purchase-table.tsx';

/**
 * Every list of entries (Records' recent and all entries, a wallet's Entries). The box is a container: under 34rem (every
 * phone) a row is glyph · title over `wallet · note · date` · Bitcoin over its dollars. From 34rem it is one table, every
 * row a subgrid so the columns line up: Date (month day over year) · What (glyph, title and tags over the note) · Wallet
 * (not on a wallet's own page) · Bitcoin (8 decimals, signed; a move's fee under it) · Dollars (over what they were).
 * DOM order is the reading order (title first), so each row's name reads "Bought, Strike, Nov 18, 2026, +0.0074 2665 BTC,
 * $680.00 paid"; the column headings are visual only.
 */

// Wide-only classes are spelled out in full (Tailwind finds classes by their literal text). `W` is the all-entries table
// (with a Wallet column), `P` a wallet's own page (without).
const W = {
  table: '@min-[34rem]:grid @min-[34rem]:grid-cols-[max-content_1.75rem_minmax(0,1.7fr)_minmax(0,1fr)_max-content_max-content]',
  btc: '@min-[34rem]:col-start-5',
  usd: '@min-[34rem]:col-start-6',
};
const P = {
  table: '@min-[34rem]:grid @min-[34rem]:grid-cols-[max-content_1.75rem_minmax(0,1fr)_max-content_max-content]',
  btc: '@min-[34rem]:col-start-4',
  usd: '@min-[34rem]:col-start-5',
};
const SUBGRID = '@min-[34rem]:col-span-full @min-[34rem]:grid @min-[34rem]:grid-cols-subgrid';
const WIDE_ONLY = 'hidden @min-[34rem]:inline';
const NARROW_ONLY = '@min-[34rem]:hidden';
const CELL = {
  date: 'whitespace-nowrap @min-[34rem]:col-start-1 @min-[34rem]:row-span-2 @min-[34rem]:row-start-1 @min-[34rem]:flex @min-[34rem]:flex-col @min-[34rem]:self-center @min-[34rem]:pr-6',
  glyph: '@min-[34rem]:col-start-2 @min-[34rem]:size-7 @min-[34rem]:rounded-[9px] @min-[34rem]:text-[13px]',
  title: '@min-[34rem]:col-start-3 @min-[34rem]:pl-2.5 @min-[34rem]:pr-6',
  note: '@min-[34rem]:col-start-3 @min-[34rem]:row-start-2 @min-[34rem]:self-start @min-[34rem]:pl-2.5 @min-[34rem]:pr-6',
  wallet: '@min-[34rem]:col-start-4 @min-[34rem]:row-span-2 @min-[34rem]:row-start-1 @min-[34rem]:self-center @min-[34rem]:pr-6 @min-[34rem]:text-sm @min-[34rem]:text-soft',
  num: '@min-[34rem]:row-span-2 @min-[34rem]:row-start-1 @min-[34rem]:self-center',
};

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

/** ` · ` between the parts of a phone row's second line; read (not shown) between the cells when wide. */
function Sep({ wide = true }: { wide?: boolean }) {
  return <span className={wide ? '@min-[34rem]:sr-only' : NARROW_ONLY}>{' · '}</span>;
}

/** BTC as a list shows it: all 8 decimals, always BTC (the dollars sit beside it), hidden with the amounts. */
function Btc({ sats }: { sats: number }) {
  return (
    <>
      <Amount sats={sats} interactive={false} alwaysBtc />
      <span className="sr-only"> BTC</span>
    </>
  );
}

function Wallets({ names }: { names: string[] }) {
  return (
    <>
      {names.map((n, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <>
              <span aria-hidden="true" className={WIDE_ONLY}>
                {' → '}
              </span>
              <span className="@min-[34rem]:sr-only"> to </span>
            </>
          ) : null}
          {n}
        </Fragment>
      ))}
    </>
  );
}

function Row({ run, line, paidWith, onOpen, cols, onWalletPage }: { run: EntryRun; line: RowLine; paidWith: ReactNode; onOpen(): void; cols: typeof W; onWalletPage: boolean }) {
  const { item, count, net } = run;
  const e = item.current;
  const removed = item.deleted;
  const [monthDay = '', year = ''] = shortDate(localDate(e.at, e.tz)).split(', ');
  const note = net ?? line.note;
  const hasNote = note !== '' || line.arrivedSats !== null;
  const noSats = line.sats === null;
  return (
    <li className={cx('border-b border-line last:border-b-0', SUBGRID)}>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
        className={cx(
          'relative grid min-h-[60px] w-full grid-cols-[2.25rem_minmax(0,1fr)_max-content] content-center gap-x-3 gap-y-0.5 bg-transparent py-1.5 text-left text-text',
          SUBGRID,
          '@min-[34rem]:min-h-[58px] @min-[34rem]:gap-x-0 @min-[34rem]:py-2',
        )}
      >
        <span aria-hidden="true" className={cx('col-start-1 row-span-2 row-start-1 flex size-9 items-center justify-center self-center rounded-[11px] bg-accent/12 text-[15px] font-bold text-amber', CELL.glyph)}>
          {line.glyph}
        </span>
        <span className={cx('col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold', CELL.title, hasNote ? '@min-[34rem]:self-end' : '@min-[34rem]:row-span-2 @min-[34rem]:self-center')}>
          <span className={cx('[overflow-wrap:anywhere]', removed && 'text-muted line-through')}>
            {line.title}
            {count > 1 ? ` ×${count}` : ''}
          </span>
          {paidWith}
          {line.retirement ? <RetirementTag /> : null}
          {badgeFor(item)}
        </span>
        {/* One line on a phone; when wide its parts move to their own columns. */}
        <span className="col-start-2 row-start-2 text-xs text-muted [overflow-wrap:anywhere] @min-[34rem]:contents">
          <span className="sr-only">, </span>
          {line.wallets.length > 0 ? (
            <>
              <span className={cx(CELL.wallet, onWalletPage && '@min-[34rem]:hidden')}>
                <Wallets names={line.wallets} />
              </span>
              <Sep wide={!onWalletPage} />
            </>
          ) : onWalletPage ? null : (
            <span aria-hidden="true" className={cx(WIDE_ONLY, CELL.wallet, 'text-muted')}>
              —
            </span>
          )}
          {hasNote ? (
            <>
              <span className={CELL.note}>
                {line.arrivedSats !== null ? (
                  <>
                    <Btc sats={line.arrivedSats} /> arrived
                    {line.feeSats !== null ? (
                      <>
                        {' · fee '}
                        <Btc sats={line.feeSats} />
                      </>
                    ) : null}
                    {note !== '' ? ` · ${note}` : ''}
                  </>
                ) : (
                  note
                )}
              </span>
              <Sep />
            </>
          ) : null}
          <span className={CELL.date}>
            <span className="@min-[34rem]:text-sm @min-[34rem]:font-semibold @min-[34rem]:text-text">{monthDay}</span>
            <span className="@min-[34rem]:sr-only">, </span>
            <span className="@min-[34rem]:text-xs @min-[34rem]:text-muted">{year}</span>
          </span>
        </span>
        <span className="col-start-3 row-span-2 row-start-1 flex flex-col items-end gap-0.5 self-center @min-[34rem]:contents">
          <span className={cx(noSats ? 'hidden @min-[34rem]:flex' : 'flex', 'flex-col items-end', cols.btc, CELL.num, '@min-[34rem]:pl-6')}>
            <span className="sr-only">, </span>
            {noSats ? (
              <span className="text-sm text-muted">
                <span aria-hidden="true">—</span>
                <span className="sr-only">no Bitcoin</span>
              </span>
            ) : (
              <span className={cx('whitespace-nowrap text-sm font-semibold', removed && 'text-muted')}>
                {line.sign === '' ? (
                  <span aria-hidden="true" className="invisible">
                    +
                  </span>
                ) : (
                  line.sign
                )}
                <Btc sats={line.sats ?? 0} />
              </span>
            )}
            {line.feeSats !== null && line.feeSats > 0 && line.arrivedSats === null ? (
              <span className="whitespace-nowrap text-xs text-muted">
                <span className="sr-only">, </span>fee <Btc sats={line.feeSats} />
              </span>
            ) : null}
          </span>
          {line.cents === null ? (
            <span className={cx(WIDE_ONLY, cols.usd, CELL.num, 'text-right text-sm text-muted @min-[34rem]:pl-8')}>
              <span aria-hidden="true">—</span>
              <span className="sr-only">, no dollars</span>
            </span>
          ) : (
            <span className={cx('flex items-end', noSats ? 'flex-col gap-0.5' : 'gap-1 text-xs text-muted', cols.usd, CELL.num, '@min-[34rem]:flex-col @min-[34rem]:gap-0 @min-[34rem]:pl-8')}>
              <span className="sr-only">, </span>
              <span className={cx('whitespace-nowrap', removed ? 'text-muted' : noSats ? 'text-text' : '@min-[34rem]:text-text', noSats && 'text-sm font-semibold', '@min-[34rem]:text-sm @min-[34rem]:font-semibold')}>
                <PlainMoney cents={line.cents} />
              </span>
              {line.centsWord !== '' ? (
                <span className={cx('whitespace-nowrap text-muted', noSats && 'text-xs', '@min-[34rem]:text-xs')}>
                  <span className="sr-only"> </span>
                  {line.centsWord}
                </span>
              ) : null}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

const namesCache = new WeakMap<LedgerState, Map<string, string>>();
/** Loan id to name, worked out once per replayed state. */
export function loanNames(state: LedgerState): Map<string, string> {
  let m = namesCache.get(state);
  if (m === undefined) {
    m = new Map(state.loans.map((l) => [l.id, l.name]));
    namesCache.set(state, m);
  }
  return m;
}

/**
 * A list of entry rows; each opens its `EntrySheet` (`onOpen(id)`). `walletId` is set on a wallet's own page: the Wallet
 * column drops out and moves show what that wallet saw. `className` styles the box (border, background, padding).
 */
export function EntryTable({ runs, wallets, onOpen, walletId = null, label, className }: { runs: readonly EntryRun[]; wallets: ReadonlyMap<string, Wallet>; onOpen(id: string): void; walletId?: string | null; label: string; className?: string }) {
  const { state } = useLedger();
  const loans = loanNames(state);
  const tags = loanTags(state);
  const cols = walletId === null ? W : P;
  return (
    <div className={cx('@container', className)}>
      <div className={cols.table}>
        <div aria-hidden="true" className={cx('hidden border-b border-line pb-2 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted', SUBGRID)}>
          <span className="col-start-1 pr-6">Date</span>
          <span className="col-span-2 col-start-2">What</span>
          {walletId === null ? <span className="col-start-4 pr-6">Wallet</span> : null}
          <span className={cx(cols.btc, 'pl-6 text-right')}>Bitcoin</span>
          <span className={cx(cols.usd, 'pl-8 text-right')}>Dollars</span>
        </div>
        <ul aria-label={label} className={cx('m-0 list-none p-0', SUBGRID)}>
          {runs.map((run) => {
            const e = run.item.current;
            const paid = (e.kind === 'buy' || e.kind === 'opening-lot') && !run.item.deleted ? tags.get(run.item.id) : undefined;
            return <Row key={run.item.id} run={run} line={rowLine(e, wallets, loans, walletId)} paidWith={paid ? <LoanBadge tag={paid.tag} /> : null} onOpen={() => onOpen(run.item.id)} cols={cols} onWalletPage={walletId !== null} />;
          })}
        </ul>
      </div>
    </div>
  );
}
