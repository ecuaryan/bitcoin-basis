import { averageCostPerBtc, formatBtc, localDate, parseBtc, parseDollars, splitCost, uuidv7, type BuyEntry, type Entry, type GiveEntry, type LedgerState, type Lot } from '@bitcoin-basis/engine';
import { useState } from 'react';
import { formatMoney, maskDigits } from '../../lib/format.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { BtcInput, MoneyInput } from '../../ui/formatted-inputs.tsx';
import { TextField } from '../../ui/form-fields.tsx';
import { usePrefs } from '../../ui/prefs.tsx';
import type { Draft } from './draft.ts';
import { focusFirstError } from './first-error.ts';
import type { GiftShared } from './GiveForm.tsx';
import { useAmount, useFormEnv, usePriceAt, withSource } from './hooks.ts';
import { centsText, cleanNumber, nowInstant, usableWallets, whenLabel, zonedInstant } from './model.ts';
import { AmountInput, FormFooter, MoreDetails, WalletSelect, WhenField } from './parts.tsx';

/** The gift is saved this long after the purchase, so it always replays after the coins arrive. */
export const GIFT_AFTER_MS = 1000;

/**
 * True when the newest gift in the book was bought for the occasion: it gave exactly one purchase's lot, from the
 * same wallet, saved right after that purchase. The Gave tab then starts with "I bought it to give" on.
 */
export function lastGiftWasBoughtToGive(entries: readonly Entry[], state: LedgerState): boolean {
  const applied = new Set(state.applied);
  const byId = new Map(entries.map((e) => [e.id, e]));
  let last: GiveEntry | null = null;
  for (const e of entries) if (e.kind === 'give' && applied.has(e.id) && (last === null || Date.parse(e.at) >= Date.parse(last.at))) last = e;
  if (last === null || last.picks.length !== 1) return false;
  const buy = byId.get(last.picks[0]?.lotId ?? '');
  if (buy?.kind !== 'buy' || buy.wallet !== last.wallet) return false;
  const gap = Date.parse(last.at) - Date.parse(buy.at);
  return gap >= 0 && gap <= 60_000;
}

/**
 * "I bought it to give": the purchase fields, then the gift. Saving logs both, a purchase and then, a moment later,
 * a gift of exactly that purchase's lot (all of it unless a smaller amount is given; the rest stays in the wallet).
 */
