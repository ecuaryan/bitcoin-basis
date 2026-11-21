import { type Entry } from '@bitcoin-basis/engine';
import { useSubmit } from '../../ui/use-submit.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { shortDate } from '../../lib/format.ts';
import { TIER_LABEL } from '../../lib/origin.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Callout, SummaryRow, TextField } from '../../ui/form-fields.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { TIER_BG } from '../holdings-parts.tsx';
import type { Draft } from './draft.ts';
import { computeEffect, trialReplay, type Effect } from './model.ts';
import { GiftNoteCard } from './GiftNote.tsx';
import { resetScroll } from './hooks.ts';
import { FormFooter } from './parts.tsx';

function CoinsUsed({ coins }: { coins: NonNullable<Draft['coins']> }) {
  const { today } = useLedger();
  const byId = new Map(coins.lots.map((l) => [l.id, l]));
  const rows = coins.picks.slice(0, 6);
  const more = coins.picks.length - rows.length;
  return (
    <section aria-label="Coins used" className="flex flex-col gap-1.5 rounded-2xl border border-line bg-bg px-3.5 py-3">
      <h3 className="m-0 text-xs font-normal text-muted">
        Coins used, saved with this entry ({coins.picks.length})
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((p) => {
          const lot = byId.get(p.lotId);
          return (
            <li key={p.lotId} className="flex min-h-6 items-center gap-2.5 text-[13px]">
              <span className={cx('h-4 w-1.5 flex-none rounded-full', lot ? TIER_BG[lot.tier] : 'bg-tier-unknown')} aria-hidden="true" />
              <span className="flex-1 font-semibold">
                <Amount sats={p.sats} interactive={false} />
              </span>
              <span className="text-xs text-muted">
                {lot ? `${shortDate(lot.acquiredDate, today)} · ${TIER_LABEL[lot.tier]}` : 'Coin'}
              </span>
            </li>
          );
        })}
      </ul>
      {more > 0 ? <span className="text-xs text-muted">and {more} more</span> : null}
    </section>
  );
}

function EffectCard({ effect }: { effect: Effect }) {
  const tax = effect.taxCents;
  return (
    <section aria-label="Tax effect" className="flex flex-col gap-2.5 rounded-2xl border border-line bg-bg px-3.5 py-3.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted">Tax effect</span>
        <span className={cx('font-display text-xl font-semibold tracking-tight', effect.tone === 'none' ? 'text-text' : 'text-accent')}>{effect.headline}</span>
      </div>
      {effect.lines.length > 0 ? (
        <dl className="m-0">
          {effect.lines.map((l) => (
            <SummaryRow key={l.label} label={l.label}>
              <Money cents={l.cents} {...(l.signed ? { signed: true } : {})} className={cx(l.signed && l.cents < 0 && 'text-loss')} />
            </SummaryRow>
          ))}
        </dl>
      ) : null}
      {tax !== null ? (
        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
          <span className="text-[13px] text-muted">{tax < 0 ? 'Estimated tax it could save' : 'Estimated tax it adds'}</span>
          <span className="text-base font-semibold">
            <Money cents={Math.abs(tax)} />
          </span>
        </div>
      ) : null}
      {effect.notes.map((n) => (
        <p key={n} className="m-0 text-[13px] leading-snug text-muted">
          {n}
        </p>
      ))}
      {tax !== null || effect.tone !== 'none' ? <p className="m-0 text-xs text-muted">Estimates only. Not tax advice.</p> : null}
    </section>
  );
}

/** The last screen before saving: what will be recorded and what it does to taxes. Nothing is saved until the button. */
export function Review({ draft, onBack, onSaved, showTitle = true }: { draft: Draft; onBack(): void; onSaved(saved: Entry[]): void; showTitle?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  // A new step starts at the top, with focus on it, so a screen reader reads the title first.
  useEffect(() => {
    resetScroll(formRef.current);
    formRef.current?.focus({ preventScroll: true });
  }, []);
  const { entries, state, append } = useLedger();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const needsReason = draft.replacing !== undefined;
  const reasonText = reason.trim();

  const built = useMemo(() => draft.build(reasonText === '' ? 'Reason to be added' : reasonText), [draft, reasonText]);
  const trial = useMemo(() => trialReplay(entries, state, built, draft.replacing), [entries, state, built, draft.replacing]);
  const primary = useMemo(() => [...built].reverse().find((e) => e.kind !== 'delete'), [built]);
  const effect = useMemo(() => (draft.removing === true || primary === undefined ? null : computeEffect(primary, trial.before, trial.after)), [draft.removing, primary, trial]);
  const gift = primary?.kind === 'give' && primary.to === 'person' ? trial.after.gifts.find((g) => g.entryId === primary.id) : undefined;
  const reasonError = tried && needsReason && reasonText === '' ? 'Say why you are changing this. It is kept with the entry.' : null;
  const blocked = trial.problems.length > 0;

  const submit = useSubmit(async () => {
    const final = draft.build(reasonText);
    await append(final);
    toast.show(draft.savedMessage, { success: true });
    onSaved(final);
  });
  const busy = submit.busy;
  function save() {
    setTried(true);
    if (blocked || (needsReason && reasonText === '')) return;
    void submit.run();
  }

  return (
    <form
      ref={formRef}
      tabIndex={-1}
      aria-label={draft.title}
      className="flex flex-col gap-4 outline-none"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {showTitle ? <h3 className="m-0 font-display text-lg font-semibold tracking-tight">{draft.title}</h3> : null}
      <dl className="m-0 rounded-2xl border border-line bg-bg px-3.5 py-1">
        {draft.rows.map((r) => (
          <SummaryRow key={r.label} label={r.label}>
            {r.value}
          </SummaryRow>
        ))}
      </dl>
      {draft.coins ? <CoinsUsed coins={draft.coins} /> : null}
      {effect ? <EffectCard effect={effect} /> : null}
      {draft.removing ? <Callout>This takes the entry out of your totals. Your history keeps it, marked as removed, with your reason.</Callout> : null}
      {effect && effect.cpa.length > 0 ? (
        <Callout tone="cpa" title="Confirm with your CPA">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {effect.cpa.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {gift ? <GiftNoteCard gift={gift} /> : null}
      {draft.extra}
      {needsReason ? <TextField label={draft.removing ? 'Why are you removing it?' : 'Why are you changing it?'} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: typo in the amount" error={reasonError} autoComplete="off" /> : null}
      {blocked ? (
        <Callout tone="error" title="This cannot be saved yet" role="alert">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {trial.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      <FormFooter>
        <Button variant="secondary" onClick={onBack} className="min-h-14 rounded-[18px]">
          {draft.backLabel ?? 'Back'}
        </Button>
        <Button type="submit" variant="primary" disabled={busy || blocked} className="min-h-14 flex-1 rounded-[18px] text-[17px] shadow-[0_10px_30px_rgba(247,147,26,0.35)]">
          {busy ? 'Saving…' : draft.saveLabel}
        </Button>
      </FormFooter>
    </form>
  );
}
