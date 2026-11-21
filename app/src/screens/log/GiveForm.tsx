import { localDate, satsGivenBelowCost, uuidv7, type GiveEntry } from '@bitcoin-basis/engine';
import { useMemo, useState } from 'react';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Toggle } from '../../ui/Field.tsx';
import { ErrorLine, TextField } from '../../ui/form-fields.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { BuyToGiveForm, lastGiftWasBoughtToGive } from './BuyToGive.tsx';
import { CoinPicker } from './CoinPicker.tsx';
import type { FormProps } from './draft.ts';
import { stripSource, useAmount, useBaseState, useFormEnv, usePriceAt, useValue, withSource } from './hooks.ts';
import { choosePicks, keepSavedPicks, localInputFor, lotsAvailable, nowInstant, usableWallets, usualWallet, whenLabel, zonedInstant, type PickMode } from './model.ts';
import { AmountInput, FormFooter, MoreDetails, ValueField, WalletSelect, WhenField } from './parts.tsx';
import { focusFirstError } from './first-error.ts';

export type GiftTo = 'person' | 'charity';

/** What both ways of logging a gift share, so flipping "I bought it to give" keeps what was typed. */
export interface GiftShared {
  to: GiftTo;
  recipient: string;
  setRecipient(v: string): void;
  when: string;
  setWhen(v: string): void;
  wallet: string;
  setWallet(v: string): void;
  note: string;
  setNote(v: string): void;
  more: boolean;
  setMore(v: boolean): void;
}

/** The Gave tab: a gift from coins already held, or (switched on) a purchase made for the gift and the gift, saved together. */
export function GiveForm(props: FormProps) {
  const { initial, preset } = props;
  const { entries, state, nowMs, tz } = useFormEnv();
  const edit = initial?.kind === 'give' ? initial : null;
  const [to, setTo] = useState<GiftTo>(edit?.to ?? 'person');
  const [recipient, setRecipient] = useState(edit?.recipient ?? '');
  const [when, setWhen] = useState(() => localInputFor(edit?.at ?? nowInstant(nowMs), tz));
  const [wallet, setWallet] = useState(edit?.wallet ?? preset.wallet ?? usualWallet(entries, state, ['give', 'buy']));
  const [note, setNote] = useState(stripSource(edit?.note));
  const [more, setMore] = useState(note !== '');
  // Starts on when the last gift was bought for the occasion (the usual routine); a wallet's own Gave starts off.
  const [bought, setBought] = useState(() => edit === null && preset.wallet === undefined && lastGiftWasBoughtToGive(entries, state));
  const shared: GiftShared = { to, recipient, setRecipient, when, setWhen, wallet, setWallet, note, setNote, more, setMore };

  const top = (
    <>
      <Segmented<GiftTo>
        label="Who it went to"
        value={to}
        onChange={setTo}
        options={[
          { value: 'person', label: 'A person' },
          { value: 'charity', label: 'A charity or church' },
        ]}
      />
      {edit === null ? (
        <div className="rounded-2xl border border-line px-3.5 py-1">
          <Toggle label="I bought it to give" hint="Logs the purchase and the gift together." checked={bought} onChange={setBought} />
        </div>
      ) : null}
    </>
  );
  // The choices above stay mounted when the switch flips, so focus stays on the switch.
  return (
    <div className="flex flex-col gap-4">
      {top}
      {bought && edit === null ? <BuyToGiveForm shared={shared} onReview={props.onReview} /> : <GiftFromHoldings {...props} shared={shared} />}
    </div>
  );
}

/** A gift of coins already held: lowest-cost lots first, from the sending wallet. */
function GiftFromHoldings({ initial, onReview, shared }: FormProps & { shared: GiftShared }) {
  const { entries, today, nowMs, tz } = useFormEnv();
  const edit = initial?.kind === 'give' ? initial : null;
  const state = useBaseState(edit);
  const [id] = useState(() => uuidv7());
  const { to, recipient, setRecipient, when, setWhen, wallet, setWallet, note, setNote, more, setMore } = shared;
  const at = zonedInstant(when, tz);
  const price = usePriceAt(at, nowMs);
  const amount = useAmount(edit?.sats ?? null, price.cents);
  const sats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const value = useValue(sats, price, edit ? edit.valueCents : null);
  const [mode, setMode] = useState<PickMode>(edit ? 'hand' : 'lowest-cost');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(edit ? edit.picks.map((p) => p.lotId) : []));
  const [tried, setTried] = useState(false);

  const w = state.wallets.find((x) => x.id === wallet);
  const available = useMemo(() => (at === null ? [] : lotsAvailable(state, entries, wallet, at)), [state, entries, wallet, at]);
  // An edit that keeps the amount and the lots keeps its saved split exactly.
  const picks = keepSavedPicks(edit?.picks, edit?.sats, sats, mode, chosen) ?? choosePicks(available, sats, mode, chosen, 'lowest-cost');
  const onDate = at === null ? today : localDate(at, tz);
  const belowCost = picks === null || sats === null || value.cents === null ? 0 : satsGivenBelowCost(available, picks, sats, value.cents);

  const errors = {
    when: at === null ? 'Pick a date and time.' : null,
    wallet: w === undefined ? 'Choose a wallet.' : null,
    recipient: recipient.trim() === '' ? (to === 'person' ? 'Who is it for? A first name is enough.' : 'Enter the name of the charity or church.') : null,
    amount: sats === null ? 'Enter how much you gave.' : null,
    value: value.cents === null ? 'Enter what it was worth.' : null,
    picks: sats !== null && picks === null ? 'Pick lots that add up to the amount.' : null,
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
      <AmountInput amount={amount} error={tried ? errors.amount : null} needsPrice />
      <WalletSelect
        label="From wallet"
        value={wallet}
        onChange={(v) => {
          setWallet(v);
          setChosen(new Set());
        }}
        wallets={usableWallets(state, edit?.wallet)}
        canAdd={false}
        error={tried ? errors.wallet : null}
      />
      <ValueField label="Worth that day" value={value} price={price} error={tried ? errors.value : null} hasAmount={sats !== null} />
      <WhenField value={when} onChange={setWhen} error={tried ? errors.when : null} />
      <TextField label={to === 'person' ? 'Who is it for?' : 'Charity or church'} value={recipient} onChange={(e) => setRecipient(e.target.value)} autoComplete="off" error={tried ? errors.recipient : null} />
      <CoinPicker lots={available} needed={sats} mode={mode} onMode={setMode} chosen={chosen} onChosen={setChosen} picks={picks} onDate={onDate} today={today} walletName={w?.name ?? 'this wallet'} auto="lowest-cost" belowCostSats={belowCost} />
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
