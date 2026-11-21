import { uuidv7, type WalletEntry, type WalletType } from '@bitcoin-basis/engine';
import { useSubmit } from '../../ui/use-submit.ts';
import { useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Button } from '../../ui/Button.tsx';
import { PlusIcon } from '../../ui/icons.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { TextField } from '../../ui/form-fields.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { nowInstant } from '../log/model.ts';

const TYPE_OPTIONS: readonly { value: WalletType; label: string }[] = [
  { value: 'exchange', label: 'Exchange' },
  { value: 'self-custody', label: 'Self-custody' },
  { value: 'retirement', label: 'Retirement' },
];

export const DEFAULT_PROOF: Record<WalletType, string> = {
  exchange: 'Email receipt',
  'self-custody': 'Wallet export',
  retirement: 'Bank statement',
};

const PROOF_CHIPS = ['Email receipt', 'Exchange export', 'Bank statement'] as const;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

/** Add a wallet: name, type and where the proof usually is. */
export function AddWalletSheet({ open, onClose, onAdded }: { open: boolean; onClose(): void; onAdded?(id: string): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a wallet">
      <AddWalletForm onClose={onClose} {...(onAdded === undefined ? {} : { onAdded })} />
    </Sheet>
  );
}

function AddWalletForm({ onClose, onAdded }: { onClose(): void; onAdded?(id: string): void }) {
  const { append, state } = useLedger();
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<WalletType>('exchange');
  const [chip, setChip] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const trimmed = name.trim();
  const fallback = DEFAULT_PROOF[type];
  const picked = chip ?? ((PROOF_CHIPS as readonly string[]).includes(fallback) ? fallback : 'Other');
  const otherText = other ?? (picked === 'Other' && !(PROOF_CHIPS as readonly string[]).includes(fallback) ? fallback : '');
  const proof = picked === 'Other' ? otherText.trim() : picked;
  const duplicate = state.wallets.some((w) => w.name.trim().toLowerCase() === trimmed.toLowerCase());
  const error = !tried ? null : trimmed === '' ? 'Give the wallet a name.' : duplicate ? 'You already have a wallet with that name.' : null;

  const submit = useSubmit(async () => {
    const id = `${slug(trimmed) || 'wallet'}-${uuidv7().slice(-6)}`;
    const entry: WalletEntry = { id: uuidv7(), kind: 'wallet', wallet: id, name: trimmed, type, defaultProof: proof, at: nowInstant(Date.now()), tz: state.settings.timeZone };
    await append([entry]);
    toast.show(`${trimmed} added.`, { success: true });
    onAdded?.(id);
    onClose();
  });
  const busy = submit.busy;
  function save() {
    setTried(true);
    if (trimmed === '' || duplicate) return;
    void submit.run();
  }

  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Strike, Ledger, my IRA" autoComplete="off" error={error} />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">What kind</span>
        <Segmented<WalletType> label="What kind of wallet" value={type} onChange={setType} options={TYPE_OPTIONS} />
        {type === 'retirement' ? <span className="text-xs text-muted">Retirement wallets only keep a balance note. They are never part of tax math.</span> : null}
      </div>
      <div role="group" aria-labelledby="proof-q" className="flex flex-col gap-1.5">
        <span id="proof-q" className="text-xs text-muted">
          Where are the receipts for this wallet?
        </span>
        <div className="flex flex-wrap gap-2">
          {[...PROOF_CHIPS, 'Other'].map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={picked === c}
              onClick={() => setChip(c)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${picked === c ? 'border-accent bg-accent/12 text-amber' : 'border-line bg-bg text-soft hover:text-text'}`}
            >
              {c}
            </button>
          ))}
        </div>
        {picked === 'Other' ? <TextField label="Where" value={otherText} onChange={(e) => setOther(e.target.value)} autoComplete="off" hint="New purchases here will start with this." /> : null}
      </div>
      <Button type="submit" variant="primary" disabled={busy} className="min-h-14 rounded-[18px] text-[17px]">
        {busy ? 'Saving…' : 'Add wallet'}
      </Button>
    </form>
  );
}

/** A standalone "Add a wallet" button that opens the sheet. */
export function AddWalletButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} {...(className === undefined ? {} : { className })}>
        <PlusIcon size={16} />
        Add a wallet
      </Button>
      <AddWalletSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
