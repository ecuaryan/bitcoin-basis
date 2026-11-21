import { form8949Csv, incomeCsv, yearOf, yearSummary } from '@bitcoin-basis/engine';
import { taxTableNotice } from '../../lib/tax-table-notice.ts';
import { useSubmit } from '../../ui/use-submit.ts';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { countOf, formatMoney, shortDate } from '../../lib/format.ts';
import { Money } from '../../ui/Amount.tsx';
import { useIsWide } from '../../ui/AppShell.tsx';
import { buttonClasses, Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { downloadText } from '../../ui/download.ts';
import { Field, SelectBox } from '../../ui/Field.tsx';
import { ChevronLeftIcon, DownloadIcon, InfoIcon } from '../../ui/more-icons.tsx';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { entryInstant, newIdGenerator } from '../../ui/new-entry.ts';
import { LockIcon } from '../../ui/icons.tsx';
import { answerReason, defaultTaxYear, flagsForYear, form1099Rows, nextYearLosses, overExclusion, totalsByKind, yearIsOver, yearsAvailable, yearTaxView } from './tax-logic.ts';
import { LOSSES_CHECK, staleLosses } from '../../lib/losses.ts';
import { useWriter } from '../../ui/use-writer.ts';
import { useTitle } from '../../ui/use-title.ts';
import { TERM_HELP } from '../../lib/terms.ts';
import { useHelp } from '../../ui/Help.tsx';

/** A card of label/value rows. `help` puts a "?" after one row's label, with its answer under the rows. */
function Rows({ rows, label, help }: { rows: readonly [string, ReactNode][]; label: string; help?: { row: string; label: string; text: string } }) {
  const h = useHelp(help?.label ?? '', help?.text ?? '');
  return (
    <section aria-label={label} className="rounded-[18px] border border-line bg-surface px-4 py-1">
      <dl className="m-0">
        {rows.map(([k, v], i) => (
          <div key={k} className={cx('flex min-h-12 items-center justify-between gap-4', i < rows.length - 1 && 'border-b border-line')}>
            <dt className="flex items-center gap-1 text-sm text-soft">
              {k}
              {help?.row === k ? h.button : null}
            </dt>
            <dd className="m-0 text-right text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {help && h.panel ? <div className="border-t border-line py-3">{h.panel}</div> : null}
    </section>
  );
}

function Count({ n, children }: { n: number; children: ReactNode }) {
  return (
    <>
      {n} · {children}
    </>
  );
}

// ---- Close and unlock ---------------------------------------------------------------------

function CloseYearSheet({ year, onClose }: { year: number; onClose(): void }) {
  const { entries, state, isDemo, today, append } = useLedger();
  const toast = useToast();
  const write = useWriter();
  const [closedNow, setClosedNow] = useState(false);
  // Worked out when the sheet opens, so closing the year does not change what is offered.
  const [carry] = useState(() => nextYearLosses(state, state.settings, year, today));
  const closer = useSubmit(async () => {
    if (!state.closedYears.includes(year)) await append([{ id: newIdGenerator(entries)(), kind: 'close-year', at: entryInstant(isDemo, today), tz: state.settings.timeZone, year }]);
    if (carry === null) {
      toast.show(`${year} is closed.`, { success: true });
      onClose();
    } else setClosedNow(true);
  });
  const saver = useSubmit(async () => {
    if (carry === null) return;
    await write({ kind: 'settings', patch: { carryforwardStCents: carry.st, carryforwardLtCents: carry.lt, carryforwardYear: year + 1 } });
    toast.show(`Saved for ${year + 1}.`, { success: true });
    onClose();
  });
  if (closedNow && carry !== null) {
    return (
      <Sheet open onClose={onClose} title={`${year} is closed`}>
        <div className="flex flex-col gap-4 pb-3">
          <section aria-label={`Losses left for ${year + 1}`} className="flex flex-col gap-2 rounded-2xl border border-line bg-bg p-3.5">
            <span className="text-sm font-semibold">Losses left for {year + 1}</span>
            <dl className="m-0 flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-soft">Short-term</dt>
                <dd className="m-0 font-semibold">
                  <Money cents={carry.st} />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-soft">Long-term</dt>
                <dd className="m-0 font-semibold">
                  <Money cents={carry.lt} />
                </dd>
              </div>
            </dl>
          </section>
          <p className="m-0 text-[13px] leading-snug text-muted">{LOSSES_CHECK}</p>
          <div className="flex gap-2.5">
            <Button className="flex-1" onClick={onClose}>
              Not now
            </Button>
            <Button variant="primary" className="flex-[1.6]" disabled={saver.busy} onClick={() => void saver.run()}>
              {saver.busy ? 'Saving…' : `Use these for ${year + 1}`}
            </Button>
          </div>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title={`Close ${year}?`}>
      <div className="flex flex-col gap-4 pb-3">
        <p className="m-0 text-[15px] leading-relaxed text-soft">
          Close a year once your return is filed. After that, buys, sales, moves and gifts dated in {year} are refused, so the numbers you filed cannot drift. You can unlock it later, but you will have to say why, and the reason is kept.
        </p>
        <div className="flex gap-2.5">
          <Button className="flex-1" onClick={onClose}>
            Not yet
          </Button>
          <Button variant="primary" className="flex-[1.6]" disabled={closer.busy} onClick={() => void closer.run()}>
            {closer.busy ? 'Saving…' : `Close ${year}`}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export function UnlockYearSheet({ year, onClose }: { year: number; onClose(): void }) {
  const { entries, state, isDemo, today, append } = useLedger();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const unlocker = useSubmit(async () => {
    if (state.closedYears.includes(year)) await append([{ id: newIdGenerator(entries)(), kind: 'unlock-year', at: entryInstant(isDemo, today), tz: state.settings.timeZone, year, reason: reason.trim() }]);
    toast.show(`${year} is unlocked.`, { success: true });
    onClose();
  });
  return (
    <Sheet open onClose={onClose} title={`Unlock ${year}?`}>
      <div className="flex flex-col gap-4 pb-3">
        <p className="m-0 text-[15px] leading-relaxed text-soft">Unlocking lets entries in {year} change again. Your reason is saved with it, so you can see later why a filed year was reopened.</p>
        <Field label="Why are you unlocking it?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: late 1099-DA with a new cost" />
        <div className="flex gap-2.5">
          <Button className="flex-1" onClick={onClose}>
            Keep it closed
          </Button>
          <Button variant="primary" className="flex-[1.6]" disabled={reason.trim() === '' || unlocker.busy} onClick={() => void unlocker.run()}>
            {unlocker.busy ? 'Saving…' : `Unlock ${year}`}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---- Screen -------------------------------------------------------------------------------

export function Tax() {
  const wide = useIsWide();
  const { entries, state, today } = useLedger();
  const [params, setParams] = useSearchParams();
  const years = useMemo(() => yearsAvailable(state, today), [state, today]);
  const asked = Number(params.get('year'));
  const year = years.includes(asked) ? asked : defaultTaxYear(years, today);
  const [sheet, setSheet] = useState<'close' | 'unlock' | null>(null);
  useTitle('Tax season');

  const summary = useMemo(() => yearSummary(state, year), [state, year]);
  const view = useMemo(() => yearTaxView(state, state.settings, year, today), [state, year, today]);
  const totals = useMemo(() => totalsByKind(summary), [summary]);
  const forms = useMemo(() => form1099Rows(state, year, entries), [state, year, entries]);
  const gifts = useMemo(() => overExclusion(state, year), [state, year]);
  const flags = useMemo(() => flagsForYear(state, year), [state, year]);
  const closed = state.closedYears.includes(year);
  const stale = year === yearOf(today) ? staleLosses(state.settings, year) : null;
  const yes = summary.digitalAssetAnswer === 'yes';

  const picker = (
    <SelectBox label="Tax year" hideLabel value={String(year)} onChange={(e) => setParams({ year: e.target.value }, { replace: true })} className="w-[104px]" selectClassName="!min-h-11 !rounded-xl !font-bold !bg-surface">
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </SelectBox>
  );

  const answer = (
    <section aria-label="Digital asset question" className="flex flex-col gap-1.5 rounded-[18px] border-[1.5px] border-accent bg-[linear-gradient(180deg,rgb(247_147_26/0.16),rgb(247_147_26/0.04))] p-4">
      <span className="text-xs font-semibold tracking-[0.02em] text-amber">FORM 1040 · DIGITAL ASSETS</span>
      <span className="font-display text-[26px] font-semibold">Answer: {yes ? 'Yes' : 'No'}</span>
      <span className="text-[13px] leading-[1.45] text-soft">{answerReason(summary)}</span>
    </section>
  );

  const kindRows: [string, ReactNode][] = (
    [
      ['Sales', totals.sales],
      ['Spending', totals.spending],
      ['Network fees (tiny sales)', totals.fees],
      ['Frozen platform loss or payout', totals.other],
    ] as const
  )
    .filter(([, t]) => t.count > 0)
    .map(([label, t]) => [label, <Count key={label} n={t.count}><Money cents={t.gainCents} signed /></Count>]);
  const summaryRows: [string, ReactNode][] = [
    ...(kindRows.length > 0 ? kindRows : ([['Sales and spending', 'None this year.']] as [string, ReactNode][])),
    ['Short-term total', <Money key="st" cents={view.stCents} signed />],
    ['Long-term total', <Money key="lt" cents={view.ltCents} signed />],
  ];
  const afterRows: [string, ReactNode][] = [
    ...(view.carriedIn.st + view.carriedIn.lt > 0 ? ([['Losses from past years', <Money key="ci" cents={view.carriedIn.st + view.carriedIn.lt} />]] as [string, ReactNode][]) : []),
    ['Short-term after losses from past years', <Money key="ast" cents={view.netting.st} signed />],
    ['Long-term after losses from past years', <Money key="alt" cents={view.netting.lt} signed />],
    ...(view.netting.lossDeduction > 0 ? ([['Used against other income', <Money key="ld" cents={view.netting.lossDeduction} />]] as [string, ReactNode][]) : []),
    [`Losses left for ${year + 1}`, <Money key="co" cents={view.carryOut.st + view.carryOut.lt} />],
  ];

  const income = (
    <Card as="section" aria-label="Income received" className="flex flex-col gap-2.5 !rounded-[18px] !p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold">Income received</h2>
        <span className="text-sm font-semibold">
          <Money cents={summary.incomeCents} />
        </span>
      </div>
      {summary.income.length === 0 ? (
        <p className="m-0 text-sm text-muted">No promo, reward or mining sats this year.</p>
      ) : (
        <>
          <p className="m-0 text-xs text-muted">Counts as ordinary income, listed on Schedule 1 (Other income), at the value the day you got it.</p>
          <ul className="m-0 flex list-none flex-col p-0">
            {summary.income.map((i) => (
              <li key={i.entryId} className="flex items-center justify-between gap-3 border-t border-line-soft py-2 text-sm">
                <span className="text-soft">
                  {i.description ?? 'Income'} · {shortDate(i.date, today)}
                </span>
                <Money cents={i.valueCents} />
              </li>
            ))}
          </ul>
          <Button className="self-start" onClick={() => downloadText(`income-${year}.csv`, incomeCsv(state, year))}>
            <DownloadIcon size={16} /> Income list (CSV)
          </Button>
        </>
      )}
    </Card>
  );

  const form1099 =
    forms.length === 0 ? null : (
      <Card as="section" aria-label="Tax forms from exchanges" className="flex flex-col gap-3 !rounded-[18px] !p-4">
        <h2 className="m-0 text-[15px] font-semibold">
          Tax forms from exchanges <span className="text-xs font-normal text-muted">(1099-DA)</span>
        </h2>
        <p className="m-0 text-[13px] leading-[1.4] text-muted">Exchanges send a 1099-DA listing your sales. Compare it with this so nothing is missed or counted twice.</p>
        {forms.map((f) => (
          <div key={f.wallet.id} className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{f.wallet.name}</span>
            <span className="text-xs leading-[1.4] text-muted">
              {f.sales === 0 ? (
                'No sales, so no form expected'
              ) : (
                <>
                  Should show {countOf(f.sales, 'sale')} · <Money cents={f.proceedsCents} /> received
                </>
              )}
            </span>
            {f.gifts > 0 && (
              <details className="text-xs leading-[1.4] text-muted">
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-amber">
                  You also gave {countOf(f.gifts, 'gift')} from here
                </summary>
                <span>
                  <Money cents={f.giftValueCents} /> worth, your cost <Money cents={f.giftCostCents} />. Some exchanges report gifts to other users as sales. If yours did, match each one to the gift you logged and use its cost: a gift is not a sale.
                </span>
              </details>
            )}
          </div>
        ))}
      </Card>
    );

  const giftCard = (
    <Card as="section" aria-label="Gifts given" className="flex flex-col gap-2 !rounded-[18px] !p-4">
      <h2 className="m-0 text-[15px] font-semibold">Gifts given</h2>
      <p className="m-0 text-sm text-soft">
        {summary.gifts.length + summary.charityGifts.length === 0 ? 'None this year.' : `${summary.gifts.length + summary.charityGifts.length} · ${gifts.over.length === 0 ? `none over ${formatMoney(gifts.limitCents, { precision: 'dollars' })} to one person` : `${gifts.over.length} over ${formatMoney(gifts.limitCents, { precision: 'dollars' })}`}`}
      </p>
      {gifts.over.map((g) => (
        <p key={g.recipient} className="m-0 text-[13px] text-amber">
          {g.recipient}: <Money cents={g.valueCents} /> is over the yearly limit per person. A gift tax return may be needed: confirm with your CPA.
        </p>
      ))}
    </Card>
  );

  const flagCard =
    flags.length > 0 ? (
      <Card as="section" aria-label="Ask your CPA" className="flex flex-col gap-2 !rounded-[18px] !p-4">
        <h2 className="m-0 text-[15px] font-semibold">Ask your CPA</h2>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {flags.map((f, i) => (
            <li key={`${f.entryId}-${f.code}-${i}`} className="flex items-start gap-2.5 text-[13px] leading-[1.4] text-soft">
              <InfoIcon size={16} className="mt-px flex-none text-accent" />
              {f.message}
            </li>
          ))}
        </ul>
      </Card>
    ) : null;

  const downloads = (
    <div className="grid grid-cols-2 gap-2.5">
      <Link to={`/tax/summary/${year}`} target="_blank" className={buttonClasses('secondary', 'min-h-[52px] !rounded-2xl !px-3 text-sm no-underline text-text')}>
        <DownloadIcon size={18} />
        For my CPA
      </Link>
      <Button className="min-h-[52px] !rounded-2xl !px-3 text-sm" onClick={() => downloadText(`form-8949-${year}.csv`, form8949Csv(state, year))}>
        <DownloadIcon size={18} />
        8949 sales list
      </Button>
    </div>
  );

  const closeArea = closed ? (
    <div className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface p-4">
      <span className="flex items-center gap-2 text-[15px] font-semibold">
        <LockIcon size={18} /> {year} is closed
      </span>
      <span className="text-[13px] text-muted">New entries dated {year} are refused. Unlock it if a late form or correction needs a change.</span>
      <Button className="self-start" onClick={() => setSheet('unlock')}>
        Unlock {year}…
      </Button>
    </div>
  ) : yearIsOver(year, today) ? (
    <Button variant="primary" className="min-h-[54px] w-full !rounded-2xl text-base" onClick={() => setSheet('close')}>
      <LockIcon size={18} />
      Close {year} once it&apos;s filed
    </Button>
  ) : (
    <p className="m-0 text-center text-[13px] text-muted">You can close {year} after you file.</p>
  );

  const note = (
    <p className="m-0 text-xs leading-[1.45] text-muted">
      Estimates, not tax advice. {taxTableNotice(year)} Gray areas are marked: confirm with your CPA.
    </p>
  );

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {wide ? (
        <PageHeader title="Tax season">{picker}</PageHeader>
      ) : (
        <header className="flex items-center gap-3">
          <Link to="/records" aria-label="Back to Records" className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-soft hover:text-text">
            <ChevronLeftIcon size={18} />
          </Link>
          <h1 className="m-0 min-w-0 flex-1 truncate font-display text-[28px] font-semibold tracking-tight">Tax season</h1>
          {picker}
        </header>
      )}
      <div className={cx(wide ? 'grid grid-cols-2 items-start gap-6' : 'flex flex-col gap-3')}>
        <div className="flex flex-col gap-3">
          {answer}
          {stale !== null && (
            <p className="m-0 text-[13px] leading-snug text-amber">
              Your losses from past years are saved for {stale.savedFor}.{' '}
              <Link to="/settings#taxes" className="font-semibold">
                Update them for {year}
              </Link>
            </p>
          )}
          <Rows label="Summary" rows={summaryRows} help={{ row: 'Short-term total', label: 'What are short-term and long-term?', text: TERM_HELP }} />
          <Rows label="After losses from past years" rows={afterRows} />
          {income}
        </div>
        <div className="flex flex-col gap-3">
          {form1099}
          {giftCard}
          {flagCard}
          {downloads}
          {closeArea}
          {note}
        </div>
      </div>
      {sheet === 'close' && <CloseYearSheet year={year} onClose={() => setSheet(null)} />}
      {sheet === 'unlock' && <UnlockYearSheet year={year} onClose={() => setSheet(null)} />}
    </div>
  );
}
