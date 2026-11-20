import { form8949Csv, incomeCsv, yearSummary } from '@bitcoin-basis/engine';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { formatMoney, shortDate } from '../../lib/format.ts';
import { Money } from '../../ui/Amount.tsx';
import { useIsWide } from '../../ui/AppShell.tsx';
import { buttonClasses, Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { downloadText } from '../../ui/download.ts';
import { Field, SelectBox } from '../../ui/Field.tsx';
import { CheckIcon, ChevronLeftIcon, DownloadIcon, InfoIcon } from '../../ui/more-icons.tsx';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { entryInstant, newIdGenerator } from '../../ui/new-entry.ts';
import { LockIcon } from '../../ui/icons.tsx';
import { answerReason, flagsForYear, form1099Rows, overExclusion, totalsByKind, yearsAvailable, yearTaxView } from './tax-logic.ts';

const CHECKED_KEY = 'bb.1099.checked';
function loadChecked(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(CHECKED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function Rows({ rows, label }: { rows: readonly [string, ReactNode][]; label: string }) {
  return (
    <section aria-label={label} className="rounded-[18px] border border-line bg-surface px-4 py-1">
      <dl className="m-0">
        {rows.map(([k, v], i) => (
          <div key={k} className={cx('flex min-h-12 items-center justify-between gap-4', i < rows.length - 1 && 'border-b border-line')}>
            <dt className="text-sm text-soft">{k}</dt>
            <dd className="m-0 text-right text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
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
  async function close() {
    await append([{ id: newIdGenerator(entries)(), kind: 'close-year', at: entryInstant(isDemo, today), tz: state.settings.timeZone, year }]);
    toast.show(`${year} is closed.`);
    onClose();
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
          <Button variant="primary" className="flex-[1.6]" onClick={() => void close()}>
            Close {year}
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
  async function unlock() {
    await append([{ id: newIdGenerator(entries)(), kind: 'unlock-year', at: entryInstant(isDemo, today), tz: state.settings.timeZone, year, reason: reason.trim() }]);
    toast.show(`${year} is unlocked.`);
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title={`Unlock ${year}?`}>
      <div className="flex flex-col gap-4 pb-3">
        <p className="m-0 text-[15px] leading-relaxed text-soft">Unlocking lets entries in {year} change again. Your reason is saved with it, so you can see later why a filed year was reopened.</p>
        <Field label="Why are you unlocking it?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: late 1099-DA with a new cost" />
        <div className="flex gap-2.5">
          <Button className="flex-1" onClick={onClose}>
            Keep it closed
          </Button>
          <Button variant="primary" className="flex-[1.6]" disabled={reason.trim() === ''} onClick={() => void unlock()}>
            Unlock {year}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---- Screen -------------------------------------------------------------------------------

export function Tax() {
  const wide = useIsWide();
  const { state, today } = useLedger();
  const [params, setParams] = useSearchParams();
  const years = useMemo(() => yearsAvailable(state, today), [state, today]);
  const asked = Number(params.get('year'));
  const year = years.includes(asked) ? asked : (years[0] as number);
  const [sheet, setSheet] = useState<'close' | 'unlock' | null>(null);
  const [checked, setChecked] = useState<string[]>(() => loadChecked());

  const summary = useMemo(() => yearSummary(state, year), [state, year]);
  const view = useMemo(() => yearTaxView(state, state.settings, year, today), [state, year, today]);
  const totals = useMemo(() => totalsByKind(summary), [summary]);
  const forms = useMemo(() => form1099Rows(state, year), [state, year]);
  const gifts = useMemo(() => overExclusion(state, year), [state, year]);
  const flags = useMemo(() => flagsForYear(state, year), [state, year]);
  const closed = state.closedYears.includes(year);
  const yes = summary.digitalAssetAnswer === 'yes';
  const doneCount = forms.filter((f) => checked.includes(`${year}:${f.wallet.id}`)).length;

  function toggleChecked(id: string, on: boolean) {
    const key = `${year}:${id}`;
    const next = on ? [...checked, key] : checked.filter((k) => k !== key);
    setChecked(next);
    try {
      window.localStorage.setItem(CHECKED_KEY, JSON.stringify(next));
    } catch {
      // Not saved; it still works until the page closes.
    }
  }

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

  const summaryRows: [string, ReactNode][] = [
    ['Sales', <Count key="s" n={totals.sales.count}><Money cents={totals.sales.gainCents} signed /></Count>],
    ['Spending', <Count key="p" n={totals.spending.count}><Money cents={totals.spending.gainCents} signed /></Count>],
    ['Network fees (tiny sales)', <Count key="f" n={totals.fees.count}><Money cents={totals.fees.gainCents} signed /></Count>],
    ...(totals.other.count > 0 ? ([['Frozen platform loss or payout', <Count key="o" n={totals.other.count}><Money cents={totals.other.gainCents} signed /></Count>]] as [string, ReactNode][]) : []),
    ['Short-term total', <Money key="st" cents={view.stCents} signed />],
    ['Long-term total', <Money key="lt" cents={view.ltCents} signed />],
  ];
  const afterRows: [string, ReactNode][] = [
    ...(view.carriedIn.st + view.carriedIn.lt > 0 ? ([['Loss carried in from earlier years', <Money key="ci" cents={view.carriedIn.st + view.carriedIn.lt} precision="dollars" />]] as [string, ReactNode][]) : []),
    ['Short-term after carryforward', <Money key="ast" cents={view.netting.st} signed />],
    ['Long-term after carryforward', <Money key="alt" cents={view.netting.lt} signed />],
    ...(view.netting.lossDeduction > 0 ? ([['Used against other income', <Money key="ld" cents={view.netting.lossDeduction} precision="dollars" />]] as [string, ReactNode][]) : []),
    [`Carries into ${year + 1}`, <Money key="co" cents={view.carryOut.st + view.carryOut.lt} precision="dollars" />],
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
        <p className="m-0 text-[13px] text-muted">No promo, reward or mining sats this year.</p>
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

  const form1099 = (
    <Card as="section" aria-label="1099-DA check" className="flex flex-col gap-3 !rounded-[18px] !p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold">1099-DA check</h2>
        {forms.length > 0 && (
          <span className="text-xs text-amber">
            {doneCount} of {forms.length} checked
          </span>
        )}
      </div>
      {year < 2025 && <p className="m-0 text-xs text-muted">Exchanges started sending 1099-DA forms for 2025 sales. For earlier years, check any other form they sent.</p>}
      {forms.length === 0 && <p className="m-0 text-[13px] text-muted">No exchange wallets in your book.</p>}
      {forms.map((f) => {
        const id = `${year}:${f.wallet.id}`;
        const on = checked.includes(id);
        return (
          <div key={f.wallet.id} className="flex items-start gap-3">
            <input type="checkbox" id={`chk-${id}`} checked={on} onChange={(e) => toggleChecked(f.wallet.id, e.target.checked)} className="mt-0.5 size-5 flex-none accent-accent" />
            <div className="flex flex-col gap-1">
              <label htmlFor={`chk-${id}`} className="text-sm font-semibold">
                {f.wallet.name}: {f.sales === 0 ? 'no form expected' : f.sales === 1 ? '1 sale' : `${f.sales} sales`}
                {on && <CheckIcon size={14} className="ml-1.5 inline text-accent" />}
              </label>
              <span className="text-xs leading-[1.4] text-muted">
                {f.sales === 0 ? 'Nothing sold or spent there this year.' : <>It should show {f.sales === 1 ? 'one sale' : `${f.sales} sales`} and <Money cents={f.proceedsCents} /> in proceeds. Match them to the sales you logged.</>}
                {f.gifts > 0 && (
                  <>
                    {' '}
                    You also gave {f.gifts === 1 ? 'one gift' : `${f.gifts} gifts`} from here (<Money cents={f.giftValueCents} /> worth, your cost <Money cents={f.giftCostCents} />). Some exchanges report gifts sent to other users as sales. If yours did, match each one to the gift you logged and use its cost: a gift is not a sale.
                  </>
                )}
              </span>
            </div>
          </div>
        );
      })}
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
      <Link to={`/tax/summary/${year}`} target="_blank" className={buttonClasses('secondary', 'min-h-[52px] !rounded-2xl text-sm no-underline text-text')}>
        <DownloadIcon size={18} />
        For my CPA
      </Link>
      <Button className="min-h-[52px] !rounded-2xl text-sm" onClick={() => downloadText(`form-8949-${year}.csv`, form8949Csv(state, year))}>
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
  ) : (
    <Button variant="primary" className="min-h-[54px] w-full !rounded-2xl text-base" onClick={() => setSheet('close')}>
      <LockIcon size={18} />
      Close {year} once it&apos;s filed
    </Button>
  );

  const note = (
    <p className="m-0 text-xs leading-[1.45] text-muted">
      Estimates, not tax advice. {view.fellBack ? `There is no ${year} tax table yet, so the ${view.tableYear} one is used. ` : ''}Gray areas are marked: confirm with your CPA.
    </p>
  );

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {wide ? (
        <PageHeader title="Tax season">{picker}</PageHeader>
      ) : (
        <header className="flex items-center justify-between">
          <Link to="/records" aria-label="Back to Records" className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-soft hover:text-text">
            <ChevronLeftIcon size={18} />
          </Link>
          <h1 className="m-0 font-display text-xl font-semibold">Tax season</h1>
          {picker}
        </header>
      )}
      <div className={cx(wide ? 'grid grid-cols-2 items-start gap-6' : 'flex flex-col gap-3')}>
        <div className="flex flex-col gap-3">
          {answer}
          <Rows label="Summary" rows={summaryRows} />
          <Rows label="After carryforward" rows={afterRows} />
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
