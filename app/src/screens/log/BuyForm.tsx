import { mulDivRoundHalfUp, parseDollars, SATS_PER_BTC, uuidv7, type BuyEntry, type Tier } from '@bitcoin-basis/engine';
import { useSaving } from './saving.ts';
import { useState } from 'react';
import { formatMoney } from '../../lib/format.ts';
import { TIER_HELP, TIER_LABEL } from '../../lib/origin.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { MoneyInput } from '../../ui/formatted-inputs.tsx';
import { SelectField, TextAreaField, TextField } from '../../ui/form-fields.tsx';
import type { FormProps } from './draft.ts';
import { useAmount, useFormEnv, usePriceAt, withSource, stripSource } from './hooks.ts';
import { centsText, cleanNumber, localInputFor, nowInstant, usableWallets, usualWallet, whenLabel, zonedInstant } from './model.ts';
import { AmountInput, FormFooter, WalletSelect, WhenField } from './parts.tsx';

const TIERS: Tier[] = ['documented', 'reconstructed', 'estimated', 'unknown'];

export function BuyForm({ initial, preset, onReview }: FormProps) {
  const saving = useSaving();
  const { entries, state, nowMs, tz } = useFormEnv();
  const edit = initial?.kind === 'buy' ? initial : null;
  const [id] = useState(() => uuidv7());
  const [when, setWhen] = useState(() => localInputFor(edit?.at ?? nowInstant(nowMs), tz));
  const at = zonedInstant(when, tz);
  const price = usePriceAt(at, nowMs);
  const amount = useAmount(edit?.sats ?? preset.sats ?? null, price.cents);
  const [wallet, setWallet] = useState(edit?.wallet ?? preset.wallet ?? usualWallet(entries, state, ['buy']));
  const [paid, setPaid] = useState(edit ? centsText(edit.costCents) : '');
  const [proof, setProof] = useState<string | null>(edit?.proof ?? null);
  const [tier, setTier] = useState<Tier>(edit?.tier ?? 'documented');
  const [note, setNote] = useState(stripSource(edit?.note));
  const [tried, setTried] = useState(false);

  const wallets = usableWallets(state, edit?.wallet);
  const w = state.wallets.find((x) => x.id === wallet);
  const usd = amount.unit === 'usd';
  const sats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const costCents = usd ? parseDollars(cleanNumber(amount.text)) : parseDollars(cleanNumber(paid));
  const perBtc = sats !== null && costCents !== null ? mulDivRoundHalfUp(costCents, SATS_PER_BTC, sats) : null;
  const proofText = proof ?? w?.defaultProof ?? '';

  const errors = {
    when: at === null ? 'Pick a date and time.' : null,
    amount: sats === null ? (usd && price.cents === null ? 'Waiting for the price for that time. Try BTC instead.' : 'Enter how much you bought.') : null,
    paid: !usd && costCents === null ? 'Enter what you paid.' : null,
    wallet: w === undefined ? 'Choose a wallet.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function review() {
    setTried(true);
    if (!valid || at === null || sats === null || costCents === null || w === undefined) return;
    const entry: BuyEntry = {
      id,
      kind: 'buy',
      at,
      tz,
      wallet,
      sats,
      costCents,
      tier,
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
        { label: 'Receipt', value: proofText || 'None yet' },
        { label: 'How sure', value: TIER_LABEL[tier] },
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
      }}
    >
      <AmountInput amount={amount} label="Amount" needsPrice error={tried ? errors.amount : null} />
      <WalletSelect label="Wallet" value={wallet} onChange={setWallet} wallets={wallets} error={tried ? errors.wallet : null} />
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
        <MoneyInput label="Total paid, including fees" value={paid} onChange={setPaid} error={tried ? errors.paid : null} trailing={perBtc === null ? null : `${formatMoney(perBtc)} per BTC`} />
      )}
      <WhenField value={when} onChange={setWhen} error={tried ? errors.when : null} />
      <TextField label="Receipt" value={proofText} onChange={(e) => setProof(e.target.value)} autoComplete="off" hint={w && proof === null ? `${w.name}'s usual` : undefined} />
      <details className="rounded-2xl border border-line px-3.5 py-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-soft">More details</summary>
        <div className="flex flex-col gap-3 pb-3">
          <SelectField label="How sure is the cost" value={tier} onChange={(e) => setTier(e.target.value as Tier)} options={TIERS.map((t) => ({ value: t, label: `${TIER_LABEL[t]}. ${TIER_HELP[t]}` }))} />
          <TextAreaField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </details>
      <FormFooter>
        <Button type="submit" variant="primary" disabled={saving} className="min-h-14 flex-1 rounded-[18px] text-[17px] tracking-[0.01em] shadow-[0_10px_30px_rgba(247,147,26,0.35)]">
          {saving ? 'Saving…' : edit === null ? 'Save purchase' : 'Review change'}
        </Button>
      </FormFooter>
    </form>
  );
}
