import { parseDollars, uuidv7, type ReceiveEntry, type ReceiveSource } from '@bitcoin-basis/engine';
import { useState, type ReactNode } from 'react';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Callout, SelectField, TextField } from '../../ui/form-fields.tsx';
import { MoneyInput } from '../../ui/formatted-inputs.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import type { FormProps } from './draft.ts';
import { stripSource, useAmount, useFormEnv, usePriceAt, useValue, withSource } from './hooks.ts';
import { centsText, cleanNumber, localInputFor, longDate, noonOn, nowInstant, usableWallets, usualWallet, whenLabel, zonedInstant } from './model.ts';
import { AmountInput, FormFooter, ValueField, WalletSelect, WhenField } from './parts.tsx';

type SourceType = ReceiveSource['type'];
const SOURCES: { value: SourceType; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'frozen-payout', label: 'Platform payout' },
  { value: 'gift', label: 'Gift' },
  { value: 'inherited', label: 'Inherited' },
];
const SOURCE_TITLE: Record<SourceType, string> = { income: 'Income', 'frozen-payout': 'Payout from a frozen platform', gift: 'Gift to you', inherited: 'Inherited' };

export function ReceiveForm({ initial, preset, onReview, onSwitch }: FormProps) {
  const { entries, state, nowMs, tz } = useFormEnv();
  const edit = initial?.kind === 'receive' ? initial : null;
  const [id] = useState(() => uuidv7());
  const startSource: SourceType = edit?.source.type ?? (preset.payoutFrom !== undefined ? 'frozen-payout' : (preset.source ?? 'income'));
  const [source, setSource] = useState<SourceType>(startSource);
  const [when, setWhen] = useState(() => localInputFor(edit?.at ?? nowInstant(nowMs), tz));
  const at = zonedInstant(when, tz);
  const price = usePriceAt(at, nowMs);
  const amount = useAmount(edit?.sats ?? preset.sats ?? null, price.cents);
  const sats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const [wallet, setWallet] = useState(edit?.wallet ?? preset.wallet ?? usualWallet(entries, state, ['buy', 'receive']));
  const wallets = usableWallets(state, edit?.wallet);
  const w = state.wallets.find((x) => x.id === wallet);

  const es = edit?.source;
  const [description, setDescription] = useState(es?.type === 'income' ? (es.description ?? '') : '');
  const frozen = state.wallets.filter((x) => x.frozen);
  const [fromWallet, setFromWallet] = useState(es?.type === 'frozen-payout' ? es.fromWallet : (preset.payoutFrom ?? frozen[0]?.id ?? ''));
  const [giverCost, setGiverCost] = useState(es?.type === 'gift' && es.giverCostCents !== undefined ? centsText(es.giverCostCents) : '');
  const [giverDate, setGiverDate] = useState(es?.type === 'gift' && es.giverAcquiredAt !== undefined ? localInputFor(es.giverAcquiredAt, tz).slice(0, 10) : '');
  const [deathDate, setDeathDate] = useState(() => (edit?.source.type === 'inherited' ? localInputFor(edit.at, tz).slice(0, 10) : ''));
  const deathAt = deathDate === '' ? null : noonOn(deathDate, tz);
  const deathPrice = usePriceAt(deathAt, nowMs);

  const value = useValue(sats, price, edit && edit.source.type !== 'inherited' ? edit.valueCents : null);
  const deathValue = useValue(sats, deathPrice, edit?.source.type === 'inherited' ? edit.valueCents : null);
  const [tried, setTried] = useState(false);
  // A platform payout only makes sense once a wallet has been marked frozen (or when editing one that is).
  const sourceOptions = SOURCES.filter((o) => o.value !== 'frozen-payout' || frozen.length > 0 || source === 'frozen-payout');

  const valueCents = source === 'inherited' ? deathValue.cents : value.cents;
  const giverCostCents = giverCost.trim() === '' ? undefined : (parseDollars(cleanNumber(giverCost)) ?? null);
  const giverAt = giverDate === '' ? undefined : (noonOn(giverDate, tz) ?? null);

  const errors = {
    when: at === null ? 'Pick a date and time.' : null,
    amount: sats === null ? 'Enter how much you received.' : null,
    wallet: w === undefined ? 'Choose a wallet.' : null,
    from: source === 'frozen-payout' && !frozen.some((f) => f.id === fromWallet) ? 'Choose the frozen wallet it came from.' : null,
    value: valueCents === null ? (source === 'inherited' ? 'Enter the date of death, or type the value.' : 'Enter what it was worth.') : null,
    giverCost: giverCostCents === null ? 'Enter dollars, like 1,250.00.' : null,
    giverDate: giverAt === null ? 'That date is not valid.' : giverAt !== undefined && at !== null && giverAt !== null && Date.parse(giverAt) > Date.parse(at) ? "The giver's date cannot be after the gift." : null,
  };
  const relevant = (['when', 'amount', 'wallet', 'from', 'value', ...(source === 'gift' ? (['giverCost', 'giverDate'] as const) : [])] as const).map((k) => errors[k]);
  const valid = relevant.every((e) => e === null);

  function review() {
    setTried(true);
    if (!valid || at === null || sats === null || valueCents === null || w === undefined) return;
    let src: ReceiveSource;
    if (source === 'income') src = description.trim() === '' ? { type: 'income' } : { type: 'income', description: description.trim() };
    else if (source === 'frozen-payout') src = { type: 'frozen-payout', fromWallet };
    else if (source === 'inherited') src = { type: 'inherited' };
    else src = { type: 'gift', ...(typeof giverCostCents === 'number' ? { giverCostCents } : {}), ...(typeof giverAt === 'string' ? { giverAcquiredAt: giverAt } : {}) };
    const sourceNote = source === 'inherited' ? `${deathValue.sourceNote}. Value on the date of death, ${longDate(deathDate)}.` : value.sourceNote;
    const entry: ReceiveEntry = {
      id,
      kind: 'receive',
      at,
      tz,
      wallet,
      sats,
      valueCents,
      source: src,
      ...(w.defaultProof.trim() === '' ? {} : { proof: w.defaultProof }),
      note: withSource(stripSource(edit?.note), sourceNote),
    };
    const rows: { label: string; value: ReactNode }[] = [
      { label: 'Received', value: <Amount sats={sats} interactive={false} showUnit /> },
      { label: 'Kind', value: SOURCE_TITLE[source] },
      { label: source === 'inherited' ? 'Value on date of death' : 'Worth when received', value: <Money cents={valueCents} /> },
    ];
    if (source === 'frozen-payout') rows.push({ label: 'From', value: state.wallets.find((x) => x.id === fromWallet)?.name ?? '' });
    if (source === 'gift') {
      rows.push({ label: "Giver's cost", value: typeof giverCostCents === 'number' ? <Money cents={giverCostCents} /> : 'Not known' });
      rows.push({ label: "Giver's date", value: typeof giverAt === 'string' ? longDate(giverDate) : 'Not known' });
    }
    if (source === 'income' && description.trim() !== '') rows.push({ label: 'What for', value: description.trim() });
    rows.push({ label: 'When', value: whenLabel(at, tz, nowMs) }, { label: 'Wallet', value: w.name });
    onReview({ title: 'Review what you received', saveLabel: 'Save', savedMessage: 'Saved.', rows, build: () => [entry] });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">What kind</span>
        <Segmented<SourceType> label="What kind of receive" value={source} onChange={setSource} options={sourceOptions} />
        {source === 'frozen-payout' ? <span className="text-xs text-muted">Coins paid back by a frozen or bankrupt platform</span> : null}
        <button type="button" onClick={() => onSwitch('move')} className="min-h-11 self-start bg-transparent p-0 text-left text-[13px] font-semibold text-amber underline-offset-2 hover:underline">
          It came from my own other wallet. Log it as a move.
        </button>
      </div>

      <AmountInput amount={amount} error={tried ? errors.amount : null} needsPrice />
      <WalletSelect label="Wallet it arrived in" value={wallet} onChange={setWallet} wallets={wallets} error={tried ? errors.wallet : null} />

      {source === 'inherited' ? (
        <>
          <TextField label="Date of death" type="date" value={deathDate} onChange={(e) => setDeathDate(e.target.value)} />
          <ValueField label="Value on the date of death" value={deathValue} price={deathPrice} error={tried ? errors.value : null} hasAmount={sats !== null && deathAt !== null} />
        </>
      ) : (
        <ValueField label={source === 'income' ? 'Worth when you got it' : 'Worth that day'} value={value} price={price} error={tried ? errors.value : null} hasAmount={sats !== null} />
      )}

      <WhenField value={when} onChange={setWhen} error={tried ? errors.when : null} />

      {source === 'income' ? <TextField label="What for (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Rewards, a promo, mining" autoComplete="off" /> : null}

      {source === 'frozen-payout' ? (
        frozen.length === 0 ? (
          <Callout title="No frozen wallet yet">Mark a wallet as frozen from its options (the three dots on its page). Then payouts from it can be logged here.</Callout>
        ) : (
          <SelectField label="Paid out by" value={fromWallet} onChange={(e) => setFromWallet(e.target.value)} options={frozen.map((f) => ({ value: f.id, label: f.name }))} error={tried ? errors.from : null} />
        )
      ) : null}

      {source === 'gift' ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line p-3.5">
          <span className="text-[13px] text-muted">If you know what the giver paid, add it. Leave both empty if you do not.</span>
          <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
            <MoneyInput label="Giver's cost (optional)" value={giverCost} onChange={setGiverCost} error={tried ? errors.giverCost : null} />
            <TextField label="Giver's date (optional)" type="date" value={giverDate} onChange={(e) => setGiverDate(e.target.value)} error={tried ? errors.giverDate : null} />
          </div>
        </div>
      ) : null}
      <FormFooter>
        <Button type="submit" variant="primary" className="min-h-14 flex-1 rounded-[18px] text-[17px] shadow-[0_10px_30px_rgba(247,147,26,0.35)]">
          Review
        </Button>
      </FormFooter>
    </form>
  );
}
