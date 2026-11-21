import { uuidv7, type Wallet, type WalletCloseOutEntry } from '@bitcoin-basis/engine';
import { useMemo, useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Callout, TextAreaField, TextField } from '../../ui/form-fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import type { Draft } from '../log/draft.ts';
import { useFormEnv } from '../log/hooks.ts';
import { longDate, nowInstant, trialReplay } from '../log/model.ts';
import { FormFooter } from '../log/parts.tsx';
import { Review } from '../log/Review.tsx';

/** Close out a frozen wallet: record the loss (cost minus what came back), on a date you can change. */
export function CloseOutSheet({ open, onClose, wallet }: { open: boolean; onClose(): void; wallet: Wallet }) {
  return (
    <Sheet open={open} onClose={onClose} title={`Close out ${wallet.name}`} fixedHeight>
      <CloseOutBody wallet={wallet} onClose={onClose} />
    </Sheet>
  );
}

function CloseOutBody({ wallet, onClose }: { wallet: Wallet; onClose(): void }) {
  const { entries, state } = useLedger();
  const { tz, nowMs, today } = useFormEnv();
  const [id] = useState(() => uuidv7());
  // Today, unless that year is already closed: then the last day of the latest year that is still open.
  const [lossDate, setLossDate] = useState(() => {
    let y = Number(today.slice(0, 4));
    if (!state.closedYears.includes(y)) return today;
    while (state.closedYears.includes(y)) y -= 1;
    return `${y}-12-31`;
  });
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const entry: WalletCloseOutEntry = useMemo(
    () => ({ id, kind: 'wallet-close-out', wallet: wallet.id, at: nowInstant(nowMs), tz, ...(lossDate === '' ? {} : { lossDate }), reason: reason.trim() === '' ? 'Closing out' : reason.trim() }),
    [id, wallet.id, nowMs, tz, lossDate, reason],
  );
  const preview = useMemo(() => {
    const t = trialReplay(entries, state, [entry]);
    return { closeOut: t.after.closeOuts.find((c) => c.entryId === id), problems: t.problems };
  }, [entries, state, entry, id]);
  const c = preview.closeOut;
  const termText = c === undefined ? '' : c.ltGainCents !== 0 && c.stGainCents !== 0 ? 'part long\u2011term, part short\u2011term' : c.ltGainCents !== 0 ? 'long-term' : 'short-term'; // no-break hyphens
  
  function review() {
    if (lossDate === '' || c === undefined) return;
    setDraft({
      title: 'Review close-out',
      saveLabel: 'Close out wallet',
      savedMessage: 'Wallet closed out.',
      rows: [
        { label: 'Wallet', value: wallet.name },
        { label: 'Loss date', value: longDate(lossDate) },
        { label: 'Cost of the coins', value: <Money cents={c.costCents} /> },
        { label: 'Paid back to you', value: <Money cents={c.recoveredCents} /> },
        ...(reason.trim() === '' ? [] : [{ label: 'Reason', value: reason.trim() }]),
      ],
      build: () => [entry],
    });
  }

  if (draft !== null) return <Review draft={draft} onBack={() => setDraft(null)} onSaved={onClose} />;
  return (
    <form
      className="flex flex-col gap-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      <section aria-label="If you close it out" className="flex flex-col gap-2 rounded-2xl border border-line bg-bg px-4 py-3.5">
        <span className="text-xs tracking-[0.06em] text-muted">IF YOU CLOSE IT OUT</span>
        {c === undefined ? (
          <p className="m-0 text-sm text-muted">{preview.problems[0] ?? 'This wallet holds no coins to close out.'}</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-soft">{c.gainCents < 0 ? 'Loss recorded' : 'Gain recorded'}</span>
              <span className="font-display text-2xl font-semibold tracking-tight">
                <Money cents={Math.abs(c.gainCents)} />
              </span>
            </div>
            <span className="text-xs text-muted">
              Cost <Money cents={c.costCents} /> minus payouts <Money cents={c.recoveredCents} /> · {termText}
            </span>
          </>
        )}
      </section>
      <TextField label="Loss date" type="date" value={lossDate} onChange={(e) => setLossDate(e.target.value)} hint="The tax date of the loss. Often the day recovery became certain, such as when a bankruptcy plan took effect. Change it if yours is different." />
      <TextAreaField label="Why are you closing it out? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: the platform's plan took effect and no more payouts are expected" />
      <Callout tone="cpa" title="Confirm with your CPA">
        The right loss date and treatment depend on your situation. Later payouts after a close-out count as gains.
      </Callout>
      <FormFooter>
        <Button type="submit" variant="primary" disabled={c === undefined} className="min-h-14 flex-1 rounded-[18px] text-[17px]">
          Review and close out
        </Button>
      </FormFooter>
    </form>
  );
}
