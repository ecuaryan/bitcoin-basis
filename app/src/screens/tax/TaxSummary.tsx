import { yearSummary } from '@bitcoin-basis/engine';
import { Link, useParams } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { formatMoney } from '../../lib/format.ts';
import { answerReason, flagsForYear, overExclusion, totalsByKind, yearTaxView } from './tax-logic.ts';

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
  const { state, today } = useLedger();
  const wallets = new Map(state.wallets.map((w) => [w.id, w.name]));
  const s = yearSummary(state, year);
  const v = yearTaxView(state, state.settings, year, today);
  const t = totalsByKind(s);
  const gifts = overExclusion(state, year);
  const flags = flagsForYear(state, year);
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
            {FILING[state.settings.filingStatus] ?? state.settings.filingStatus} · wages {m(state.settings.wagesCents)} · {v.fellBack ? `${v.tableYear} tax table used (no ${year} table yet)` : `${year} tax table`}
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
                  <td className={td}>Loss carried in</td>
                  <td className={td} />
                  <td className={`${td} text-right`}>{m(v.carriedIn.st + v.carriedIn.lt)}</td>
                </tr>
              )}
              <tr>
                <td className={td}>Short-term / long-term after carryforward</td>
                <td className={td} />
                <td className={`${td} text-right`}>
                  {m(v.netting.st)} / {m(v.netting.lt)}
                </td>
              </tr>
              <tr>
                <td className={td}>Carries into {year + 1}</td>
                <td className={td} />
                <td className={`${td} text-right`}>{m(v.carryOut.st + v.carryOut.lt)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-1 mt-0 text-base font-semibold">Disposals (Form 8949 detail)</h2>
          {s.disposals.length === 0 ? (
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
                {s.disposals.map((d) => (
                  <tr key={d.entryId}>
                    <td className={td}>{d.date}</td>
                    <td className={td}>{wallets.get(d.wallet) ?? d.wallet}</td>
                    <td className={td}>{d.kind}</td>
                    <td className={td}>{d.sats.toLocaleString('en-US')}</td>
                    <td className={td}>{m(d.proceedsCents)}</td>
                    <td className={td}>{m(d.costCents)}</td>
                    <td className={td}>{m(d.gainCents)}</td>
                    <td className={td}>{d.stGainCents !== 0 && d.ltGainCents !== 0 ? 'both' : d.ltGainCents !== 0 ? 'long' : 'short'}</td>
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
        </section>

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
