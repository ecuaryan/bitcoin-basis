import { uuidv7, type Entry } from '@bitcoin-basis/engine';
import { useSubmit } from '../../ui/use-submit.ts';
import { SavingContext } from './saving.ts';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { Button } from '../../ui/Button.tsx';
import { Callout } from '../../ui/form-fields.tsx';
import { Sheet, SheetSlot, SheetSlotsPaused } from '../../ui/Sheet.tsx';
import { BuyForm } from './BuyForm.tsx';
import type { Draft, FormProps, LogKind, LogPreset } from './draft.ts';
import { GiftNoteActions, GiftNoteCard } from './GiftNote.tsx';
import { GiveForm } from './GiveForm.tsx';
import { resetScroll, useNowMs } from './hooks.ts';
import { describeEntry, entryNoun } from '../../lib/describe-entry.ts';
import { lockedYear, trialReplay } from './model.ts';
import { MoveForm } from './MoveForm.tsx';
import { ReceiveForm } from './ReceiveForm.tsx';
import { Review } from './Review.tsx';
import { SellForm } from './SellForm.tsx';
import { Amount, Money } from '../../ui/Amount.tsx';
import { useToast } from '../../ui/Toast.tsx';

const TABS: { kind: LogKind; label: string; name: string }[] = [
  { kind: 'buy', label: 'Bought', name: 'Bought' },
  { kind: 'receive', label: 'Received', name: 'Received' },
  { kind: 'move', label: 'Moved', name: 'Moved' },
  { kind: 'sell', label: 'Sold', name: 'Sold or spent' },
  { kind: 'give', label: 'Gave', name: 'Gave' },
];

const FORMS: Record<LogKind, (p: FormProps) => React.JSX.Element> = { buy: BuyForm, receive: ReceiveForm, move: MoveForm, sell: SellForm, give: GiveForm };

