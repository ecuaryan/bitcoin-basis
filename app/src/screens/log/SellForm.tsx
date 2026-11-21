import { canSellFrom, localDate, uuidv7, type SellEntry } from '@bitcoin-basis/engine';
import { useMemo, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { ErrorLine, Callout, TextField } from '../../ui/form-fields.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { CoinPicker } from './CoinPicker.tsx';
import type { FormProps } from './draft.ts';
import { stripSource, useAmount, useBaseState, useFormEnv, usePriceAt, useValue, withSource } from './hooks.ts';
import { choosePicks, localInputFor, lotsAvailable, nowInstant, usableWallets, usualWallet, zonedInstant, type PickMode } from './model.ts';
import { saleDraft } from './sale-review.tsx';
import { AmountInput, FormFooter, MoreDetails, ValueField, WalletSelect, WhenField } from './parts.tsx';

type How = 'sold' | 'spent';

export function SellForm({ initial, preset, onReview, onSwitch }: FormProps) {
  const { entries, state: ledgerState, today, nowMs, tz } = useFormEnv();
  const edit = initial?.kind === 'sell' ? initial : null;
  const state = useBaseState(edit);
  const [id] = useState(() => uuidv7());
  const [how, setHow] = useState<How>(edit?.spent === true ? 'spent' : 'sold');
  const [when, setWhen] = useState(() => localInputFor(edit?.at ?? nowInstant(nowMs), tz));
  const at = zonedInstant(when, tz);
  const price = usePriceAt(at, nowMs);
  const amount = useAmount(edit?.sats ?? preset.sell?.sats ?? preset.sats ?? null, price.cents);
  const sats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const [wallet, setWallet] = useState(edit?.wallet ?? preset.sell?.wallet ?? preset.wallet ?? usualWallet(entries, ledgerState, ['sell', 'buy']));
  const [description, setDescription] = useState(edit?.description ?? '');
  const value = useValue(sats, price, edit ? edit.proceedsCents : null);
  const [note, setNote] = useState(stripSource(edit?.note));
  const [mode, setMode] = useState<PickMode>(edit || preset.sell ? 'hand' : 'oldest');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(edit ? edit.picks.map((p) => p.lotId) : (preset.sell?.lotIds ?? [])));
  const [tried, setTried] = useState(false);
  const [more, setMore] = useState(note !== '');

  const w = state.wallets.find((x) => x.id === wallet);
  const available = useMemo(() => (at === null ? [] : lotsAvailable(state, entries, wallet, at)), [state, entries, wallet, at]);
  const picks = choosePicks(available, sats, mode, chosen);
  const onDate = at === null ? today : localDate(at, tz);
  const refusal = how === 'sold' && w !== undefined ? canSellFrom(w) : null;
  const mustPrepare = refusal !== null && !refusal.ok && refusal.error.code === 'prepare-sale';

  const errors = {
    when: at === null ? 'Pick a date and time.' : null,
    wallet: w === undefined ? 'Choose a wallet.' : null,
    amount: sats === null ? 'Enter how much you sold.' : null,
    value: value.cents === null ? (how === 'sold' ? 'Enter the dollars you received.' : 'Enter what it was worth.') : null,
    what: how === 'spent' && description.trim() === '' ? 'Say what it bought.' : null,
    picks: sats !== null && picks === null ? 'Choose coins that add up to the amount.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function prepare() {
    if (sats === null || picks === null) {
      setTried(true);
      return;
    }
    onSwitch('move', { move: { from: wallet, sats, lotIds: picks.map((p) => p.lotId), thenSell: true } });
  }

  function review() {
    setTried(true);
    if (mustPrepare || !valid || at === null || sats === null || value.cents === null || picks === null || w === undefined) return;
    const spent = how === 'spent';
    const entry: SellEntry = {
      id,
      kind: 'sell',
      at,
      tz,
      wallet,
      sats,
      proceedsCents: value.cents,
      picks,
      spent,
      ...(spent ? { description: description.trim() } : {}),
      note: withSource(note, value.sourceNote),
    };
    onReview(saleDraft({ entry, walletName: w.name, lots: available, onDate, nowMs }));
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      <Segmented<How>
        label="Sold or spent"
        value={how}
        onChange={setHow}
        options={[
          { value: 'sold', label: 'Sold for dollars' },
          { value: 'spent', label: 'Spent on something' },
        ]}
      />
      <AmountInput amount={amount} error={tried ? errors.amount : null} needsPrice />
      <WalletSelect label="From wallet" value={wallet} onChange={(v) => { setWallet(v); setChosen(new Set()); }} wallets={usableWallets(state, edit?.wallet)} error={tried ? errors.wallet : null} />
      <ValueField label={how === 'sold' ? 'Dollars you received' : 'Worth in dollars when spent'} value={value} price={price} error={tried ? errors.value : null} hasAmount={sats !== null} />
      <WhenField value={when} onChange={setWhen} error={tried ? errors.when : null} />
      {how === 'spent' ? <TextField label="What did it buy?" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Groceries, a laptop, a donation receipt" autoComplete="off" error={tried ? errors.what : null} /> : null}
      {mustPrepare ? (
        <Callout tone="warn" title="Coins in self-custody cannot be sold directly">
          <p className="m-0 mb-2">Move exactly the coins you want to sell to an exchange first. Then sell them there. This keeps your records straight.</p>
          <Button variant="secondary" onClick={prepare} className="w-full">
            Prepare a sale
          </Button>
        </Callout>
      ) : null}
      <CoinPicker lots={available} needed={sats} mode={mode} onMode={setMode} chosen={chosen} onChosen={setChosen} picks={picks} onDate={onDate} today={today} walletName={w?.name ?? 'this wallet'} />
      <ErrorLine error={tried && errors.picks} className="block" />
      <MoreDetails open={more} onOpenChange={setMore}>
        <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
      </MoreDetails>
      <FormFooter>
        <Button type="submit" variant="primary" disabled={mustPrepare} className="min-h-14 flex-1 rounded-[18px] text-[17px] shadow-[0_10px_30px_rgba(247,147,26,0.35)]">
          {how === 'sold' ? 'Review sale' : 'Review spending'}
        </Button>
      </FormFooter>
    </form>
  );
}
