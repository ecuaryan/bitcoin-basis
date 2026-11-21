import { mulDivRoundHalfUp, oneYearAnniversary, SATS_PER_BTC, termFor, uuidv7, type BalanceConfirmEntry, type Entry, type Lot, type RetirementSnapshotEntry, type Wallet } from '@bitcoin-basis/engine';
import { useSubmit } from '../../ui/use-submit.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { confirmedLabel, countOf, satsToCents, shortDate } from '../../lib/format.ts';
import { describeOrigin, TIER_LABEL } from '../../lib/origin.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { HideButton, LockButton, useIsWide, useLogSheet } from '../../ui/AppShell.tsx';
import { Button, buttonClasses } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Callout, TextField } from '../../ui/form-fields.tsx';
import { ChevronLeftIcon } from '../../ui/more-icons.tsx';
import { BtcInput } from '../../ui/formatted-inputs.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { GainText, TIER_BG } from '../holdings-parts.tsx';
import { useAmount } from '../log/hooks.ts';
import { describeEntry } from '../../lib/describe-entry.ts';
import { buildItems, entryRows, NO_FILTER, RECHECK_REASON } from '../../lib/entry-list.ts';
import { EntryRow, EntrySheet } from '../entry-parts.tsx';
import { entriesCount } from '../records/records-entries.tsx';
import { EmptyLine, SectionCount, SectionHeader, ShowMore } from '../../ui/SectionHeader.tsx';
import { localInputFor, longDate, nextDay, nowInstant, trialReplay } from '../log/model.ts';
import { CloseOutSheet } from './CloseOut.tsx';
import { checkHistory, lastConfirmed, walletEntries, walletLots } from './model.ts';
import { WalletMenu, type WalletMenuStart } from './WalletMenu.tsx';
import { useTitle } from '../../ui/use-title.ts';
import { TERM_HELP } from '../../lib/terms.ts';
import { useHelp } from '../../ui/Help.tsx';
import { WorthLine } from '../../ui/WorthLine.tsx';
import { WALLET_TYPE_LABEL } from '../../lib/wallet-label.ts';
import { worthNow } from '../../lib/worth-now.ts';
import { loanTagFor } from '../../lib/loans-view.ts';
import { LoanBadge } from '../loans/loan-parts.tsx';


function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

const ROUND_BTN = 'press flex size-11 flex-none items-center justify-center rounded-xl border border-line bg-surface text-soft hover:text-text';

// ---- Header ----------------------------------------------------------------------------

function Header({ wallet, onMenu, wide }: { wallet: Wallet; onMenu(): void; wide: boolean }) {
  return (
    <header className="flex items-center gap-3">
      <Link to="/" aria-label="Back to Holdings" className={ROUND_BTN}>
        <ChevronLeftIcon size={18} />
      </Link>
      <h1 className="m-0 min-w-0 flex-1 truncate font-display text-[28px] font-semibold tracking-tight lg:text-4xl">{wallet.name}</h1>
      {wide ? <HideButton variant="text" /> : null}
      {wide ? <LockButton variant="text" /> : null}
      <button type="button" onClick={onMenu} aria-label="Wallet options" className={ROUND_BTN}>
        <DotsIcon />
      </button>
    </header>
  );
}

// ---- Balance ---------------------------------------------------------------------------

function Balance({ wallet, sats, costCents, avg, priceCents }: { wallet: Wallet; sats: number; costCents: number; avg: number | null; priceCents: number | null }) {
  const worth = priceCents === null ? null : satsToCents(sats, priceCents);
  const counted = !wallet.frozen && !wallet.archived;
  return (
    <section aria-label="Balance" className="flex flex-col gap-1.5">
      <span className="text-xs normal-nums tracking-[0.06em] text-muted">
        {WALLET_TYPE_LABEL[wallet.type].toUpperCase()}
        {wallet.archived ? ' · ARCHIVED' : ''}
      </span>
      <span className="font-display text-[34px] font-semibold leading-none tracking-[-0.02em] lg:text-5xl">
        <Amount sats={sats} showUnit />
      </span>
      {wallet.frozen ? (
        <span className="text-[13px] text-muted">
          Cost <Money cents={costCents} /> · not counted in what your Bitcoin is worth
        </span>
      ) : (
        <>
          {worth !== null && counted ? (
            <span className="text-sm">
              <Money cents={worth} precision="dollars" /> · <GainText cents={worth - costCents} className="font-semibold" /> <span className="text-muted">on paper</span>
            </span>
          ) : null}
          <span className="text-[13px] text-muted">Average cost {avg === null ? '—' : <Money cents={avg} />} per BTC</span>
        </>
      )}
    </section>
  );
}

