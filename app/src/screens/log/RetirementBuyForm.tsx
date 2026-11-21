import { averageCostPerBtc, parseDollars, uuidv7, type RetirementBuyEntry } from '@bitcoin-basis/engine';
import { useState } from 'react';
import { formatMoney, maskDigits } from '../../lib/format.ts';
import { usePrefs } from '../../ui/prefs.tsx';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { MoneyInput } from '../../ui/formatted-inputs.tsx';
import { TextAreaField, TextField } from '../../ui/form-fields.tsx';
import type { FormProps } from './draft.ts';
import { focusFirstError } from './first-error.ts';
import { stripSource, useAmount, useFormEnv, usePriceAt, withSource } from './hooks.ts';
import { centsText, cleanNumber, localInputFor, nowInstant, whenLabel, zonedInstant } from './model.ts';
import { AmountInput, FormFooter, WalletSelect, WhenField } from './parts.tsx';
import { useSaving } from './saving.ts';

/** A purchase inside a retirement wallet: amount, what was paid, when. Kept apart from every tax figure. */
export function RetirementBuyForm({ initial, preset, onReview }: FormProps) {
  const saving = useSaving();
  const { state, nowMs, tz } = useFormEnv();
  const edit = initial?.kind === 'retirement-buy' ? initial : null;
  const [id] = useState(() => uuidv7());
  const [when, setWhen] = useState(() => localInputFor(edit?.at ?? nowInstant(nowMs), tz));
  const at = zonedInstant(when, tz);
  const price = usePriceAt(at, nowMs);
  const amount = useAmount(edit?.sats ?? preset.sats ?? null, price.cents);
  const wallets = state.wallets.filter((w) => w.type === 'retirement' && (!w.archived || w.id === edit?.wallet));
  const [wallet, setWallet] = useState(edit?.wallet ?? preset.wallet ?? wallets[0]?.id ?? '');
  const [paid, setPaid] = useState(edit ? centsText(edit.costCents) : '');
  const [proof, setProof] = useState<string | null>(edit?.proof ?? null);
  const [note, setNote] = useState(stripSource(edit?.note));
  const [tried, setTried] = useState(false);

  const w = wallets.find((x) => x.id === wallet);
  const usd = amount.unit === 'usd';
  const sats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const costCents = usd ? parseDollars(cleanNumber(amount.text)) : parseDollars(cleanNumber(paid));
  // Null (never a throw) when the figure is too large to represent.
  const perBtc = sats !== null && costCents !== null ? averageCostPerBtc(costCents, sats) : null;
  const { masked } = usePrefs();
  const proofText = proof ?? w?.defaultProof ?? '';

  const errors = {
    when: at === null ? 'Pick a date and time.' : null,
    amount: sats === null ? (usd && price.cents === null ? 'Waiting for the price for that time. Try BTC instead.' : 'Enter how much you bought.') : null,
    paid: !usd && costCents === null ? 'Enter what you paid.' : null,
    wallet: w === undefined ? 'Choose a retirement wallet.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function review() {
    setTried(true);
    if (!valid || at === null || sats === null || costCents === null || w === undefined) return;
    const entry: RetirementBuyEntry = {
      id,
      kind: 'retirement-buy',
      at,
      tz,
      wallet,
      sats,
      costCents,
      ...(proofText.trim() === '' ? {} : { proof: proofText.trim() }),
      ...(note.trim() === '' && !usd ? {} : { note: withSource(note, usd ? `Price source: ${price.source} at ${formatMoney(price.cents ?? 0)} per BTC` : '') }),
    };
    onReview({
      title: 'Review purchase',
      saveLabel: 'Save purchase',
      savedMessage: 'Purchase saved.',
      direct: edit === null,
      rows: [
        { label: 'Bought', value: <Amount sats={sats} interactive={false} showUnit /> },
        { label: 'Total paid', value: <Money cents={costCents} /> },
        ...(perBtc === null ? [] : [{ label: 'Cost per BTC', value: <Money cents={perBtc} /> }]),
        { label: 'When', value: whenLabel(at, tz, nowMs) },
        { label: 'Wallet', value: w.name },
        { label: 'Record', value: proofText || 'None yet' },
      ],
      build: () => [entry],
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
      <AmountInput amount={amount} label="Amount" needsPrice error={tried ? errors.amount : null} />
      {wallets.length > 1 || w === undefined ? <WalletSelect label="Retirement wallet" value={wallet} onChange={setWallet} wallets={wallets} canAdd={false} error={tried ? errors.wallet : null} /> : null}
      {usd ? (
        <p className="m-0 rounded-xl bg-bg px-3.5 py-3 text-[13px] text-muted" aria-live="polite">
          {sats !== null ? (
            <>
              That buys <Amount sats={sats} interactive={false} showUnit /> at the market price for that time. Switch to BTC to enter exactly what you got.
            </>
          ) : (
            'Enter the dollars you spent.'
          )}
        </p>
      ) : (
        <MoneyInput label="Total paid, including fees" value={paid} onChange={setPaid} error={tried ? errors.paid : null} trailing={perBtc === null ? null : `${masked ? maskDigits(formatMoney(perBtc)) : formatMoney(perBtc)} per BTC`} />
      )}
      <WhenField value={when} onChange={setWhen} error={tried ? errors.when : null} />
      <TextField label="Where the record is" value={proofText} onChange={(e) => setProof(e.target.value)} autoComplete="off" hint={w && proof === null ? `${w.name}'s usual` : undefined} />
      <details className="rounded-2xl border border-line px-3.5 py-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-soft">More details</summary>
        <div className="flex flex-col gap-3 pb-3">
          <TextAreaField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </details>
      <p className="m-0 text-xs text-muted">Kept apart from tax math. It only shows what this account&apos;s coins cost and what they are worth.</p>
      <FormFooter>
        <Button type="submit" variant="primary" disabled={saving} className="min-h-14 flex-1 rounded-[18px] text-[17px] tracking-[0.01em] shadow-[0_10px_30px_rgba(247,147,26,0.35)]">
          {saving ? 'Saving…' : edit === null ? 'Save purchase' : 'Review change'}
        </Button>
      </FormFooter>
    </form>
  );
}
