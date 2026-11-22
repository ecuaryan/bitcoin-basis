import { LOAN_INTEREST_CPA_NOTE, loanInterestByYear, yearSummary } from '@bitcoin-basis/engine';
import { Link, useParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { formatMoney, shortDate } from '../../lib/format.ts';
import { answerReason, CHARITY_RULE, charityRows, flagsForYear, form8949Detail, overExclusion, totalsByKind, yearTaxView } from './tax-logic.ts';
import { useTitle } from '../../ui/use-title.ts';
import { assumesNoIncome, taxProfileSet } from '../records/settings-logic.ts';

const FILING: Record<string, string> = {
  single: 'Single',
  'married-joint': 'Married filing jointly',
  'married-separate': 'Married filing separately',
  'head-of-household': 'Head of household',
  'qualifying-surviving-spouse': 'Qualifying surviving spouse',
};

/** A plain printable page for a CPA: light, no navigation, one tap to print or save as PDF. */
export function TaxSummary() {
  const { year: yearParam } = useParams();
  const year = Number(yearParam);
  const { state, today, entries } = useLedger();
  const noIncome = assumesNoIncome(taxProfileSet(entries), state.settings);
  const wallets = new Map(state.wallets.map((w) => [w.id, w.name]));
  const s = yearSummary(state, year);
  const v = yearTaxView(state, state.settings, year, today);
  const t = totalsByKind(s);
  const detail = form8949Detail(s);
  const gifts = overExclusion(state, year);
  const flags = flagsForYear(state, year);
  const charity = charityRows(s);
  const loanInterest = loanInterestByYear(state).find((y) => y.year === year) ?? null;
  useTitle(`${year} tax summary`);
  const m = (c: number) => formatMoney(c);
  const th = 'border-b border-neutral-400 px-2 py-1 text-left text-xs font-semibold';
  const td = 'border-b border-neutral-200 px-2 py-1 text-xs';
  return (
    <div className="min-h-dvh bg-white px-6 py-8 text-[13px] text-neutral-900 print:p-0">
      <main className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Link to={`/tax?year=${year}`} className="text-sm font-semibold text-neutral-700 underline">
            Back to Tax season
          </Link>
          <button type="button" onClick={() => window.print()} className="min-h-11 rounded-xl bg-neutral-900 px-5 text-sm font-semibold text-white">
            Print or save as PDF
          </button>
        </div>
        <header className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-semibold">Bitcoin tax year summary: {year}</h1>
          <p className="m-0 text-neutral-600">Prepared {today} from the owner&apos;s own records. Estimates, not tax advice. Items marked &quot;confirm with your CPA&quot; are for you to decide.</p>
        </header>

        <section className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold">Form 1040 digital-asset question: {s.digitalAssetAnswer === 'yes' ? 'Yes' : 'No'}</h2>
          <p className="m-0">{answerReason(s)}</p>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold">Assumptions used</h2>
          <p className="m-0">
            {FILING[state.settings.filingStatus] ?? state.settings.filingStatus} · {noIncome ? 'wages and other income not entered ($0 assumed)' : `wages ${m(state.settings.wagesCents)}`} · {v.fellBack ? `${v.tableYear} tax table used (no ${year} table yet)` : `${year} tax table`}
          </p>
        </section>

        <section>
          <h2 className="mb-1 mt-0 text-base font-semibold">Gains and losses</h2>
          <table className="w-full border-collapse">
            <tbody>
              {[
                ['Sales', t.sales],
                ['Spending', t.spending],
                ['Network fees paid in BTC', t.fees],
                // As on Tax season: only when the year has a close-out or a payout after one.
                ...(t.other.count > 0 ? [['Frozen platform loss or payout', t.other]] : []),
              ].map(([label, k]) => (
                <tr key={String(label)}>
                  <td className={td}>{String(label)}</td>
                  <td className={td}>{(k as typeof t.sales).count}</td>
                  <td className={`${td} text-right`}>{m((k as typeof t.sales).gainCents)}</td>
                </tr>
              ))}
              <tr>
                <td className={td}>Short-term total</td>
                <td className={td} />
                <td className={`${td} text-right`}>{m(v.stCents)}</td>
              </tr>
              <tr>
                <td className={td}>Long-term total</td>
                <td className={td} />
                <td className={`${td} text-right`}>{m(v.ltCents)}</td>
              </tr>
              {v.carriedIn.st + v.carriedIn.lt > 0 && (
                <tr>
                  <td className={td}>Losses from past years</td>
                  <td className={td} />
                  <td className={`${td} text-right`}>{m(v.carriedIn.st + v.carriedIn.lt)}</td>
                </tr>
              )}
              <tr>
                <td className={td}>Short-term / long-term after losses from past years</td>
                <td className={td} />
                <td className={`${td} text-right`}>
                  {m(v.netting.st)} / {m(v.netting.lt)}
                </td>
              </tr>
              {v.netting.lossDeduction > 0 && (
                <tr>
                  <td className={td}>Used against other income</td>
                  <td className={td} />
                  <td className={`${td} text-right`}>{m(v.netting.lossDeduction)}</td>
                </tr>
              )}
              <tr>
                <td className={td}>Losses left for {year + 1}</td>
                <td className={td} />
                <td className={`${td} text-right`}>{m(v.carryOut.st + v.carryOut.lt)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-1 mt-0 text-base font-semibold">Disposals (Form 8949 detail)</h2>
          {detail.some((d) => d.kind === 'close-out' || d.kind === 'recovery') ? (
            <p className="m-0 mb-1 text-neutral-600">close-out: a frozen platform&apos;s loss (proceeds are what it paid back by the loss date). recovery: a payout after the close-out, a gain on $0 cost.</p>
          ) : null}
          {detail.length === 0 ? (
            <p className="m-0">None.</p>
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Disposals table">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Sold', 'Wallet', 'Kind', 'Sats', 'Proceeds', 'Cost', 'Gain', 'Term'].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.map((d) => (
                  <tr key={d.key}>
                    <td className={td}>{d.date}</td>
                    <td className={td}>{wallets.get(d.wallet) ?? d.wallet}</td>
                    <td className={td}>{d.kind}</td>
                    <td className={td}>{d.sats === null ? '—' : d.sats.toLocaleString('en-US')}</td>
                    <td className={td}>{m(d.proceedsCents)}</td>
                    <td className={td}>{m(d.costCents)}</td>
                    <td className={td}>{m(d.gainCents)}</td>
                    <td className={td}>{d.term}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-1 mt-0 text-base font-semibold">Income received (Schedule 1): {m(s.incomeCents)}</h2>
          {s.income.length === 0 ? (
            <p className="m-0">None.</p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {s.income.map((i) => (
                  <tr key={i.entryId}>
                    <td className={td}>{i.date}</td>
                    <td className={td}>{i.description ?? 'Income'}</td>
                    <td className={td}>{wallets.get(i.wallet) ?? i.wallet}</td>
                    <td className={`${td} text-right`}>{m(i.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold">Gifts given: {s.gifts.length + s.charityGifts.length}</h2>
          <p className="m-0">
            {gifts.over.length === 0 ? `None over ${m(gifts.limitCents)} to one person.` : gifts.over.map((g) => `${g.recipient}: ${m(g.valueCents)} is over ${m(gifts.limitCents)} (confirm with your CPA)`).join('; ')}
          </p>
          {charity.length > 0 && (
            <>
              <h3 className="mb-0 mt-2 text-sm font-semibold">Charity gifts (Schedule A): deduction {m(charity.reduce((t, c) => t + c.deductionCents, 0))}</h3>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['Date', 'Charity', 'Value', 'Deduction', 'Term'].map((h) => (
                      <th key={h} className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {charity.map((c) => (
                    <tr key={c.key}>
                      <td className={td}>{c.date}</td>
                      <td className={td}>{c.recipient}</td>
                      <td className={td}>{m(c.valueCents)}</td>
                      <td className={td}>{m(c.deductionCents)}</td>
                      <td className={td}>{c.term}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="m-0 text-neutral-600">{CHARITY_RULE}</p>
            </>
          )}
        </section>

        {loanInterest !== null && (
          <section className="flex flex-col gap-1">
            <h2 className="m-0 text-base font-semibold">Loan interest paid: {m(loanInterest.interestPaidCents)}</h2>
            <table className="w-full border-collapse">
              <tbody>
                {loanInterest.loans.map((l) => (
                  <tr key={l.loanId}>
                    <td className={td}>{l.name}</td>
                    <td className={`${td} text-right`}>{m(l.interestPaidCents)}</td>
                    <td className={`${td} text-right`}>{l.onPurchasesCents === l.interestPaidCents ? 'all on Bitcoin purchases' : `about ${m(l.onPurchasesCents)} on Bitcoin purchases`}</td>
                  </tr>
                ))}
                {loanInterest.paidBefore.map((p) => (
                  <tr key={`before-${p.loanId}-${p.date}`}>
                    <td className={td}>{p.name}</td>
                    <td className={`${td} text-right`}>{m(p.interestPaidCents)}</td>
                    <td className={`${td} text-right`}>{`paid by ${shortDate(p.date)}, not split by year (not in the total)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0">{LOAN_INTEREST_CPA_NOTE}</p>
          </section>
        )}

        {flags.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="m-0 text-base font-semibold">Confirm with your CPA</h2>
            <ul className="m-0 pl-5">
              {flags.map((f, i) => (
                <li key={`${f.entryId}-${i}`}>{f.message}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
