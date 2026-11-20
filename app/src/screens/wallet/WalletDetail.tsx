import { mulDivRoundHalfUp, oneYearAnniversary, SATS_PER_BTC, termFor, uuidv7, type BalanceConfirmEntry, type Entry, type Lot, type RetirementSnapshotEntry, type Wallet } from '@bitcoin-basis/engine';
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { satsToCents, shortDate } from '../../lib/format.ts';
import { describeOrigin, TIER_LABEL } from '../../lib/origin.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { HideButton, LockButton, useIsWide, useLogSheet } from '../../ui/AppShell.tsx';
import { Button, buttonClasses } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Callout, TextField } from '../../ui/form-fields.tsx';
import { ChevronRightIcon } from '../../ui/icons.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { GainText, TIER_BG } from '../holdings-parts.tsx';
import { useAmount } from '../log/hooks.ts';
import { describeEntry } from '../../lib/describe-entry.ts';
import { DELETABLE_KINDS, EDITABLE_KINDS, localInputFor, lockedYear, longDate, nextDay, nowInstant, trialReplay } from '../log/model.ts';
import { CloseOutSheet } from './CloseOut.tsx';
import { lastConfirmed, walletEntries, walletLots } from './model.ts';
import { WalletMenu } from './WalletMenu.tsx';

const TYPE_LABEL = { exchange: 'Exchange', 'self-custody': 'Self-custody', retirement: 'Retirement' } as const;
const MORE_STEP = 25;

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

const ROUND_BTN = 'flex size-11 flex-none items-center justify-center rounded-full border border-line bg-surface text-soft hover:text-text';

// ---- Header ----------------------------------------------------------------------------

function Header({ wallet, onMenu, wide }: { wallet: Wallet; onMenu(): void; wide: boolean }) {
  return (
    <header className="flex items-center gap-3">
      <Link to="/" aria-label="Back to Holdings" className={ROUND_BTN}>
        <ChevronRightIcon size={18} className="rotate-180" />
      </Link>
      <h1 className="m-0 min-w-0 flex-1 truncate font-display text-[26px] font-semibold tracking-tight lg:text-4xl">{wallet.name}</h1>
      {wide ? <HideButton variant="text" /> : null}
      {wide ? <LockButton variant="text" /> : null}
      <button type="button" onClick={onMenu} aria-label="Wallet options" className={ROUND_BTN}>
        <DotsIcon />
      </button>
    </header>
  );
}

// ---- Balance ---------------------------------------------------------------------------

