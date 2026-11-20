import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useLedger } from '../data/ledger-provider.tsx';
import { Brand } from '../ui/AppShell.tsx';
import { buttonClasses } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { ComingSoon } from '../ui/ComingSoon.tsx';
import { Segmented } from '../ui/Segmented.tsx';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="m-0 font-display text-[28px] font-semibold tracking-tight lg:text-4xl">{title}</h1>
      {children}
    </div>
  );
}

export function WhatIf() {
  const [mode, setMode] = useState<'sell' | 'borrow'>('sell');
  return (
    <Page title="What if">
      <Segmented<'sell' | 'borrow'>
        label="What if"
        value={mode}
        onChange={setMode}
        className="max-w-xs"
        options={[
          { value: 'sell', label: 'Sell' },
          { value: 'borrow', label: 'Borrow' },
        ]}
      />
      {mode === 'sell' ? (
        <ComingSoon title="Sell planner" body="Compare oldest-first with lowest-tax coin choices side by side, with the tax each one adds." />
      ) : (
        <ComingSoon title="Borrow planner" body="See your loan-to-value, the margin-call and liquidation prices, and what a forced sale would cost in tax." />
      )}
    </Page>
  );
}

export function Records() {
  return (
    <Page title="Records">
      <ComingSoon title="Records" body="Your entries, the emergency kit test and exports will live here." />
      <Link to="/tax" className={buttonClasses('secondary', 'w-fit no-underline text-text lg:hidden')}>
        Tax season
      </Link>
    </Page>
  );
}

export function Tax() {
  return (
    <Page title="Tax season">
      <ComingSoon title="Tax season" body="The Form 1040 digital-asset answer, gains by year and the 1099-DA check arrive in a later step." />
    </Page>
  );
}

export function WalletDetail() {
  const { id } = useParams();
  const { state } = useLedger();
  const wallet = state.wallets.find((w) => w.id === id);
  return (
    <Page title={wallet?.name ?? 'Wallet'}>
      {wallet ? <ComingSoon backTo="/" title="Wallet detail" body="Coins oldest first, balance checks and wallet options will show here." /> : <Card>That wallet is not in your book.</Card>}
    </Page>
  );
}

/** Full-screen pages outside the tabs (first run, unlock, emergency kit). */
function Bare({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
      <Brand />
      <h1 className="m-0 font-display text-3xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

export function Welcome() {
  return (
    <Bare title="Welcome">
      <ComingSoon title="First run" body="Creating your book, the recovery code and encryption arrive in the next step. For now, load the demo from Holdings." backTo="/" />
    </Bare>
  );
}
export function Unlock() {
  return (
    <Bare title="Unlock">
      <ComingSoon title="Unlock" body="Passphrase and device unlock arrive with encryption." backTo="/" />
    </Bare>
  );
}
export function Kit() {
  return (
    <Bare title="Emergency kit">
      <ComingSoon title="Emergency kit" body="A printable page with your recovery code and the steps to restore everything." backTo="/" />
    </Bare>
  );
}

export function NotFound() {
  return (
    <Bare title="Not found">
      <ComingSoon title="There is nothing here" body="That page does not exist." backTo="/" />
    </Bare>
  );
}
