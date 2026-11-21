import { useSearchParams } from 'react-router';
import { PageHeader } from '../../ui/PageHeader.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { Borrow } from './Borrow.tsx';
import { Sell } from './Sell.tsx';

type Mode = 'sell' | 'borrow';

/** What if: plan a sale or a loan before doing it. Nothing here changes your records unless you log it. */
export function WhatIf() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'borrow' ? 'borrow' : 'sell';
  const setMode = (m: Mode) => setParams(m === 'sell' ? {} : { mode: m }, { replace: true });
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageHeader title="What if" />
      <Segmented<Mode>
        solid
        label="What if"
        value={mode}
        onChange={setMode}
        className="w-full lg:max-w-xs"
        options={[
          { value: 'sell', label: 'Sell' },
          { value: 'borrow', label: 'Borrow' },
        ]}
      />
      {mode === 'sell' ? <Sell /> : <Borrow />}
    </div>
  );
}