function Balance({ wallet, sats, costCents, avg, lotCount, priceCents }: { wallet: Wallet; sats: number; costCents: number; avg: number | null; lotCount: number; priceCents: number | null }) {
  const worth = priceCents === null ? null : satsToCents(sats, priceCents);
  const counted = !wallet.frozen && !wallet.archived;
  return (
    <section aria-label="Balance" className="flex flex-col gap-1.5">
      <span className="text-xs tracking-[0.06em] text-muted">
        {TYPE_LABEL[wallet.type].toUpperCase()} · {lotCount} {lotCount === 1 ? 'LOT' : 'LOTS'}
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
              <Money cents={worth} /> · <GainText cents={worth - costCents} className="font-semibold" /> <span className="text-muted">on paper</span>
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

function ConfirmBalance({ wallet, inputRef }: { wallet: Wallet; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const { entries, state, append, today } = useLedger();
  const toast = useToast();
  const { open } = useLogSheet();
  const [unit, setUnit] = useState<Unit2>('btc');
  const amount = useAmount(null, null);
  const [pending, setPending] = useState<{ entry: BalanceConfirmEntry; diff: number; since: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmed = lastConfirmed(state, wallet.id);
  const lastCheck = state.balanceChecks.filter((c) => c.wallet === wallet.id).at(-1);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);

  async function check() {
    setError(null);
    setPending(null);
    const reported = amount.unit === 'usd' ? null : amount.sats;
    if (reported === null || amount.text.trim() === '') {
      setError('Enter the balance shown by ' + wallet.name + '.');
      return;
    }
    const entry: BalanceConfirmEntry = { id: uuidv7(), kind: 'balance-confirm', wallet: wallet.id, sats: reported, at: nowInstant(Date.now()), tz: state.settings.timeZone };
    const t = trialReplay(entries, state, [entry]);
    const result = t.after.balanceChecks.find((c) => c.entryId === entry.id);
    if (result === undefined) {
      setError(t.problems[0] ?? 'That could not be checked.');
      return;
    }
    if (result.matches) {
      await append([entry]);
      toast.show(`${wallet.name} matches. Confirmed today.`);
      amount.setText('');
    } else {
      setPending({ entry, diff: result.differenceSats, since: result.entriesSinceLastMatch });
    }
  }

  const sinceEntries = pending === null ? [] : pending.since.map((id) => entries.find((e) => e.id === id)).filter((e): e is Entry => e !== undefined);
  return (
    <Card as="section" aria-label="Confirm balance" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold">Does {wallet.name} match?</h2>
        <span className="text-xs text-muted" role="status">
          {confirmed === null ? 'Not confirmed yet' : confirmed === today ? 'Confirmed today' : `Last confirmed ${shortDate(confirmed, today)}`}
        </span>
      </div>
      <form
        className="flex flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <div className="flex items-end gap-2">
          <TextField
            ref={inputRef}
            label={`What ${wallet.name} shows`}
            inputMode="decimal"
            autoComplete="off"
            placeholder={unit === 'btc' ? '0.00000000' : '0'}
            value={amount.text}
            onChange={(e) => {
              amount.setText(e.target.value);
              setPending(null);
            }}
            frameClassName="flex-1"
            error={error}
          />
          <Button type="submit" variant="secondary" className="mb-0 h-[52px]">
            Check
          </Button>
        </div>
        <Segmented<Unit2>
          label="Unit of the balance"
          value={unit}
          onChange={(u) => {
            setUnit(u);
            amount.setUnit(u);
            amount.setText('');
          }}
          options={[
            { value: 'btc', label: 'BTC' },
            { value: 'sats', label: 'sats' },
          ]}
          className="max-w-44"
        />
      </form>
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
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => open({ wallet: wallet.id })}>
              Log it
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void append([pending.entry]).then(() => {
                  toast.show('Saved. This wallet is marked as needing a check.');
                  setPending(null);
                });
              }}
            >
              Save this check anyway
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ---- Coins -----------------------------------------------------------------------------

function CoinsSection({ lots, today, entries, walletsById }: { lots: Lot[]; today: string; entries: readonly Entry[]; walletsById: ReadonlyMap<string, Wallet> }) {
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(() => [...lots].sort((a, b) => (a.acquiredAt < b.acquiredAt ? -1 : a.acquiredAt > b.acquiredAt ? 1 : 0)), [lots]);
  const shown = all ? sorted : sorted.slice(0, 12);
  return (
    <Card as="section" aria-label="Coins in this wallet" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-[15px] font-semibold">Coins, oldest first</h2>
        <span className="text-xs text-muted">Cost per BTC</span>
      </div>
      {sorted.length === 0 ? <p className="m-0 py-3 text-sm text-muted">No coins here.</p> : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((l) => {
          const long = termFor(l, today) === 'long';
          const perBtc = l.sats === 0 ? null : mulDivRoundHalfUp(l.costCents, SATS_PER_BTC, l.sats);
          const open = openId === l.id;
          const origin = entries.find((e) => e.id === l.originEntryId);
          return (
            <li key={l.id} className="border-b border-line last:border-b-0">
              <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : l.id)} className="flex min-h-[54px] w-full items-center gap-3 bg-transparent py-1.5 text-left text-text">
                <span className={cx('h-8 w-1.5 flex-none rounded-full', TIER_BG[l.tier])} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold">
                    <Amount sats={l.sats} interactive={false} />
                  </span>
                  <span className="text-xs text-muted">
                    {shortDate(l.acquiredDate, today)} · {TIER_LABEL[l.tier]}
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="text-sm font-semibold">{perBtc === null ? '—' : <Money cents={perBtc} />}</span>
                  <span className={cx('text-xs', long ? 'text-muted' : 'font-semibold text-amber')}>{long ? 'Long-term' : `Long-term on ${shortDate(nextDay(oneYearAnniversary(l.acquiredDate)), today)}`}</span>
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
                  <dt className="text-muted">Record</dt>
                  <dd className="m-0">{l.proof || 'None yet'}</dd>
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
      {sorted.length > shown.length ? (
        <Button variant="ghost" onClick={() => setAll(true)} className="self-start">
          Show all {sorted.length} coins
        </Button>
      ) : null}
    </Card>
  );
}

// ---- History (entries, with edit and remove) --------------------------------------------

function History({ wallet, rows }: { wallet: Wallet; rows: Entry[] }) {
  const { state, today } = useLedger();
  const { open } = useLogSheet();
  const [count, setCount] = useState(MORE_STEP);
  const [openId, setOpenId] = useState<string | null>(null);
  const wallets = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  return (
    <Card as="section" aria-label="Entries" className="flex flex-col gap-1">
      <h2 className="m-0 text-[15px] font-semibold">Entries</h2>
      <p className="m-0 mb-1 text-xs text-muted">Changes are saved as new entries. The original is kept.</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.slice(0, count).map((e) => {
          const line = describeEntry(e, wallets);
          const locked = lockedYear(e, state);
          const isOpen = openId === e.id;
          const date = localInputFor(e.at, e.tz).slice(0, 10);
          const canEdit = EDITABLE_KINDS.has(e.kind);
          const canRemove = DELETABLE_KINDS.has(e.kind);
          return (
            <li key={e.id} className="border-b border-line last:border-b-0">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : e.id)} className="flex min-h-14 w-full items-center gap-3 bg-transparent py-1.5 text-left text-text">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{line.summary}</span>
                  <span className="text-xs text-muted">
                    {shortDate(date, today)}
                    {locked !== null ? ` · locked, ${locked} is closed` : ''}
                    {e.replaces !== undefined ? ' · edited' : ''}
                  </span>
                </span>
                <span className="flex flex-col items-end text-sm font-semibold">
                  {line.sats !== null ? <Amount sats={line.sats} interactive={false} short /> : null}
                  {line.cents !== null ? (
                    <span className="text-xs font-normal text-muted">
                      <Money cents={line.cents} precision="dollars" /> {line.centsLabel}
                    </span>
                  ) : null}
                </span>
                <ChevronRightIcon size={16} className={cx('flex-none text-muted transition-transform duration-150', isOpen && 'rotate-90')} />
              </button>
              {isOpen ? (
                <div className="mb-2 flex flex-col gap-2 rounded-xl bg-bg px-3 py-2.5 text-xs">
                  {e.reason ? <span className="text-muted">Why it was changed: {e.reason}</span> : null}
                  {e.note ? <span className="whitespace-pre-line text-muted">{e.note}</span> : null}
                  {e.kind === 'give' && e.to === 'person' ? (
                    <Link to={`/gift-note/${e.id}`} className="w-fit text-sm font-semibold">
                      Open the gift note
                    </Link>
                  ) : null}
                  {locked !== null ? (
                    <span className="flex items-center gap-1.5 font-semibold text-amber">
                      Locked: {locked} is closed. Unlock the year in Records to change this.
                    </span>
                  ) : canEdit || canRemove ? (
                    <div className="flex flex-wrap gap-2">
                      {canEdit ? (
                        <Button variant="secondary" onClick={() => open({ edit: e.id })}>
                          Edit
                        </Button>
                      ) : null}
                      {canRemove ? (
                        <Button variant="ghost" onClick={() => open({ remove: e.id })}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {rows.length === 0 ? <p className="m-0 py-2 text-sm text-muted">Nothing logged for {wallet.name} yet.</p> : null}
      {rows.length > count ? (
        <Button variant="ghost" onClick={() => setCount((c) => c + MORE_STEP)} className="self-start">
          Show more
        </Button>
      ) : null}
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
            <span className="font-display text-2xl font-semibold text-accent">
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
          <span className="text-xs text-muted">As of {today}. Not tax advice. Confirm with your CPA.</span>
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
            const sats = amount.sats;
            if (sats === null || amount.unit === 'usd') {
              setError('Enter the balance in BTC or sats.');
              return;
            }
            const entry: RetirementSnapshotEntry = { id: uuidv7(), kind: 'retirement-snapshot', wallet: wallet.id, sats, at: nowInstant(Date.now()), tz: state.settings.timeZone };
            void append([entry]).then(() => {
              toast.show('Balance noted.');
              amount.setText('');
              setError(null);
            });
          }}
        >
          <TextField label={`What ${wallet.name} shows today (BTC)`} inputMode="decimal" autoComplete="off" value={amount.text} onChange={(e) => amount.setText(e.target.value)} frameClassName="flex-1" error={error} />
          <Button type="submit" variant="secondary" className="h-[52px]">
            Save
          </Button>
        </form>
        <span className="text-xs text-muted">Today is {today}.</span>
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
  const [closeOut, setCloseOut] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);
  const wallet = state.wallets.find((w) => w.id === id);
  const walletsById = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);
  const holding = holdings.wallets.find((w) => w.wallet === id);
  const lots = useMemo(() => (id === undefined ? [] : walletLots(state, id)), [state, id]);
  const rows = useMemo(() => (id === undefined ? [] : walletEntries(entries, state, id)), [entries, state, id]);

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
  const openMenu = () => setMenu(true);
  const menuNode = (
    <>
      <WalletMenu
        open={menu}
        onClose={() => setMenu(false)}
        wallet={wallet}
        holdingSats={holdingSats}
        onCheckBalance={() => {
          // After the sheet closes, bring the confirm box into view and focus it.
          setTimeout(() => {
            confirmRef.current?.scrollIntoView({ block: 'center' });
            confirmRef.current?.focus();
          }, 50);
        }}
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
        <Balance wallet={wallet} sats={holdingSats} costCents={costCents} avg={holding?.averageCostCentsPerBtc ?? null} lotCount={lots.length} priceCents={priceCents} />
      )}
      {!frozenView ? <ConfirmBalance wallet={wallet} inputRef={confirmRef} /> : null}
    </>
  );
  const right = (
    <>
      <CoinsSection lots={lots} today={today} entries={entries} walletsById={walletsById} />
      <History wallet={wallet} rows={rows} />
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