export function BuyToGiveForm({ shared, onReview }: { shared: GiftShared; onReview(d: Draft): void }) {
  const { state, nowMs, tz } = useFormEnv();
  const { masked } = usePrefs();
  // Made in this order, so the purchase's id also sorts first.
  const [ids] = useState(() => ({ buy: uuidv7(), gift: uuidv7() }));
  const { to, recipient, setRecipient, when, setWhen, wallet, setWallet, note, setNote, more, setMore } = shared;
  const at = zonedInstant(when, tz);
  const price = usePriceAt(at, nowMs);
  const amount = useAmount(null, price.cents);
  const [paid, setPaid] = useState('');
  // Null: give all of it / worth what was paid. Typing overrides either.
  const [givenText, setGivenText] = useState<string | null>(null);
  const [valueText, setValueText] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const w = state.wallets.find((x) => x.id === wallet);
  const usd = amount.unit === 'usd';
  const boughtSats = amount.sats !== null && amount.sats > 0 ? amount.sats : null;
  const costCents = usd ? parseDollars(cleanNumber(amount.text)) : parseDollars(cleanNumber(paid));
  const perBtc = boughtSats !== null && costCents !== null ? averageCostPerBtc(costCents, boughtSats) : null;
  const typedGiven = givenText === null ? null : parseBtc(cleanNumber(givenText));
  const givenSats = givenText === null ? boughtSats : typedGiven !== null && typedGiven > 0 ? typedGiven : null;
  const all = givenSats !== null && givenSats === boughtSats;
  // What was paid for the part given: that day's value, and the recipient's cost, so the gift is never below cost by default.
  const paidShare = boughtSats !== null && givenSats !== null && costCents !== null && givenSats <= boughtSats ? splitCost(boughtSats, costCents, givenSats) : null;
  const valueCents = valueText === null ? paidShare : parseDollars(cleanNumber(valueText));
  const giftAt = at === null ? null : nowInstant(Date.parse(at) + GIFT_AFTER_MS);
  const rest = boughtSats !== null && givenSats !== null ? boughtSats - givenSats : 0;

  const errors = {
    amount: boughtSats === null ? (usd && price.cents === null ? 'Waiting for the price for that time. Try BTC instead.' : 'Enter how much you bought.') : null,
    wallet: w === undefined ? 'Choose a wallet.' : null,
    paid: !usd && costCents === null ? 'Enter what you paid.' : null,
    when: at === null ? 'Pick a date and time.' : null,
    recipient: recipient.trim() === '' ? (to === 'person' ? 'Who is it for? A first name is enough.' : 'Enter the name of the charity or church.') : null,
    given: givenSats === null ? 'Enter how much you gave.' : boughtSats !== null && givenSats > boughtSats ? `You can give up to what you bought, ${formatBtc(boughtSats)} BTC.` : null,
    value: valueCents === null && valueText !== null ? 'Enter what it was worth.' : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  // A field tucked under More details opens it when it needs attention.
  const hiddenProblem = tried && (errors.given !== null || errors.value !== null);

  function review() {
    setTried(true);
    if (errors.given !== null || errors.value !== null) setMore(true);
    if (!valid || at === null || giftAt === null || boughtSats === null || givenSats === null || costCents === null || valueCents === null || w === undefined) return;
    const proof = w.defaultProof.trim();
    const buy: BuyEntry = {
      id: ids.buy,
      kind: 'buy',
      at,
      tz,
      wallet,
      sats: boughtSats,
      costCents,
      tier: 'documented',
      ...(proof === '' ? {} : { proof }),
      ...(usd ? { note: withSource('', `Price source: ${price.source} at ${formatMoney(price.cents ?? 0)} per BTC`) } : {}),
    };
    const picks = [{ lotId: ids.buy, sats: givenSats }];
    const gift: GiveEntry = {
      id: ids.gift,
      kind: 'give',
      at: giftAt,
      tz,
      wallet,
      sats: givenSats,
      valueCents,
      to,
      recipient: recipient.trim(),
      picks,
      note: withSource(note, valueText === null ? 'Price source: what you paid, including fees' : 'Price source: value entered by hand'),
    };
    const lot: Lot = { id: ids.buy, wallet, sats: boughtSats, costCents, acquiredDate: localDate(at, tz), acquiredAt: at, tier: 'documented', proof, originEntryId: ids.buy, alwaysLongTerm: false, tz, lossBasis: null };
    const name = recipient.trim();
    onReview({
      title: to === 'person' ? 'Review purchase and gift' : 'Review purchase and gift to charity',
      saveLabel: 'Save purchase and gift',
      savedMessage: 'Purchase and gift saved.',
      rows: [],
      groups: [
        {
          title: 'Purchase',
          rows: [
            { label: 'Bought', value: <Amount sats={boughtSats} interactive={false} showUnit /> },
            { label: 'Total paid', value: <Money cents={costCents} /> },
            ...(perBtc === null ? [] : [{ label: 'Cost per BTC', value: <Money cents={perBtc} /> }]),
            { label: 'Wallet', value: w.name },
            { label: 'When', value: whenLabel(at, tz, nowMs) },
          ],
        },
        {
          title: 'Gift',
          rows: [
            { label: 'Gave', value: <Amount sats={givenSats} interactive={false} showUnit /> },
            { label: 'To', value: to === 'person' ? name : `${name} (charity)` },
            { label: 'Worth that day', value: <Money cents={valueCents} /> },
            ...(rest > 0 ? [{ label: `Stays in ${w.name}`, value: <Amount sats={rest} interactive={false} showUnit /> }] : []),
            { label: 'When', value: 'Right after the purchase' },
          ],
        },
      ],
      coins: { picks, lots: [lot], onDate: localDate(giftAt, tz) },
      build: () => [buy, gift],
      ...(to === 'person' ? { afterSave: () => ({ giftNote: ids.gift }) } : {}),
    });
  }

  const money = (cents: number): string => (masked ? maskDigits(formatMoney(cents)) : formatMoney(cents));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        review();
        focusFirstError(e.currentTarget);
      }}
    >
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-3 p-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">What you bought</legend>
        <AmountInput amount={amount} label="Amount bought" needsPrice error={tried ? errors.amount : null} />
        <WalletSelect label="Bought in" value={wallet} onChange={setWallet} wallets={usableWallets(state)} error={tried ? errors.wallet : null} />
        {usd ? (
          <p className="m-0 rounded-xl bg-bg px-3.5 py-3 text-[13px] text-muted" aria-live="polite">
            {boughtSats !== null ? (
              <>
                That buys <Amount sats={boughtSats} interactive={false} showUnit /> at the market price for that time. Switch to BTC to enter exactly what you got.
              </>
            ) : (
              'Enter the dollars you spent.'
            )}
          </p>
        ) : (
          <MoneyInput label="Total paid, including fees" value={paid} onChange={setPaid} error={tried ? errors.paid : null} trailing={perBtc === null ? null : `${money(perBtc)} per BTC`} />
        )}
        <WhenField label="When you bought it" value={when} onChange={setWhen} error={tried ? errors.when : null} />
      </fieldset>
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="mb-3 p-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">The gift</legend>
        <TextField label={to === 'person' ? 'Who is it for?' : 'Charity or church'} value={recipient} onChange={(e) => setRecipient(e.target.value)} autoComplete="off" error={tried ? errors.recipient : null} />
        <p className="m-0 rounded-xl bg-bg px-3.5 py-3 text-[13px] leading-snug text-muted" aria-live="polite">
          {givenSats === null || boughtSats === null ? (
            'Gives all of what you bought, right after the purchase.'
          ) : (
            <>
              {all ? 'Gives all of it, ' : 'Gives '}
              <Amount sats={givenSats} interactive={false} showUnit />
              {valueCents !== null ? (
                <>
                  , worth <Money cents={valueCents} />
                  {valueText === null ? ' (what you paid)' : ''}
                </>
              ) : null}
              , right after the purchase.
              {rest > 0 ? (
                <>
                  {' '}
                  The other <Amount sats={rest} interactive={false} showUnit /> stays in {w?.name ?? 'the wallet'}.
                </>
              ) : null}
            </>
          )}
        </p>
        <MoreDetails open={more || hiddenProblem} onOpenChange={setMore}>
          <BtcInput
            label="Amount given"
            value={givenText ?? (boughtSats === null ? '' : formatBtc(boughtSats))}
            onChange={(v) => setGivenText(v)}
            hint={givenText === null ? 'All of what you bought. Give less and the rest stays in the wallet.' : <ResetLink onClick={() => setGivenText(null)}>Give all of it</ResetLink>}
            error={tried ? errors.given : null}
          />
          <MoneyInput
            label="Worth that day"
            value={valueText ?? centsText(paidShare)}
            onChange={(v) => setValueText(v)}
            hint={valueText === null ? 'What you paid, including fees. Change it if you know better.' : <ResetLink onClick={() => setValueText(null)}>Use what you paid</ResetLink>}
            error={tried ? errors.value : null}
          />
          <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        </MoreDetails>
      </fieldset>
      <FormFooter>
        <Button type="submit" variant="primary" className="min-h-14 flex-1 rounded-[18px] text-[17px] shadow-[0_10px_30px_rgba(247,147,26,0.35)]">
          Review purchase and gift
        </Button>
      </FormFooter>
    </form>
  );
}

function ResetLink({ onClick, children }: { onClick(): void; children: string }) {
  return (
    <span>
      You changed this.{' '}
      <button type="button" onClick={onClick} className="min-h-6 bg-transparent p-0 text-xs font-semibold text-amber underline-offset-2 hover:underline">
        {children}
      </button>
    </span>
  );
}
