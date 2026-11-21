import { localDate, picksAfterMove, uuidv7, type Entry, type MoveEntry } from '@bitcoin-basis/engine';
import { useSaving } from './saving.ts';
import { useMemo, useState } from 'react';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { ErrorLine, Callout, TextField } from '../../ui/form-fields.tsx';
import { CoinPicker } from './CoinPicker.tsx';
import type { FormProps } from './draft.ts';
import { stripSource, useAmount, useBaseState, useFormEnv, usePriceAt, useValue, withSource } from './hooks.ts';
import { choosePicks, cleanNumber, localInputFor, lotsAvailable, nowInstant, usableWallets, usualWallet, whenLabel, zonedInstant, type PickMode } from './model.ts';
import { AmountInput, FormFooter, MoreDetails, ValueField, WalletSelect, WhenField } from './parts.tsx';
import { focusFirstError } from './first-error.ts';

export function MoveForm({ initial, preset, onReview }: FormProps) {
  const saving = useSaving();
  const { entries, state: ledgerState, today, nowMs, tz } = useFormEnv();
  const edit = initial?.kind === 'move' ? initial : null;
  const state = useBaseState(edit);
  const thenSell = preset.move?.thenSell === true;
  const [id] = useState(() => uuidv7());
  const [when, setWhen] = useState(() => localInputFor(edit?.at ?? nowInstant(nowMs), tz));
  const at = zonedInstant(when, tz);
  const price = usePriceAt(at, nowMs);
  const amount = useAmount(edit?.sats ?? preset.move?.sats ?? preset.sats ?? null, price.cents);
  const sats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const [from, setFrom] = useState(edit?.from ?? preset.move?.from ?? preset.wallet ?? usualWallet(entries, ledgerState, ['move', 'sell', 'buy']));
  const destinations = usableWallets(state, edit?.to).filter((x) => x.id !== from && (!thenSell || x.type === 'exchange'));
  const [to, setTo] = useState(edit?.to ?? destinations[0]?.id ?? '');
  const [feeText, setFeeText] = useState(edit ? String(edit.feeSats) : '');
  const [note, setNote] = useState(stripSource(edit?.note));
  const feeSats = feeText.trim() === '' ? 0 : /^\d+$/.test(cleanNumber(feeText)) ? Number(cleanNumber(feeText)) : null;
  const fee = useValue(feeSats !== null && feeSats > 0 ? feeSats : null, price, edit && edit.feeSats > 0 ? edit.feeValueCents : null);
  const [mode, setMode] = useState<PickMode>(edit || preset.move ? 'hand' : 'oldest');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(edit ? edit.picks.map((p) => p.lotId) : (preset.move?.lotIds ?? [])));
  const [tried, setTried] = useState(false);
  const [more, setMore] = useState(edit !== null || preset.move !== undefined);

  const fromW = state.wallets.find((x) => x.id === from);
  const toW = state.wallets.find((x) => x.id === to);
  const available = useMemo(() => (at === null ? [] : lotsAvailable(state, entries, from, at)), [state, entries, from, at]);
  const total = sats !== null && feeSats !== null ? sats + feeSats : null;
  const picks = choosePicks(available, total, mode, chosen);
  const onDate = at === null ? today : localDate(at, tz);
  const feeValue = feeSats === 0 ? 0 : fee.cents;

  const errors = {
    when: at === null ? 'Pick a date and time.' : null,
    from: fromW === undefined ? 'Choose where it moves from.' : null,
    to: toW === undefined ? 'Choose where it moves to.' : null,
    amount: sats === null ? 'Enter how much you moved.' : null,
    fee: feeSats === null ? 'Enter the fee as whole sats, like 2000.' : null,
    feeValue: feeSats !== null && feeSats > 0 && feeValue === null ? 'Enter what the fee was worth in dollars.' : null,
    picks: total !== null && picks === null ? 'Pick lots that add up to the amount and fee.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function review() {
    setTried(true);
    if (errors.picks !== null) setMore(true);
    if (!valid || at === null || sats === null || feeSats === null || feeValue === null || picks === null || fromW === undefined || toW === undefined) return;
    const entry: MoveEntry = {
      id,
      kind: 'move',
      at,
      tz,
      from,
      to,
      sats,
      feeSats,
      feeValueCents: feeValue,
      picks,
      ...(note.trim() === '' && feeSats === 0 ? {} : { note: withSource(note, feeSats > 0 ? fee.sourceNote : '') }),
    };
    onReview({
      title: 'Review move',
      saveLabel: thenSell ? 'Save move, then sell' : 'Save move',
      savedMessage: 'Move saved.',
      direct: edit === null,
      rows: [
        { label: 'Arrives', value: <Amount sats={sats} interactive={false} showUnit /> },
        { label: 'From', value: fromW.name },
        { label: 'To', value: toW.name },
        { label: 'Network fee', value: feeSats === 0 ? 'None' : <><Amount sats={feeSats} interactive={false} showUnit /> (<Money cents={feeValue} />)</> },
        { label: 'When', value: whenLabel(at, tz, nowMs) },
      ],
      coins: { picks, lots: available, onDate },
      build: () => [entry],
      ...(thenSell
        ? {
            afterSave: ([m]: readonly Entry[]) => {
              const mv = m as MoveEntry;
              return { next: { kind: 'sell' as const, preset: { sell: { wallet: mv.to, sats: mv.sats, lotIds: picksAfterMove(mv.id, mv.picks, mv.sats).map((p) => p.lotId) } } } };
            },
          }
        : {}),
    });
  }

  const noDestination = destinations.length === 0;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        review();
        focusFirstError(e.currentTarget);
      }}
    >
      {thenSell ? <Callout title="Preparing a sale">Coins in a self-custody wallet cannot be sold directly. Move exactly these coins to an exchange first. Then you will log the sale from there.</Callout> : null}
      <AmountInput amount={amount} label="Amount that arrives" error={tried ? errors.amount : null} />
      <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
        <WalletSelect
          label="From"
          value={from}
          onChange={(v) => {
            setFrom(v);
            setChosen(new Set());
            if (v === to) setTo('');
          }}
          wallets={usableWallets(state, edit?.from)}
          canAdd={false}
          error={tried ? errors.from : null}
        />
        <WalletSelect label={thenSell ? 'To (an exchange)' : 'To'} value={to} onChange={setTo} wallets={destinations} error={tried ? errors.to : null} />
      </div>
      {noDestination ? <Callout>You need a second wallet to move coins to. Choose &ldquo;Add a wallet&rdquo; in the To list.</Callout> : null}
      <WhenField value={when} onChange={setWhen} error={tried ? errors.when : null} />
      <TextField label="Network fee in sats (optional)" inputMode="numeric" autoComplete="off" placeholder="0" value={feeText} onChange={(e) => setFeeText(e.target.value)} error={tried ? errors.fee : null} hint="Taken from the same wallet, on top of the amount." />
      {feeSats !== null && feeSats > 0 ? <ValueField label="Fee worth in dollars" value={fee} price={price} error={tried ? errors.feeValue : null} /> : null}
      <MoreDetails open={more} onOpenChange={setMore}>
        <CoinPicker lots={available} needed={total} mode={mode} onMode={setMode} chosen={chosen} onChosen={setChosen} picks={picks} onDate={onDate} today={today} walletName={fromW?.name ?? 'this wallet'} />
        <ErrorLine error={tried && errors.picks} className="block" />
        <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
      </MoreDetails>
      <FormFooter>
        <Button type="submit" variant="primary" disabled={saving} className="min-h-14 flex-1 rounded-[18px] text-[17px] shadow-[0_10px_30px_rgba(247,147,26,0.35)]">
          {saving ? 'Saving…' : edit === null ? (thenSell ? 'Save move, then sell' : 'Save move') : 'Review change'}
        </Button>
      </FormFooter>
    </form>
  );
}
