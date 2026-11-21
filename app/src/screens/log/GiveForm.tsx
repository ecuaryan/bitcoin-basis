import { localDate, uuidv7, type GiveEntry } from '@bitcoin-basis/engine';
import { useMemo, useState } from 'react';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { ErrorLine, TextField } from '../../ui/form-fields.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { CoinPicker } from './CoinPicker.tsx';
import type { FormProps } from './draft.ts';
import { stripSource, useAmount, useBaseState, useFormEnv, usePriceAt, useValue, withSource } from './hooks.ts';
import { choosePicks, localInputFor, lotsAvailable, nowInstant, usableWallets, usualWallet, whenLabel, zonedInstant, type PickMode } from './model.ts';
import { AmountInput, FormFooter, MoreDetails, ValueField, WalletSelect, WhenField } from './parts.tsx';
import { focusFirstError } from './first-error.ts';

type To = 'person' | 'charity';

export function GiveForm({ initial, preset, onReview }: FormProps) {
  const { entries, state: ledgerState, today, nowMs, tz } = useFormEnv();
  const edit = initial?.kind === 'give' ? initial : null;
  const state = useBaseState(edit);
  const [id] = useState(() => uuidv7());
  const [to, setTo] = useState<To>(edit?.to ?? 'person');
  const [recipient, setRecipient] = useState(edit?.recipient ?? '');
  const [when, setWhen] = useState(() => localInputFor(edit?.at ?? nowInstant(nowMs), tz));
  const at = zonedInstant(when, tz);
  const price = usePriceAt(at, nowMs);
  const amount = useAmount(edit?.sats ?? null, price.cents);
  const sats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const [wallet, setWallet] = useState(edit?.wallet ?? preset.wallet ?? usualWallet(entries, ledgerState, ['give', 'buy']));
  const value = useValue(sats, price, edit ? edit.valueCents : null);
  const [note, setNote] = useState(stripSource(edit?.note));
  const [mode, setMode] = useState<PickMode>(edit ? 'hand' : 'oldest');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(edit ? edit.picks.map((p) => p.lotId) : []));
  const [tried, setTried] = useState(false);
  const [more, setMore] = useState(note !== '');

  const w = state.wallets.find((x) => x.id === wallet);
  const available = useMemo(() => (at === null ? [] : lotsAvailable(state, entries, wallet, at)), [state, entries, wallet, at]);
  const picks = choosePicks(available, sats, mode, chosen);
  const onDate = at === null ? today : localDate(at, tz);

  const errors = {
    when: at === null ? 'Pick a date and time.' : null,
    wallet: w === undefined ? 'Choose a wallet.' : null,
    recipient: recipient.trim() === '' ? (to === 'person' ? 'Who is it for? A first name is enough.' : 'Enter the name of the charity or church.') : null,
    amount: sats === null ? 'Enter how much you gave.' : null,
    value: value.cents === null ? 'Enter what it was worth.' : null,
    picks: sats !== null && picks === null ? 'Choose coins that add up to the amount.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function review() {
    setTried(true);
    if (!valid || at === null || sats === null || value.cents === null || picks === null || w === undefined) return;
    const entry: GiveEntry = { id, kind: 'give', at, tz, wallet, sats, valueCents: value.cents, to, recipient: recipient.trim(), picks, note: withSource(note, value.sourceNote) };
    onReview({
      title: to === 'person' ? 'Review gift' : 'Review gift to charity',
      saveLabel: 'Save gift',
      savedMessage: 'Gift saved.',
      rows: [
        { label: 'Gave', value: <Amount sats={sats} interactive={false} showUnit /> },
        { label: 'To', value: to === 'person' ? recipient.trim() : `${recipient.trim()} (charity)` },
        { label: 'Worth that day', value: <Money cents={value.cents} /> },
        { label: 'From', value: w.name },
        { label: 'When', value: whenLabel(at, tz, nowMs) },
      ],
      coins: { picks, lots: available, onDate },
      build: () => [entry],
      ...(to === 'person' ? { afterSave: () => ({ giftNote: id }) } : {}),
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        review();
        focusFirstError(e.currentTarget);
      }}
    >
      <Segmented<To>
        label="Who it went to"
        value={to}
        onChange={setTo}
        options={[
          { value: 'person', label: 'A person' },
          { value: 'charity', label: 'A charity or church' },
        ]}
      />
      <AmountInput amount={amount} error={tried ? errors.amount : null} needsPrice />
      <WalletSelect label="From wallet" value={wallet} onChange={(v) => { setWallet(v); setChosen(new Set()); }} wallets={usableWallets(state, edit?.wallet)} canAdd={false} error={tried ? errors.wallet : null} />
      <ValueField label="Worth that day" value={value} price={price} error={tried ? errors.value : null} hasAmount={sats !== null} />
      <WhenField value={when} onChange={setWhen} error={tried ? errors.when : null} />
      <TextField label={to === 'person' ? 'Who is it for?' : 'Charity or church'} value={recipient} onChange={(e) => setRecipient(e.target.value)} autoComplete="off" error={tried ? errors.recipient : null} />
      <CoinPicker lots={available} needed={sats} mode={mode} onMode={setMode} chosen={chosen} onChosen={setChosen} picks={picks} onDate={onDate} today={today} walletName={w?.name ?? 'this wallet'} />
      <ErrorLine error={tried && errors.picks} className="block" />
      <MoreDetails open={more} onOpenChange={setMore}>
        <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
      </MoreDetails>
      <FormFooter>
        <Button type="submit" variant="primary" className="min-h-14 flex-1 rounded-[18px] text-[17px] shadow-[0_10px_30px_rgba(247,147,26,0.35)]">
          Review gift
        </Button>
      </FormFooter>
    </form>
  );
}