// ---- Confirm balance -------------------------------------------------------------------

type Unit2 = 'btc' | 'sats';

function ConfirmBalance({ wallet, sats, inputRef, onLost }: { wallet: Wallet; sats: number; inputRef: React.RefObject<HTMLInputElement | null>; onLost(sats: number): void }) {
  const { entries, state, append, today } = useLedger();
  const toast = useToast();
  const { open } = useLogSheet();
  const [unit, setUnit] = useState<Unit2>('btc');
  const amount = useAmount(null, null);
  const [different, setDifferent] = useState(false);
  const [pending, setPending] = useState<{ entry: BalanceConfirmEntry; diff: number; since: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const confirmed = lastConfirmed(state, wallet.id);
  const lastCheck = state.balanceChecks.filter((c) => c.wallet === wallet.id).at(-1);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const checks = useMemo(() => checkHistory(buildItems(entries), state, wallet.id), [entries, state, wallet.id]);

  useEffect(() => {
    if (different) inputRef.current?.focus();
  }, [different, inputRef]);

  const entryFor = (reported: number): BalanceConfirmEntry => ({ id: uuidv7(), kind: 'balance-confirm', wallet: wallet.id, sats: reported, at: nowInstant(Date.now()), tz: state.settings.timeZone });
  function reset() {
    setDifferent(false);
    setPending(null);
    setChoosing(false);
    setError(null);
    amount.setText('');
  }

  /** Record a match. A repeat of the last check (same balance, nothing logged since) adds no new entry. */
  async function confirmMatch(entry: BalanceConfirmEntry) {
    const last = walletEntries(entries, state, wallet.id)[0];
    if (last !== undefined && last.kind === 'balance-confirm' && last.sats === entry.sats) {
      if (confirmed !== today) {
        // Same check, new day: the old confirmation is replaced, so the history stays one line.
        const again: BalanceConfirmEntry = { ...entry, replaces: last.id, reason: RECHECK_REASON };
        if (trialReplay(entries, state, [again], last.id).problems.length === 0) await append([again]);
        else await append([entry]);
      }
    } else {
      await append([entry]);
    }
    toast.show(`Confirmed. ${wallet.name} matches.`, { success: true });
    reset();
  }

  /** Yes: the app's own balance is what the wallet shows. */
  async function yesNow() {
    await confirmMatch(entryFor(sats));
  }

  async function checkNow() {
    setError(null);
    setPending(null);
    setChoosing(false);
    const reported = amount.unit === 'usd' ? null : amount.sats;
    if (reported === null || amount.text.trim() === '') {
      setError('Enter the balance you see.');
      return;
    }
    const entry = entryFor(reported);
    const t = trialReplay(entries, state, [entry]);
    const result = t.after.balanceChecks.find((c) => c.entryId === entry.id);
    if (result === undefined) {
      setError(t.problems[0] ?? 'That could not be checked.');
      return;
    }
    if (result.matches) {
      await confirmMatch(entry);
    } else {
      setPending({ entry, diff: result.differenceSats, since: result.entriesSinceLastMatch });
    }
  }

  const missing = pending === null ? 0 : Math.abs(pending.diff);
  function dismiss() {
    setPending(null);
    setChoosing(false);
  }
  const submit = useSubmit((what: 'yes' | 'check') => (what === 'yes' ? yesNow() : checkNow()));
  const saving = submit.busy;
  const sinceEntries = pending === null ? [] : pending.since.map((id) => entries.find((e) => e.id === id)).filter((e): e is Entry => e !== undefined);
  return (
    <Card as="section" aria-label="Does it match?" className="flex flex-col gap-3">
      <SectionHeader title="Does it match?" right={<SectionCount>{confirmedLabel(confirmed, today)}</SectionCount>} className="-my-2" />
      {confirmed === null ? <p className="-mt-1.5 m-0 text-xs leading-snug text-muted">A quick check that nothing was missed. If the numbers differ, a buy or fee wasn&apos;t logged.</p> : null}
      <p className="m-0 text-[15px] leading-snug">
        Does {wallet.name} show{' '}
        <strong className="font-semibold">
          <Amount sats={sats} showUnit interactive={false} />
        </strong>
        ?
      </p>
      {!different ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={saving} onClick={() => void submit.run('yes')}>
            {saving ? 'Saving…' : 'Yes'}
          </Button>
          <Button variant="ghost" onClick={() => setDifferent(true)}>
            No, it&apos;s different
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit.run('check');
          }}
        >
          <div className="flex items-end gap-2">
            {(() => {
              const unitPicker = (
                <select
                  aria-label="Unit of the balance"
                  value={unit}
                  onChange={(e) => {
                    const u = e.target.value as Unit2;
                    setUnit(u);
                    amount.setUnit(u);
                    amount.setText('');
                  }}
                  className="cursor-pointer appearance-none rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-soft"
                >
                  <option value="btc">BTC ▾</option>
                  <option value="sats">sats ▾</option>
                </select>
              );
              const common = { ref: inputRef, label: `What ${wallet.name} shows`, frameClassName: 'flex-1', error, trailing: unitPicker } as const;
              const changed = (t: string) => {
                amount.setText(t);
                setPending(null);
              };
              return unit === 'btc' ? <BtcInput {...common} value={amount.text} onChange={changed} /> : <TextField {...common} inputMode="numeric" autoComplete="off" placeholder="0" value={amount.text} onChange={(e) => changed(e.target.value.replace(/\D/g, ''))} />;
            })()}
            <Button type="submit" variant="secondary" disabled={saving} className="mb-0 h-[52px]">
              {saving ? 'Saving…' : 'Check'}
            </Button>
          </div>
          <Button variant="ghost" onClick={reset} className="-ml-4 self-start">
            Back
          </Button>
        </form>
      )}
      {pending === null && lastCheck !== undefined && !lastCheck.matches ? <p className="m-0 text-xs text-amber">The last check did not match. Enter the balance again after you have logged what is missing.</p> : null}
      {pending !== null ? (
        <div role="status" className="flex flex-col gap-2.5 rounded-2xl border border-amber/40 bg-amber/10 p-3.5 text-[13px] leading-snug">
          <p className="m-0">
            <strong className="font-semibold text-amber">
              {wallet.name} shows <Amount sats={Math.abs(pending.diff)} interactive={false} showUnit /> {pending.diff > 0 ? 'more' : 'less'}.
            </strong>{' '}
            {pending.diff > 0 ? 'Something is not logged yet, maybe a purchase or a deposit.' : 'Something left that is not logged yet, maybe a sale or a withdrawal.'}
          </p>
          {sinceEntries.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">Logged since the last time it matched</span>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {sinceEntries.slice(0, 6).map((e) => {
                  const line = describeEntry(e, wallets);
                  return (
                    <li key={e.id} className="flex justify-between gap-3 text-xs">
                      <span>
                        {line.summary} · {shortDate(localInputFor(e.at, e.tz).slice(0, 10), today)}
                      </span>
                      {line.sats !== null ? <Amount sats={line.sats} interactive={false} short /> : null}
                    </li>
                  );
                })}
              </ul>
              {sinceEntries.length > 6 ? <span className="text-xs text-muted">and {sinceEntries.length - 6} more</span> : null}
            </div>
          ) : null}
          {choosing ? (
            <div role="group" aria-label="What happened?" className="flex flex-col gap-2">
              <span className="text-xs text-muted">What happened?</span>
              <div className="flex flex-wrap gap-2">
                {pending.diff < 0 ? (
                  <>
                    <Button variant="secondary" onClick={() => open({ kind: 'sell', wallet: wallet.id, sats: missing })}>
                      Sold or spent
                    </Button>
                    <Button variant="secondary" onClick={() => open({ kind: 'move', wallet: wallet.id, sats: missing })}>
                      Moved to another wallet
                    </Button>
                    <Button variant="secondary" onClick={() => onLost(missing)}>
                      Lost or stolen
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => open({ kind: 'buy', wallet: wallet.id, sats: missing })}>
                      Bought
                    </Button>
                    <Button variant="secondary" onClick={() => open({ kind: 'receive', wallet: wallet.id, sats: missing })}>
                      Received
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setChoosing(true)} className="self-start">
              Log the missing <Amount sats={missing} interactive={false} showUnit />
            </Button>
          )}
          <Button variant="ghost" onClick={dismiss} className="-ml-4 self-start">
            Not now
          </Button>
        </div>
      ) : null}
      {checks.length > 0 ? (
        <details className="-mb-2 text-xs text-muted">
          <summary className="flex min-h-11 w-fit items-center font-semibold text-soft hover:text-text">History</summary>
          <ul className="m-0 mb-2 flex list-none flex-col gap-1 p-0">
            {checks.map((c) => (
              <li key={c.date} className="flex justify-between gap-3">
                <span>
                  {shortDate(c.date, today)}
                  {c.times > 1 ? ` · ${countOf(c.times, 'check')}` : ''}
                </span>
                <span className={c.matched ? 'text-muted' : 'text-amber'}>{c.matched ? 'Matched' : 'Did not match'}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

// ---- Coins -----------------------------------------------------------------------------

function CoinsSection({ lots, today, entries, walletsById, priceCents }: { lots: Lot[]; today: string; entries: readonly Entry[]; walletsById: ReadonlyMap<string, Wallet>; priceCents: number | null }) {
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(() => [...lots].sort((a, b) => (a.acquiredAt < b.acquiredAt ? -1 : a.acquiredAt > b.acquiredAt ? 1 : 0)), [lots]);
  const shown = all ? sorted : sorted.slice(0, 5);
  const termHelp = useHelp('What are short-term and long-term?', TERM_HELP);
  const { state } = useLedger();
  return (
    <Card as="section" aria-label="Coins in this wallet" className="flex flex-col">
      <SectionHeader title="Coins, oldest first" help={termHelp.button} right={<span className="flex-none text-xs text-muted">Cost per BTC</span>} className="-mt-2" />
      {termHelp.panel}
      {sorted.length === 0 ? <EmptyLine>No coins here.</EmptyLine> : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((l) => {
          const long = termFor(l, today) === 'long';
          const perBtc = l.sats === 0 ? null : mulDivRoundHalfUp(l.costCents, SATS_PER_BTC, l.sats);
          const open = openId === l.id;
          const origin = entries.find((e) => e.id === l.originEntryId);
          const loan = loanTagFor(state, l.id);
          return (
            <li key={l.id} className="border-b border-line last:border-b-0">
              <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : l.id)} className="flex min-h-[54px] w-full items-center gap-3 bg-transparent py-1.5 text-left text-text">
                <span className={cx('h-8 w-1.5 flex-none self-center rounded-full', TIER_BG[l.tier])} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold">
                    <Amount sats={l.sats} interactive={false} />
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {shortDate(l.acquiredDate, today)} · {TIER_LABEL[l.tier]}
                    {loan ? <LoanBadge tag={loan.tag} /> : null}
                  </span>
                  <WorthLine worth={worthNow(l.sats, l.costCents, priceCents)} className="mt-0.5 text-xs" />
                </span>
                <span className="flex flex-col items-end text-right">
                  <span className="text-sm font-semibold">{perBtc === null ? '—' : <Money cents={perBtc} />}</span>
                  <span className={cx('text-xs normal-nums', long ? 'text-muted' : 'max-w-[7.5rem] font-semibold text-balance text-amber sm:max-w-none')}>{long ? 'Long-term' : `Long-term on ${shortDate(nextDay(oneYearAnniversary(l.acquiredDate)), today)}`}</span>
                </span>
              </button>
              {open ? (
                <dl className="mb-2 ml-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-bg px-3 py-2.5 text-xs">
                  <dt className="text-muted">Came from</dt>
                  <dd className="m-0">{describeOrigin(l, origin, walletsById)}</dd>
                  <dt className="text-muted">Cost</dt>
                  <dd className="m-0">
                    <Money cents={l.costCents} />
                  </dd>
                  <dt className="text-muted">Receipt</dt>
                  <dd className="m-0">{l.proof || 'None yet'}</dd>
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
      {sorted.length > shown.length ? <ShowMore onClick={() => setAll(true)}>Show all {countOf(sorted.length, 'coin')}</ShowMore> : null}
    </Card>
  );
}

// ---- Entries (the shared list: tap one for its details, history, Edit and Remove) ------

function History({ wallet }: { wallet: Wallet }) {
  const { entries, state, today } = useLedger();
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const items = useMemo(() => buildItems(entries), [entries]);
  const rows = useMemo(() => entryRows(items, { ...NO_FILTER, wallet: wallet.id }, wallets), [items, wallet.id, wallets]);
  const shown = all ? rows : rows.slice(0, 5);
  const open = rows.find((r) => r.item.id === openId) ?? null;
  return (
    <Card as="section" aria-label="Entries" className="flex flex-col">
      <SectionHeader title="Entries" right={<SectionCount>{entriesCount(rows.length)}</SectionCount>} className="-mt-2" />
      {rows.length === 0 ? <EmptyLine>Nothing logged for {wallet.name} yet.</EmptyLine> : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((run, i, arr) => (
          <EntryRow key={run.item.id} run={run} wallets={wallets} today={today} onOpen={() => setOpenId(run.item.id)} last={i === arr.length - 1} />
        ))}
      </ul>
      {rows.length > shown.length ? <ShowMore onClick={() => setAll(true)}>Show all {entriesCount(rows.length)}</ShowMore> : null}
      {open && <EntrySheet run={open} state={state} today={today} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

// ---- Frozen wallets --------------------------------------------------------------------

function FrozenSections({ wallet, sats, costCents, rows, onCloseOut }: { wallet: Wallet; sats: number; costCents: number; rows: Entry[]; onCloseOut(): void }) {
  const { state, today } = useLedger();
  const { open } = useLogSheet();
  const freeze = rows.find((e) => e.kind === 'wallet-freeze');
  const since = freeze === undefined ? null : localInputFor(freeze.at, freeze.tz).slice(0, 10);
  const payouts = rows.filter((e) => e.kind === 'receive' && e.source.type === 'frozen-payout').reverse();
  const closed = state.closeOuts.find((c) => c.wallet === wallet.id);
  const events: { title: React.ReactNode; sub: string; done: boolean }[] = [
    { title: 'Withdrawals stopped', sub: `${since === null ? '' : `${longDate(since)} · `}You marked it frozen`, done: true },
    ...payouts.flatMap((e) =>
      e.kind === 'receive'
        ? [
            {
              title: (
                <>
                  Payout received: <Amount sats={e.sats} interactive={false} showUnit />
                </>
              ),
              sub: `${longDate(localInputFor(e.at, e.tz).slice(0, 10))} · worth now counted in the wallet it went to`,
              done: true,
            },
          ]
        : [],
    ),
    closed === undefined ? { title: 'Not closed out yet', sub: 'Close it out when recovery is certain, to record the loss', done: false } : { title: 'Closed out', sub: `Loss date ${longDate(closed.lossDate)}`, done: true },
  ];
  return (
    <>
      <section aria-label="Frozen balance" className="flex flex-col gap-1.5">
        <span className="text-xs tracking-[0.06em] text-amber">FROZEN{since === null ? '' : ` SINCE ${longDate(since).toUpperCase()}`}</span>
        <span className="font-display text-[34px] font-semibold leading-none tracking-[-0.02em] lg:text-5xl">
          <Amount sats={sats} showUnit />
        </span>
        <span className="text-[13px] text-muted">
          Cost <Money cents={costCents} /> · not counted in what your Bitcoin is worth
        </span>
      </section>
      <Card as="section" aria-label="What happened" className="flex flex-col gap-3">
        <h2 className="m-0 text-[15px] font-semibold">What happened</h2>
        <ol className="m-0 flex list-none flex-col p-0">
          {events.map((ev, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cx('mt-1 size-3 flex-none rounded-full', ev.done ? 'bg-accent' : 'border-2 border-accent')} aria-hidden="true" />
                <span className={cx('w-0.5 flex-1', i < events.length - 1 ? 'bg-line' : 'bg-transparent')} aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-0.5 pb-3.5">
                <span className="text-sm font-semibold">{ev.title}</span>
                <span className="text-xs text-muted">{ev.sub}</span>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {closed === undefined && sats > 0 ? (
        <Card as="section" aria-label="Close it out" className="flex flex-col gap-3">
          <span className="text-xs tracking-[0.06em] text-muted">IF YOU CLOSE IT OUT</span>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-soft">Loss recorded</span>
            <span className="font-display text-2xl font-semibold">
              <Money cents={Math.max(0, costCents - wallet.recoveredCents)} />
            </span>
          </div>
          <span className="text-xs text-muted">
            Cost <Money cents={costCents} /> minus payouts <Money cents={wallet.recoveredCents} />
          </span>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="secondary" onClick={() => open({ kind: 'receive', payoutFrom: wallet.id })}>
              Log a payout
            </Button>
            <Button variant="primary" onClick={onCloseOut}>
              Review and close out
            </Button>
          </div>
          <span className="text-xs text-muted">As of {longDate(today)}. Not tax advice. Confirm with your CPA.</span>
        </Card>
      ) : null}
    </>
  );
}

// ---- Retirement wallets ----------------------------------------------------------------

function RetirementDetail({ wallet, onMenu, wide }: { wallet: Wallet; onMenu(): void; wide: boolean }) {
  const { state, append, today } = useLedger();
  const toast = useToast();
  const snaps = state.retirementSnapshots.filter((s) => s.wallet === wallet.id);
  const last = snaps.at(-1);
  const amount = useAmount(null, null);
  const [error, setError] = useState<string | null>(null);
  const note = useSubmit(async () => {
    const sats = amount.sats;
    if (sats === null || amount.unit === 'usd') {
      setError('Enter the balance in BTC or sats.');
      return;
    }
    // The same balance noted again on the same day adds nothing.
    if (!(last !== undefined && last.sats === sats && last.date === today)) {
      const entry: RetirementSnapshotEntry = { id: uuidv7(), kind: 'retirement-snapshot', wallet: wallet.id, sats, at: nowInstant(Date.now()), tz: state.settings.timeZone };
      await append([entry]);
    }
    toast.show('Balance noted.', { success: true });
    amount.setText('');
    setError(null);
  });
  return (
    <div className="flex flex-col gap-5">
      <Header wallet={wallet} onMenu={onMenu} wide={wide} />
      <section aria-label="Balance" className="flex flex-col gap-1.5">
        <span className="text-xs tracking-[0.06em] text-muted">RETIREMENT · BALANCE NOTE</span>
        <span className="font-display text-[34px] font-semibold leading-none tracking-[-0.02em]">{last === undefined ? '—' : <Amount sats={last.sats} showUnit />}</span>
        <span className="text-[13px] text-muted">{last === undefined ? 'No balance noted yet.' : `As of ${longDate(last.date)}.`} Retirement wallets are shown separately and never enter tax math.</span>
      </section>
      <Card className="flex max-w-xl flex-col gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void note.run();
          }}
        >
          <TextField label={`What ${wallet.name} shows today (BTC)`} inputMode="decimal" autoComplete="off" value={amount.text} onChange={(e) => amount.setText(e.target.value)} frameClassName="flex-1" error={error} />
          <Button type="submit" variant="secondary" disabled={note.busy} className="h-[52px]">
            {note.busy ? 'Saving…' : 'Save'}
          </Button>
        </form>
        <span className="text-xs text-muted">Today is {longDate(today)}.</span>
      </Card>
    </div>
  );
}

// ---- Screen ----------------------------------------------------------------------------

export function WalletDetail() {
  const { id } = useParams();
  const { entries, state, holdings, today, ready } = useLedger();
  const { quote } = usePrice();
  const wide = useIsWide();
  const [menu, setMenu] = useState(false);
  const [menuStart, setMenuStart] = useState<WalletMenuStart | null>(null);
  const [closeOut, setCloseOut] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);
  const wallet = state.wallets.find((w) => w.id === id);
  const walletsById = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const holding = holdings.wallets.find((w) => w.wallet === id);
  const lots = useMemo(() => (id === undefined ? [] : walletLots(state, id)), [state, id]);
  const rows = useMemo(() => (id === undefined ? [] : walletEntries(entries, state, id)), [entries, state, id]);
  useTitle(ready ? (wallet?.name ?? 'Wallet') : null);

  if (!ready) return <div aria-busy="true" className="min-h-[60dvh]" />;
  if (wallet === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="m-0 font-display text-[28px] font-semibold tracking-tight lg:text-4xl">Wallet</h1>
        <Card>That wallet is not in your book.</Card>
        <Link to="/" className={buttonClasses('secondary', 'w-fit no-underline text-text')}>
          Back to Holdings
        </Link>
      </div>
    );
  }
  const holdingSats = holding?.sats ?? 0;
  const openMenu = () => {
    setMenuStart(null);
    setMenu(true);
  };
  const openLost = (sats: number) => {
    setMenuStart({ view: 'lost', sats });
    setMenu(true);
  };
  const menuNode = (
    <>
      <WalletMenu
        key={menuStart === null ? 'menu' : 'lost'}
        start={menuStart}
        open={menu}
        onClose={() => setMenu(false)}
        wallet={wallet}
        holdingSats={holdingSats}
        onCloseOut={() => setCloseOut(true)}
      />
      <CloseOutSheet open={closeOut} onClose={() => setCloseOut(false)} wallet={wallet} />
    </>
  );

  if (wallet.type === 'retirement') {
    return (
      <>
        <RetirementDetail wallet={wallet} onMenu={openMenu} wide={wide} />
        {menuNode}
      </>
    );
  }

  const costCents = holding?.costCents ?? 0;
  const priceCents = quote?.usdCents ?? null;
  const frozenView = wallet.frozen;
  const left = (
    <>
      {frozenView ? (
        <FrozenSections wallet={wallet} sats={holdingSats} costCents={costCents} rows={rows} onCloseOut={() => setCloseOut(true)} />
      ) : (
        <Balance wallet={wallet} sats={holdingSats} costCents={costCents} avg={holding?.averageCostCentsPerBtc ?? null} priceCents={priceCents} />
      )}
      {!frozenView ? <ConfirmBalance wallet={wallet} sats={holdingSats} inputRef={confirmRef} onLost={openLost} /> : null}
    </>
  );
  const right = (
    <>
      <CoinsSection lots={lots} today={today} entries={entries} walletsById={walletsById} priceCents={priceCents} />
      <History wallet={wallet} />
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <Header wallet={wallet} onMenu={openMenu} wide={wide} />
      {wallet.archived ? <Callout>This wallet is archived. Bring it back from its options (the three dots) to use it again.</Callout> : null}
      {wide ? (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-6">
          <div className="flex flex-col gap-5">{left}</div>
          <div className="flex flex-col gap-5">{right}</div>
        </div>
      ) : (
        <>
          {left}
          {right}
        </>
      )}
      {menuNode}
    </div>
  );
}

