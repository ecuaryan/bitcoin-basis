import { formatBtc, type GiftGiven } from '@bitcoin-basis/engine';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { formatMoney } from '../../lib/format.ts';
import { Amount, Money } from '../../ui/Amount.tsx';
import { Brand } from '../../ui/AppShell.tsx';
import { Button, buttonClasses } from '../../ui/Button.tsx';
import { Callout } from '../../ui/form-fields.tsx';
import { usePrefs } from '../../ui/prefs.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { longDate } from './model.ts';
import { useTitle } from '../../ui/use-title.ts';

const CARRYOVER = "When the person sells, they generally use the giver's cost and the dates above, not the value on the day of the gift. If the coins were worth less than the cost when given, a different rule can apply to losses.";

/** The note a person who received a gift can keep: what was given, the giver's cost and when each coin was bought. Plain text, no tax advice. */
export function giftNoteText(g: GiftGiven): string {
  const lines = [
    'Gift of Bitcoin',
    `Date of gift: ${longDate(g.date)}`,
    `Given to: ${g.recipient}`,
    `Amount: ${formatBtc(g.sats)} BTC`,
    `Worth on that day: ${formatMoney(g.valueCents)}`,
    `Giver's cost for these coins: ${formatMoney(g.costCents)}`,
    '',
    "Coins given (the date the giver got them, amount, giver's cost):",
    ...g.picks.map((p) => `- ${longDate(p.acquiredDate)}: ${formatBtc(p.sats)} BTC, cost ${formatMoney(p.costCents)}`),
    '',
    CARRYOVER,
    'Confirm with your CPA. Not tax advice.',
  ];
  return lines.join('\n');
}

/** The gift note on screen. Amounts follow the hide-amounts setting. */
export function GiftNoteCard({ gift, heading: Heading = 'h4' }: { gift: GiftGiven; heading?: 'h2' | 'h4' }) {
  return (
    <section aria-label="Gift note" className="flex flex-col gap-2.5 rounded-2xl border border-line bg-bg px-3.5 py-3.5">
      <Heading className="m-0 font-display text-base font-semibold tracking-tight">Gift note for {gift.recipient}</Heading>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-muted">Date of gift</dt>
        <dd className="m-0 text-right font-semibold">{longDate(gift.date)}</dd>
        <dt className="text-muted">Amount</dt>
        <dd className="m-0 text-right font-semibold">
          <Amount sats={gift.sats} interactive={false} showUnit />
        </dd>
        <dt className="text-muted">Worth that day</dt>
        <dd className="m-0 text-right font-semibold">
          <Money cents={gift.valueCents} />
        </dd>
        <dt className="text-muted">Giver&apos;s cost</dt>
        <dd className="m-0 text-right font-semibold">
          <Money cents={gift.costCents} />
        </dd>
      </dl>
      <ul aria-label="Coins given" className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-muted">
        {gift.picks.map((p) => (
          <li key={p.lotId} className="flex justify-between gap-3">
            <span>Bought {longDate(p.acquiredDate)}</span>
            <span>
              <Amount sats={p.sats} interactive={false} short /> · cost <Money cents={p.costCents} />
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-xs leading-snug text-muted">{CARRYOVER}</p>
    </section>
  );
}

/** Copy, share and open-to-print buttons for a saved gift. */
export function GiftNoteActions({ gift, onOpen }: { gift: GiftGiven; onOpen?(): void }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(giftNoteText(gift));
      toast.show('Gift note copied.');
    } catch {
      toast.show('Could not copy. Open the note and print it instead.');
    }
  }
  return (
    <div className="flex flex-wrap gap-2.5">
      <Button onClick={() => void copy()}>Copy the note</Button>
      <Link to={`/gift-note/${gift.entryId}`} onClick={onOpen} className={buttonClasses('secondary', 'no-underline text-text')}>
        Open to print
      </Link>
    </div>
  );
}

/** A full page of the gift note for printing or saving as a PDF. */
export function GiftNotePage() {
  const { id } = useParams();
  const { state } = useLedger();
  const { masked, setHidden } = usePrefs();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const gift = state.gifts.find((g) => g.entryId === id);
  useTitle('Gift note');
  if (gift === undefined) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-5 py-10">
        <h1 className="m-0 font-display text-2xl font-semibold">Gift note</h1>
        <p className="m-0 text-muted">That gift is not in your book.</p>
        <Link to="/" className={buttonClasses('secondary', 'w-fit no-underline text-text')}>
          Back to Holdings
        </Link>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-5 py-8 print:max-w-none print:bg-white print:p-0 print:text-black">
      <div className="flex items-center justify-between print:hidden">
        <Brand />
        <Link to="/" className="text-sm font-semibold">
          Back
        </Link>
      </div>
      <h1 className="m-0 font-display text-3xl font-semibold tracking-tight print:text-black">Gift note</h1>
      {masked ? (
        <Callout title="Amounts are hidden" className="print:hidden">
          <p className="m-0 mb-2">Show them to print or save this page.</p>
          <Button onClick={() => setHidden(false)}>Show amounts</Button>
        </Callout>
      ) : null}
      <div className="print:hidden">
        <GiftNoteCard gift={gift} heading="h2" />
      </div>
      <pre className="m-0 hidden whitespace-pre-wrap font-sans text-sm print:block print:text-black">{giftNoteText(gift)}</pre>
      <div className="flex flex-wrap gap-2.5 print:hidden">
        <Button variant="primary" disabled={masked} onClick={() => window.print()}>
          Print or save as PDF
        </Button>
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(giftNoteText(gift)).then(
              () => {
                setCopied(true);
                toast.show('Gift note copied.');
              },
              () => toast.show('Could not copy.'),
            );
          }}
        >
          {copied ? 'Copied' : 'Copy the note'}
        </Button>
      </div>
    </main>
  );
}
