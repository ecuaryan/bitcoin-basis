import { localDate, uuidv7, type Entry, type LostCause, type LostEntry, type Wallet, type WalletEntry, type WalletFreezeEntry, type WalletUpdateEntry } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Amount } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Callout, SelectField, TextAreaField, TextField } from '../../ui/form-fields.tsx';
import { ChevronRightIcon } from '../../ui/icons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { CoinPicker } from '../log/CoinPicker.tsx';
import type { Draft } from '../log/draft.ts';
import { useAmount, useFormEnv } from '../log/hooks.ts';
import { choosePicks, localInputFor, longDate, lotsAvailable, noonOn, nowInstant, whenLabel, zonedInstant, type PickMode } from '../log/model.ts';
import { AmountInput, FormFooter, WhenField } from '../log/parts.tsx';
import { Review } from '../log/Review.tsx';

type View = 'menu' | 'rename' | 'proof' | 'freeze' | 'lost' | 'archive';

const CAUSES: { value: LostCause; label: string }[] = [
  { value: 'lost-keys', label: 'Lost keys' },
  { value: 'wrong-address', label: 'Sent to the wrong address' },
  { value: 'hack', label: 'Hacked' },
  { value: 'scam', label: 'Scam' },
];

function MenuRow({ title, sub, onClick, icon, last }: { title: string; sub: string; onClick(): void; icon: ReactNode; last?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-h-[60px] w-full items-center gap-3 bg-transparent py-2 text-left text-text ${last ? '' : 'border-b border-line'}`}>
      <span className="flex size-9 flex-none items-center justify-center rounded-xl bg-surface-2 text-soft" aria-hidden="true">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="truncate text-xs text-muted">{sub}</span>
      </span>
      <ChevronRightIcon size={16} className="flex-none text-muted" />
    </button>
  );
}

const svg = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  check: svg('M5 12l5 5 9-10'),
  pencil: svg('M4 20h4l10-10-4-4L4 16v4zM13 7l4 4'),
  mail: svg('M4 6h16v12H4zM4 7l8 6 8-6'),
  snow: svg('M12 3v18M4 7.5l16 9M20 7.5l-16 9'),
  alert: svg('M12 4l9 16H3zM12 10v4M12 17h.01'),
  archive: svg('M4 6h16v4H4zM6 10v9h12v-9M10 14h4'),
};

function BackLink({ onClick }: { onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 flex min-h-11 items-center gap-1.5 bg-transparent p-0 text-sm font-semibold text-soft hover:text-text">
      <ChevronRightIcon size={16} className="rotate-180" />
      Back to options
    </button>
  );
}

function useWalletSave(onDone: () => void) {
  const { append } = useLedger();
  const toast = useToast();
  return async (entry: Entry, message: string) => {
    await append([entry]);
    toast.show(message);
    onDone();
  };
}

/** ⋯ menu of a wallet: everyday options, and the rare "something went wrong" ones. */
export function WalletMenu({ open, onClose, wallet, onCheckBalance, onCloseOut, holdingSats }: { open: boolean; onClose(): void; wallet: Wallet; onCheckBalance(): void; onCloseOut(): void; holdingSats: number }) {
  return (
    <Sheet open={open} onClose={onClose} title={wallet.name}>
      <MenuBody wallet={wallet} onClose={onClose} onCheckBalance={onCheckBalance} onCloseOut={onCloseOut} holdingSats={holdingSats} />
    </Sheet>
  );
}

function MenuBody({ wallet, onClose, onCheckBalance, onCloseOut, holdingSats }: { wallet: Wallet; onClose(): void; onCheckBalance(): void; onCloseOut(): void; holdingSats: number }) {
  const [view, setView] = useState<View>('menu');
  const back = () => setView('menu');
  const retirement = wallet.type === 'retirement';
  if (view === 'rename') return <RenameView wallet={wallet} onBack={back} onClose={onClose} />;
  if (view === 'proof') return <ProofView wallet={wallet} onBack={back} onClose={onClose} />;
  if (view === 'freeze') return <FreezeView wallet={wallet} onBack={back} onClose={onClose} />;
  if (view === 'lost') return <LostView wallet={wallet} onBack={back} onClose={onClose} />;
  if (view === 'archive') return <ArchiveView wallet={wallet} holdingSats={holdingSats} onBack={back} onClose={onClose} />;
  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex flex-col">
        {!retirement ? (
          <MenuRow
            title="Check the balance"
            sub={`Compare with what ${wallet.name} shows`}
            icon={ICONS.check}
            onClick={() => {
              onClose();
              onCheckBalance();
            }}
          />
        ) : null}
        <MenuRow title="Rename" sub={wallet.name} icon={ICONS.pencil} onClick={() => setView('rename')} />
        <MenuRow title="Where proof usually is" sub={wallet.defaultProof || 'Not set'} icon={ICONS.mail} onClick={() => setView('proof')} last />
      </div>
      {!retirement ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs tracking-[0.06em] text-muted">IF SOMETHING WENT WRONG</span>
          <div className="flex flex-col">
            {wallet.frozen ? (
              wallet.closeOutEntryId === null ? (
                <MenuRow
                  title="Close out this wallet"
                  sub="Record the loss and empty it"
                  icon={ICONS.snow}
                  onClick={() => {
                    onClose();
                    onCloseOut();
                  }}
                />
              ) : null
            ) : (
              <MenuRow title="Platform frozen or failed" sub="Withdrawals stopped, bankruptcy" icon={ICONS.snow} onClick={() => setView('freeze')} />
            )}
            {!wallet.frozen ? <MenuRow title="Coins lost or stolen" sub="Lost keys, wrong address, hack, scam" icon={ICONS.alert} onClick={() => setView('lost')} last /> : null}
          </div>
        </div>
      ) : null}
      <button type="button" onClick={() => setView('archive')} className="flex min-h-11 items-center justify-center rounded-xl bg-transparent text-sm font-semibold text-soft hover:text-text">
        {wallet.archived ? 'Bring this wallet back from the archive' : 'Archive this wallet'}
      </button>
    </div>
  );
}

function RenameView({ wallet, onBack, onClose }: { wallet: Wallet; onBack(): void; onClose(): void }) {
  const { state } = useLedger();
  const save = useWalletSave(onClose);
  const [name, setName] = useState(wallet.name);
  const [tried, setTried] = useState(false);
  const trimmed = name.trim();
  const dup = state.wallets.some((w) => w.id !== wallet.id && w.name.trim().toLowerCase() === trimmed.toLowerCase());
  const error = tried ? (trimmed === '' ? 'Give the wallet a name.' : dup ? 'You already have a wallet with that name.' : null) : null;
  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (trimmed === '' || dup) return;
        const entry: WalletUpdateEntry = { id: uuidv7(), kind: 'wallet-update', wallet: wallet.id, name: trimmed, at: nowInstant(Date.now()), tz: state.settings.timeZone };
        void save(entry, 'Renamed.');
      }}
    >
      <BackLink onClick={onBack} />
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" error={error} />
      <Button type="submit" variant="primary" className="min-h-14 rounded-[18px] text-[17px]">
        Save name
      </Button>
    </form>
  );
}

function ProofView({ wallet, onBack, onClose }: { wallet: Wallet; onBack(): void; onClose(): void }) {
  const { entries, state } = useLedger();
  const save = useWalletSave(onClose);
  const [proof, setProof] = useState(wallet.defaultProof);
  const head = useMemo(() => entries.find((e): e is WalletEntry => e.kind === 'wallet' && e.wallet === wallet.id && state.applied.includes(e.id)), [entries, state.applied, wallet.id]);
  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (head === undefined) return;
        const entry: WalletEntry = { ...head, id: uuidv7(), defaultProof: proof.trim(), replaces: head.id, reason: 'Changed where the proof usually is' };
        void save(entry, 'Saved.');
      }}
    >
      <BackLink onClick={onBack} />
      <TextField label="Where proof usually is" value={proof} onChange={(e) => setProof(e.target.value)} hint="New purchases and receives in this wallet start with this. Coins already logged keep theirs." autoComplete="off" />
      <Button type="submit" variant="primary" disabled={head === undefined} className="min-h-14 rounded-[18px] text-[17px]">
        Save
      </Button>
    </form>
  );
}

function ArchiveView({ wallet, holdingSats, onBack, onClose }: { wallet: Wallet; holdingSats: number; onBack(): void; onClose(): void }) {
  const { state } = useLedger();
  const save = useWalletSave(onClose);
  const restoring = wallet.archived;
  const blocked = !restoring && holdingSats > 0;
  return (
    <div className="flex flex-col gap-4 pb-2">
      <BackLink onClick={onBack} />
      {blocked ? (
        <Callout title="It still holds coins">
          <Amount sats={holdingSats} interactive={false} showUnit /> is in {wallet.name}. Move or sell the coins first, then archive it.
        </Callout>
      ) : (
        <Callout>{restoring ? `${wallet.name} will show in your wallets again.` : `${wallet.name} will be hidden from your wallet list. Its history stays in your records, and you can bring it back any time.`}</Callout>
      )}
      <Button
        variant="primary"
        disabled={blocked}
        className="min-h-14 rounded-[18px] text-[17px]"
        onClick={() => {
          const entry: WalletUpdateEntry = { id: uuidv7(), kind: 'wallet-update', wallet: wallet.id, archived: !restoring, at: nowInstant(Date.now()), tz: state.settings.timeZone };
          void save(entry, restoring ? 'Brought back.' : 'Archived.');
        }}
      >
        {restoring ? 'Bring it back' : 'Archive wallet'}
      </Button>
    </div>
  );
}

function FreezeView({ wallet, onBack, onClose }: { wallet: Wallet; onBack(): void; onClose(): void }) {
  const { tz, nowMs, today } = useFormEnv();
  const [id] = useState(() => uuidv7());
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Draft | null>(null);
  const at = date === '' ? null : localDate(nowInstant(nowMs), tz) === date ? nowInstant(nowMs) : noonOn(date, tz);
  function review() {
    if (at === null) return;
    const entry: WalletFreezeEntry = { id, kind: 'wallet-freeze', wallet: wallet.id, at, tz };
    setDraft({
      title: 'Mark as frozen',
      saveLabel: 'Mark frozen',
      savedMessage: 'Marked frozen.',
      rows: [
        { label: 'Wallet', value: wallet.name },
        { label: 'Withdrawals stopped', value: longDate(date) },
      ],
      extra: <Callout>A frozen wallet keeps its coins and cost, but they are not counted in what your Bitcoin is worth, and nothing can be sold or moved from it. Later you can log payouts and close it out to record the loss.</Callout>,
      build: () => [entry],
    });
  }
  if (draft !== null) return <Review draft={draft} onBack={() => setDraft(null)} onSaved={onClose} />;
  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      <BackLink onClick={onBack} />
      <TextField label="When did withdrawals stop?" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={at === null ? 'Pick a date.' : null} />
      <Button type="submit" variant="primary" className="min-h-14 rounded-[18px] text-[17px]">
        Review
      </Button>
    </form>
  );
}

function LostView({ wallet, onBack, onClose }: { wallet: Wallet; onBack(): void; onClose(): void }) {
  const { entries, state, nowMs, tz, today } = useFormEnv();
  const [id] = useState(() => uuidv7());
  const [when, setWhen] = useState(() => localInputFor(nowInstant(nowMs), tz));
  const at = zonedInstant(when, tz);
  const amount = useAmount(null, null);
  const sats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const [cause, setCause] = useState<LostCause>('lost-keys');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<PickMode>('oldest');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const available = useMemo(() => (at === null ? [] : lotsAvailable(state, entries, wallet.id, at)), [state, entries, wallet.id, at]);
  const picks = choosePicks(available, sats, mode, chosen);
  const onDate = at === null ? today : localDate(at, tz);
  const errors = { when: at === null ? 'Pick a date and time.' : null, amount: sats === null ? 'Enter how much was lost.' : null, picks: sats !== null && picks === null ? 'Choose coins that add up to the amount.' : null };

  function review() {
    setTried(true);
    if (at === null || sats === null || picks === null) return;
    const entry: LostEntry = { id, kind: 'lost', at, tz, wallet: wallet.id, sats, cause, picks, ...(note.trim() === '' ? {} : { note: note.trim() }) };
    setDraft({
      title: 'Review lost coins',
      saveLabel: 'Save',
      savedMessage: 'Saved. Flagged for your CPA.',
      rows: [
        { label: 'Lost', value: <Amount sats={sats} interactive={false} showUnit /> },
        { label: 'What happened', value: CAUSES.find((c) => c.value === cause)?.label ?? '' },
        { label: 'When', value: whenLabel(at, tz) },
        { label: 'Wallet', value: wallet.name },
      ],
      coins: { picks, lots: available, onDate },
      build: () => [entry],
    });
  }
  if (draft !== null) return <Review draft={draft} onBack={() => setDraft(null)} onSaved={onClose} />;
  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      <BackLink onClick={onBack} />
      <AmountInput amount={amount} label="How much was lost or stolen" error={tried ? errors.amount : null} />
      <SelectField label="What happened" value={cause} onChange={(e) => setCause(e.target.value as LostCause)} options={CAUSES} />
      <WhenField value={when} onChange={setWhen} label="When" error={tried ? errors.when : null} />
      <CoinPicker lots={available} needed={sats} mode={mode} onMode={setMode} chosen={chosen} onChosen={setChosen} picks={picks} onDate={onDate} today={today} />
      {tried && errors.picks ? (
        <p role="alert" className="m-0 text-xs text-loss">
          {errors.picks}
        </p>
      ) : null}
      <TextAreaField label="What you know (optional)" value={note} onChange={(e) => setNote(e.target.value)} hint="No deduction is recorded. This entry is flagged for your CPA." />
      <FormFooter>
        <Button type="submit" variant="primary" className="min-h-14 flex-1 rounded-[18px] text-[17px]">
          Review
        </Button>
      </FormFooter>
    </form>
  );
}
