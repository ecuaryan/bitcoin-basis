import { formatAprPercent, loanSummary } from '@bitcoin-basis/engine';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLedger } from '../../data/ledger-provider.tsx';
import { usePrice } from '../../data/price-provider.tsx';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { ChevronRightIcon, PlusIcon } from '../../ui/icons.tsx';
import { PlainMoney } from '../../ui/plain-money.tsx';
import { LoanSetupSheet } from '../loans/LoanSetup.tsx';

/** Records › Loans: every loan (open first), and the one place to start tracking a new one. */
export function LoansView() {
  const { state, today } = useLedger();
  const { quote } = usePrice();
  const [adding, setAdding] = useState(false);
  const price = quote?.usdCents ?? null;
  const loans = useMemo(
    () =>
      [...state.loans]
        .sort((a, b) => Number(a.closed) - Number(b.closed))
        .flatMap((l) => {
          const s = loanSummary(state, l.id, price, today);
          return s === null ? [] : [{ loan: l, s }];
        }),
    [state, price, today],
  );
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 hidden font-display text-2xl font-semibold lg:block">Loans</h2>
      {loans.length === 0 ? (
        <Card className="flex flex-col gap-2 !rounded-[18px] !p-4">
          <p className="m-0 text-[15px] font-semibold">Bought Bitcoin with borrowed money?</p>
          <p className="m-0 text-[13px] leading-snug text-muted">Track a home equity line or other loan to see where you stand with the interest included: what you owe, your break-even price, and what would be left if you paid it off today. Tracking only: it never changes your cost or taxes.</p>
        </Card>
      ) : (
        <Card as="section" aria-label="Loans" className="flex flex-col !rounded-[18px] !p-2">
          {loans.map(({ loan, s }) => (
            <Link key={loan.id} to={`/loans/${loan.id}`} className="press-soft flex min-h-14 items-center justify-between gap-3 rounded-xl pl-3 pr-2 text-text no-underline hover:bg-surface-2 hover:text-text active:bg-surface-2">
              <span className="flex min-w-0 flex-col py-2">
                <span className="truncate text-[15px] font-semibold">{loan.name}</span>
                <span className="text-xs text-muted">
                  {loan.closed ? (
                    'Closed'
                  ) : (
                    <>
                      Owed <PlainMoney cents={s.principalOwedCents} precision="dollars" /> · {formatAprPercent(s.aprMillionths)}
                    </>
                  )}
                </span>
              </span>
              <ChevronRightIcon size={16} className="flex-none text-muted" />
            </Link>
          ))}
        </Card>
      )}
      <Button variant={loans.length === 0 ? 'primary' : 'secondary'} className="self-start" onClick={() => setAdding(true)}>
        <PlusIcon size={16} />
        Track a loan
      </Button>
      <LoanSetupSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
