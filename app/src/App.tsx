import { Navigate, Route, Routes } from 'react-router';
import { Holdings } from './screens/Holdings.tsx';
import { Records } from './screens/records/Records.tsx';
import { GiftNotePage } from './screens/log/GiftNote.tsx';
import { Kit, NotFound, Unlock, Welcome } from './screens/stubs.tsx';
import { Tax } from './screens/tax/Tax.tsx';
import { TaxSummary } from './screens/tax/TaxSummary.tsx';
import { WalletDetail } from './screens/wallet/WalletDetail.tsx';
import { WhatIf } from './screens/whatif/WhatIf.tsx';
import { AppShell, useLogSheet } from './ui/AppShell.tsx';
import { useEffect } from 'react';

/** `/log` opens the Log sheet over Holdings (a deep link for the + button). */
function LogRoute() {
  const { open } = useLogSheet();
  useEffect(() => open(), [open]);
  return <Navigate to="/" replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Holdings />} />
        <Route path="what-if" element={<WhatIf />} />
        <Route path="records" element={<Records />} />
        <Route path="tax" element={<Tax />} />
        <Route path="wallet/:id" element={<WalletDetail />} />
        <Route path="log" element={<LogRoute />} />
      </Route>
      <Route path="tax/summary/:year" element={<TaxSummary />} />
      <Route path="gift-note/:id" element={<GiftNotePage />} />
      <Route path="welcome" element={<Welcome />} />
      <Route path="unlock" element={<Unlock />} />
      <Route path="kit" element={<Kit />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
