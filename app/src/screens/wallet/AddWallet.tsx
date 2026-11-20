import { uuidv7, type WalletEntry, type WalletType } from '@bitcoin-basis/engine';
import { useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Button } from '../../ui/Button.tsx';
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
  retirement: 'Account statement',
};

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
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const trimmed = name.trim();
  const duplicate = state.wallets.some((w) => w.name.trim().toLowerCase() === trimmed.toLowerCase());
  const error = !tried ? null : trimmed === '' ? 'Give the wallet a name.' : duplicate ? 'You already have a wallet with that name.' : null;

  async function save() {
    setTried(true);
    if (trimmed === '' || duplicate) return;
    setBusy(true);
    const id = `${slug(trimmed) || 'wallet'}-${uuidv7().slice(-6)}`;
    const entry: WalletEntry = { id: uuidv7(), kind: 'wallet', wallet: id, name: trimmed, type, defaultProof: proof ?? DEFAULT_PROOF[type], at: nowInstant(Date.now()), tz: state.settings.timeZone };
    await append([entry]);
    toast.show(`${trimmed} added.`);
    onAdded?.(id);
    onClose();
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
      <TextField label="Where the proof usually is" value={proof ?? DEFAULT_PROOF[type]} onChange={(e) => setProof(e.target.value)} hint="New purchases here will start with this." autoComplete="off" />
      <Button type="submit" variant="primary" disabled={busy} className="min-h-14 rounded-[18px] text-[17px]">
        Add wallet
      </Button>
    </form>
  );
}
