import { formatCents, givingDue, parseDollars, yearOf } from '@bitcoin-basis/engine';
import { useSubmit } from '../../ui/use-submit.ts';
import { useMemo, useState } from 'react';
import { useLedger } from '../../data/ledger-provider.tsx';
import { cx } from '../../lib/cx.ts';
import { shortDate } from '../../lib/format.ts';
import { Money } from '../../ui/Amount.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { SelectBox } from '../../ui/Field.tsx';
import { MoneyInput } from '../../ui/formatted-inputs.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useWriter } from '../../ui/use-writer.ts';
import { yearsAvailable } from '../tax/tax-logic.ts';

/** Giving: off by default. When on, shows what is due from the year's sales and spending, and records what was paid. */
export function GivingView() {
  const { state, today } = useLedger();
  const write = useWriter();
  const toast = useToast();
  const years = useMemo(() => yearsAvailable(state, today), [state, today]);
  const [year, setYear] = useState(yearOf(today));
  const due = useMemo(() => givingDue(state, state.settings, year), [state, year]);
  const [amount, setAmount] = useState<string | null>(null);
  const s = state.settings;
  const owed = Math.max(0, due.owedCents);
  const amountText = amount ?? formatCents(owed);
  const cents = parseDollars(amountText);

  const turnOn = useSubmit(async () => {
    await write({ kind: 'settings', patch: { givingEnabled: true } });
    toast.show(`${s.givingName} is on.`, { success: true });
  });
  const paid = useSubmit(async () => {
    if (cents === null || cents <= 0) return;
    await write({ kind: 'giving-paid', year, cents });
    setAmount(null);
    toast.show(`Marked as paid for ${year}.`, { success: true });
  });

  if (!s.givingEnabled) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h2 className="m-0 font-display text-xl font-semibold">{s.givingName} is off</h2>
        <p className="m-0 text-[15px] leading-relaxed text-muted">
          Turn this on to set aside a share of what your sales gain, and track what you have paid. It is off until you want it. Choose the share and its name in Settings.
        </p>
        <Button
          variant="primary"
          disabled={turnOn.busy}
          onClick={() => void turnOn.run()}
        >
          {turnOn.busy ? 'Saving…' : 'Turn it on'}
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="m-0 hidden font-display text-2xl font-semibold lg:block">{s.givingName}</h2>
        <SelectBox label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </SelectBox>
      </div>

      <section aria-label="What is due" className="flex flex-col gap-3.5 rounded-[18px] border-[1.5px] border-accent bg-[linear-gradient(180deg,rgb(247_147_26/0.16),rgb(247_147_26/0.04))] p-4">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold tracking-[0.02em] text-amber">STILL TO GIVE FOR {year}</span>
            <span className="font-display text-[34px] font-semibold leading-[1.1]">
              <Money cents={owed} />
            </span>
          </div>
          <div className="flex flex-col items-end text-xs text-soft">
            <span>
              Due <Money cents={due.dueCents} />
            </span>
            <span>
              Paid <Money cents={due.paidCents} />
            </span>
          </div>
        </div>
        <p className="m-0 text-xs text-soft">
          {s.givingPercentBp / 100}% of the gain on logged sales and spending, {s.givingMode === 'after-tax' ? "after each sale's estimated tax" : 'before tax'}. Losses count as zero.
        </p>
      </section>

      <Card as="section" aria-label="Record a payment" className="flex flex-col gap-3 !rounded-[18px] !p-4">
        <h2 className="m-0 text-[15px] font-semibold">Record a payment</h2>
        <MoneyInput label="Amount paid" value={amountText} onChange={setAmount} error={cents === null ? 'Use a dollar amount.' : null} />
        <Button variant="primary" className="self-start" disabled={cents === null || cents <= 0 || paid.busy} onClick={() => void paid.run()}>
          {paid.busy ? 'Saving…' : 'Mark as paid'}
        </Button>
        {due.paidEntries.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Payments">
            {due.paidEntries.map((p) => (
              <li key={p.entryId} className="flex items-center justify-between border-t border-line-soft py-2 text-sm">
                <span className="text-soft">Paid for {p.year}</span>
                <Money cents={p.cents} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-label="Sales behind it" className="flex flex-col gap-1 !rounded-[18px] !p-4">
        <h2 className="m-0 mb-1 text-[15px] font-semibold">From sales and spending</h2>
        {due.sales.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">No sales or spending logged in {year}.</p>
        ) : (
          due.sales.map((x, i) => (
            <div key={x.entryId} className={cx('flex items-center justify-between gap-3 py-2 text-sm', i > 0 && 'border-t border-line-soft')}>
              <span className="flex flex-col">
                <span className="text-soft">{shortDate(x.date, today)}</span>
                <span className="text-xs text-muted">
                  Gain <Money cents={x.gainCents} signed />
                </span>
              </span>
              <Money cents={x.givingCents} />
            </div>
          ))
        )}
      </Card>

      <Card as="section" aria-label="Income received" className="flex flex-col gap-1 !rounded-[18px] !p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 text-[15px] font-semibold">Income received in {year}</h2>
          <Money cents={due.incomeCents} />
        </div>
        <p className="m-0 text-xs text-muted">Promos, rewards and mining are listed here but never counted toward {s.givingName}.</p>
        {due.income.map((i) => (
          <div key={i.entryId} className="flex items-center justify-between border-t border-line-soft py-2 text-sm">
            <span className="text-soft">
              {i.description ?? 'Income'} · {shortDate(i.date, today)}
            </span>
            <Money cents={i.valueCents} />
          </div>
        ))}
      </Card>
    </div>
  );
}