function KindTabs({ kind, onPick, panelId }: { kind: LogKind; onPick(k: LogKind): void; panelId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(e: KeyboardEvent, i: number) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (i + dir + TABS.length) % TABS.length;
    onPick((TABS[next] as (typeof TABS)[number]).kind);
    refs.current[next]?.focus();
  }
  return (
    <div role="tablist" aria-label="What happened" className="flex gap-0.5 rounded-[14px] bg-bg p-1">
      {TABS.map((t, i) => {
        const on = t.kind === kind;
        return (
          <button
            key={t.kind}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${panelId}-tab-${t.kind}`}
            aria-selected={on}
            aria-controls={panelId}
            aria-label={t.name}
            tabIndex={on ? 0 : -1}
            onClick={() => onPick(t.kind)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx('min-h-11 flex-auto whitespace-nowrap rounded-[10px] px-1.5 text-[13px] font-semibold transition-colors', on ? 'bg-accent text-bg' : 'bg-transparent text-muted hover:text-soft')}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function LogBody({ preset: startPreset, onClose, onStep }: { preset: LogPreset; onClose(): void; onStep(step: { title: string; back: (() => void) | null } | null): void }) {
  const { entries, state, append } = useLedger();
  const toast = useToast();
  const panelId = useId();
  const nowMs = useNowMs();
  const targetId = startPreset.edit ?? startPreset.remove;
  const head = useMemo(() => (targetId === undefined ? null : (entries.find((e) => e.id === targetId) ?? null)), [entries, targetId]);
  const [kind, setKind] = useState<LogKind>(startPreset.kind ?? (head && head.kind !== 'delete' && head.kind in FORMS ? (head.kind as LogKind) : 'buy'));
  const [preset, setPreset] = useState<LogPreset>(startPreset);
  const [formKey, setFormKey] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [doneGift, setDoneGift] = useState<string | null>(null);
  const [removeId] = useState(() => uuidv7());
  const editing = startPreset.edit !== undefined;
  const removing = startPreset.remove !== undefined;
  const walletsById = useMemo(() => new Map(state.wallets.map((w) => [w.id, w])), [state.wallets]);

  function switchTo(k: LogKind, p?: LogPreset) {
    setKind(k);
    setPreset(p ?? {});
    setFormKey((n) => n + 1);
    setDraft(null);
  }

  function wrap(d: Draft): Draft {
    if (head === null || !editing) return d;
    return {
      ...d,
      replacing: head.id,
      savedMessage: 'Change saved.',
      build: (reason) => d.build(reason).map((e) => ({ ...e, replaces: head.id, reason }) as Entry),
    };
  }

  const removeDraft: Draft | null = useMemo(() => {
    if (!removing || head === null) return null;
    const line = describeEntry(head, walletsById);
    const noun = entryNoun(head);
    return {
      title: `Remove this ${noun}?`,
      saveLabel: `Remove ${noun}`,
      savedMessage: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} removed.`,
      removing: true,
      replacing: head.id,
      backLabel: 'Cancel',
      rows: [
        { label: 'Entry', value: line.summary },
        ...(line.sats === null ? [] : [{ label: 'Amount', value: <Amount sats={line.sats} interactive={false} showUnit /> }]),
        ...(line.cents === null ? [] : [{ label: line.centsLabel === '' ? 'Value' : line.centsLabel.replace(/^./, (c) => c.toUpperCase()), value: <Money cents={line.cents} /> }]),
      ],
      build: (reason) => [{ id: removeId, kind: 'delete', at: new Date(nowMs).toISOString().slice(0, 19) + 'Z', tz: state.settings.timeZone, replaces: head.id, reason }],
    };
  }, [removing, head, walletsById, removeId, nowMs, state.settings.timeZone]);

  const reviewing = draft !== null;
  const sheetTitle = removeDraft?.title ?? draft?.title ?? null;
  useEffect(() => {
    onStep(sheetTitle === null ? null : { title: sheetTitle, back: removeDraft === null ? () => setDraft(null) : null });
    return () => onStep(null);
  }, [sheetTitle, removeDraft, onStep]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const formAreaRef = useRef<HTMLDivElement>(null);
  const wasReviewing = useRef(false);
  useEffect(() => {
    // Back from the review: top of the form, focus on the tab that was open.
    if (wasReviewing.current && !reviewing) {
      resetScroll(formAreaRef.current);
      tabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    }
    wasReviewing.current = reviewing;
  }, [reviewing]);


  /** Take back what was just saved: the same kind of entry a removal makes. */
  const undoing = useRef(false);
  async function undo(made: readonly Entry[]) {
    if (undoing.current) return;
    undoing.current = true;
    try {
      await undoNow(made);
    } finally {
      undoing.current = false;
    }
  }
  async function undoNow(made: readonly Entry[]) {
    const gone: Entry[] = made.map((e) => ({ id: uuidv7(), kind: 'delete', at: new Date(nowMs).toISOString().slice(0, 19) + 'Z', tz: state.settings.timeZone, replaces: e.id, reason: 'Undone right after saving' }));
    const t = trialReplay(entries, state, [...made, ...gone]);
    if (t.problems.length > 0) {
      toast.show('That cannot be undone now. Remove it from the wallet history instead.');
      return;
    }
    await append(gone);
    toast.show('Undone.', { success: true });
  }

  /** A purchase or a move saves straight from its form. If something blocks it, the review screen explains. */
  async function onReview(d: Draft) {
    const wrapped = wrap(d);
    if (d.direct !== true || editing) {
      setDraft(wrapped);
      return;
    }
    const made = d.build('');
    if (trialReplay(entries, state, made).problems.length > 0) {
      setDraft(wrapped);
      return;
    }
    await direct.run(d, made);
  }

  const direct = useSubmit(async (d: Draft, made: Entry[]) => {
    await append(made);
    const next = d.afterSave?.(made) ?? null;
    if (next !== null && 'next' in next) toast.show(d.savedMessage, { success: true });
    else toast.show(d.savedMessage, { success: true, action: { label: 'Undo', onClick: () => void undo(made) } });
    saved(d, made);
  });

  function saved(d: Draft, entriesSaved: Entry[]) {
    const after = d.afterSave?.(entriesSaved) ?? null;
    if (after !== null && 'next' in after) switchTo(after.next.kind, after.next.preset);
    else if (after !== null && 'giftNote' in after) setDoneGift(after.giftNote);
    else onClose();
  }

  if ((editing || removing) && head === null) return <Callout>That entry is not in your book any more.</Callout>;
  if (head !== null) {
    const locked = lockedYear(head, state);
    if (locked !== null) return <Callout tone="warn" title={`${locked} is closed`}>Entries in a closed year are locked. Unlock the year in Records first, then change it.</Callout>;
  }

  if (doneGift !== null) {
    const gift = state.gifts.find((g) => g.entryId === doneGift);
    return (
      <div className="flex flex-col gap-4 pb-2">
        <h3 className="m-0 font-display text-lg font-semibold tracking-tight">Gift saved</h3>
        {gift ? (
          <>
            <GiftNoteCard gift={gift} />
            <GiftNoteActions gift={gift} onOpen={onClose} />
          </>
        ) : (
          <p className="m-0 text-muted">Saved.</p>
        )}
        <Button variant="primary" onClick={onClose} className="min-h-14 rounded-[18px] text-[17px]">
          Done
        </Button>
      </div>
    );
  }

  if (removeDraft !== null) return <Review draft={removeDraft} showTitle={false} onBack={onClose} onSaved={(s) => saved(removeDraft, s)} />;

  const Form = FORMS[kind];
  return (
    <div className="flex flex-col gap-4">
      <div ref={formAreaRef} hidden={reviewing} className="flex flex-col gap-4">
        {editing ? (
          <h3 className="m-0 font-display text-lg font-semibold tracking-tight">{head === null ? 'Edit this entry' : `Edit this ${entryNoun(head)}`}</h3>
        ) : (
          <SheetSlotsPaused paused={reviewing}>
            <SheetSlot name="header">
              <div ref={tabsRef}>
                <KindTabs kind={kind} onPick={(k) => switchTo(k)} panelId={panelId} />
              </div>
            </SheetSlot>
          </SheetSlotsPaused>
        )}
        <div role={editing ? undefined : 'tabpanel'} id={panelId} aria-labelledby={editing ? undefined : `${panelId}-tab-${kind}`} className="flex flex-col gap-4">
          <SheetSlotsPaused paused={reviewing}>
            <SavingContext.Provider value={direct.busy}>
              <Form key={`${kind}-${formKey}`} initial={editing ? head : null} preset={preset} onReview={(d) => void onReview(d)} onSwitch={switchTo} />
            </SavingContext.Provider>
          </SheetSlotsPaused>
        </div>
      </div>
      {draft ? <Review draft={draft} showTitle={false} onBack={() => setDraft(null)} onSaved={(s) => saved(draft, s)} /> : null}
    </div>
  );
}

/** The Log sheet: five tabs (Bought, Received, Moved, Sold, Gave), each ending on a review screen. Also edits and removals. */
export function LogSheet({ open, onClose, preset }: { open: boolean; onClose(): void; preset: LogPreset }) {
  const [step, setStep] = useState<{ title: string; back: (() => void) | null } | null>(null);
  const title = step?.title ?? (preset.edit !== undefined ? 'Edit entry' : preset.remove !== undefined ? 'Remove' : 'Log');
  return (
    <Sheet open={open} onClose={onClose} title={title} onBack={step?.back ?? undefined} fixedHeight className="sm:max-w-xl">
      <LogBody preset={preset} onClose={onClose} onStep={setStep} />
    </Sheet>
  );
}
